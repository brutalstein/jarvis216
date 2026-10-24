import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { insertContext } from "./context.js";
import {
  type Action,
  attemptedStatuses,
  type Capability,
  canTransition,
  EnvelopeSchema,
  type EventType,
  fingerprint,
  invariant,
  type Progress,
  type Task,
  TaskSpecSchema,
  type TaskState,
  taskDeadline,
  terminal,
  verified,
} from "./contracts.js";
import { type Database, type Sql, write } from "./database.js";

// planId: the plan a step task belongs to, so plan bookkeeping can ignore unrelated tasks.
// lane: who claims it, so a change wakes only a worker that can act on it.
export type TaskChange = { id: string; status: TaskState; planId?: string; lane?: Lane };
export type TaskProgress = Progress & { at: number };
const bounded = (text: string | undefined, max: number) =>
  text === undefined ? undefined : text.replace(/\s+/g, " ").trim().slice(0, max) || undefined;
const count = (value: number | undefined) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000
    ? value
    : undefined;
export type Lane = "interactive" | "background";
export const lanes: readonly Lane[] = ["interactive", "background"];
// States an external submitter needs to hear about: settled, or waiting on the operator.
// One round trip per event: the previous event's id becomes causationId inside the INSERT.
// Every caller holds the scheduler lock, so the previous event is stable.
const insertEvent =
  "INSERT INTO events(task_id,envelope) SELECT $1::uuid, jsonb_set($2::jsonb,'{causationId}',COALESCE((SELECT to_jsonb(envelope->>'messageId') FROM events WHERE task_id=$1::uuid ORDER BY sequence DESC LIMIT 1),'null'::jsonb))";
const notified = new Set<TaskState>([
  "COMPLETED",
  "SKIPPED",
  "FAILED",
  "CANCELLED",
  "RECOVERY_REQUIRED",
  "WAITING_FOR_APPROVAL",
  "BLOCKED",
]);

export class TaskService {
  // "change" fires after a transaction that moved tasks has committed, once per task with its
  // final state, so waiters react at once instead of polling. In-process only: pollers remain
  // the safety net.
  readonly changes = new EventEmitter().setMaxListeners(100);
  // "progress" fires with { id, ...TaskProgress } when a running executor reports progress.
  readonly progress = new EventEmitter().setMaxListeners(100);
  #progress = new Map<string, TaskProgress>();
  #moved = new WeakMap<Sql, Map<string, { status: TaskState; planId?: string; lane: Lane }>>();
  constructor(
    public readonly db: Database,
    private options: {
      // Background capacity: plan steps, finishers, agents, API and n8n tasks.
      concurrency: number;
      // Capacity reserved for interactive tasks (spoken turns) on top of `concurrency`; 0 or
      // absent puts them in the background lane like any other task.
      interactive?: number;
      redact?: (text: string) => string;
      limits?: Partial<Record<Capability, number>>;
      // Principals whose tasks' notable transitions are queued for push delivery (n8n).
      outbox?: { principals: readonly string[] };
      // Providers whose interrupted calls are harmless: cancelling or losing such a call is a
      // definite outcome, not one to reconcile.
      retrySafe?: (target: string) => boolean;
      // A task created READY on its own (not inside a caller's transaction), after commit.
      admitted?: (task: Task) => void;
    } = {
      concurrency: 2,
    },
  ) {}

  async locked<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const moved = new Map<string, { status: TaskState; planId?: string; lane: Lane }>();
    const value = await this.db.transaction(async (tx) => {
      this.#moved.set(tx, moved);
      // Deferred: the lock travels with the transaction's first statement.
      await write(tx, "SELECT id FROM scheduler_lock WHERE id=1 FOR UPDATE");
      return fn(tx);
    });
    // The transaction has committed: a failing listener must neither make it look failed nor
    // keep the other listeners from hearing about it.
    for (const [id, { status, planId, lane }] of moved) {
      if (status !== "RUNNING" && status !== "VERIFYING") this.#progress.delete(id);
      if (terminal.has(status) || status === "BLOCKED" || status === "RECOVERY_REQUIRED") {
        this.#speculative.get(id)?.abort.abort();
        this.#speculative.delete(id);
      }
      for (const listener of this.changes.listeners("change"))
        try {
          (listener as (change: TaskChange) => void)({
            id,
            status,
            lane,
            ...(planId && { planId }),
          });
        } catch {
          process.stderr.write('{"level":"error","code":"TASK_CHANGE_LISTENER_FAILED"}\n');
        }
    }
    return value;
  }
  // In memory only, bounded and cleared when the task leaves RUNNING/VERIFYING.
  report(id: string, update: Progress): void {
    const stage = bounded(update.stage, 40);
    if (!stage) return;
    const detail = bounded(update.detail, 120);
    const index = count(update.index);
    const total = count(update.total);
    const value: TaskProgress = {
      stage,
      ...(detail && { detail }),
      ...(index !== undefined && { index }),
      ...(total !== undefined && { total }),
      at: Date.now(),
    };
    this.#progress.set(id, value);
    for (const listener of this.progress.listeners("progress"))
      try {
        (listener as (event: TaskProgress & { id: string }) => void)({ id, ...value });
      } catch {
        process.stderr.write('{"level":"error","code":"TASK_PROGRESS_LISTENER_FAILED"}\n');
      }
  }
  progressOf(id: string): TaskProgress | undefined {
    return this.#progress.get(id);
  }
  async get(id: string, tx: Sql = this.db): Promise<Task> {
    const task = (await tx.query<Task>("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
    invariant(task, "TASK_NOT_FOUND", 404);
    return task;
  }
  async event(
    tx: Sql,
    task: Task,
    type: EventType,
    payload: Record<string, never> | Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    await write(tx, insertEvent, [task.id, this.#envelope(task, type, payload)]);
  }
  // causationId is filled in by insertEvent, inside the same statement.
  #envelope(
    task: Task,
    type: EventType,
    payload: Record<string, never> | Record<string, string | number | boolean | null>,
  ): string {
    const id = randomUUID();
    const envelope = EnvelopeSchema.parse({
      protocolVersion: 1,
      messageId: id,
      correlationId: task.correlation_id,
      causationId: null,
      taskId: task.id,
      sender: "jarvis-core",
      recipient: "task-events",
      type,
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      expiresAt: task.spec.deadline,
      capabilities: [task.spec.capability],
      idempotencyKey: id,
      payload,
    });
    return JSON.stringify(envelope);
  }
  async move(tx: Sql, task: Task, state: TaskState, reason: string): Promise<void> {
    invariant(canTransition(task.status, state), "INVALID_TRANSITION");
    // The status change and its transition event travel as one statement.
    await write(tx, `WITH moved AS (UPDATE tasks SET status=$3 WHERE id=$1) ${insertEvent}`, [
      task.id,
      this.#envelope(task, "task.transition", { from: task.status, to: state, reason }),
      state,
    ]);
    task.status = state;
    this.#moved.get(tx)?.set(task.id, {
      status: state,
      planId: task.spec?.planId,
      lane: task.spec ? this.laneOf(task) : "background",
    });
    if (this.options.outbox?.principals.includes(task.principal) && notified.has(state))
      await write(
        tx,
        "INSERT INTO deliveries(id,task_id,status,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$4)",
        [randomUUID(), task.id, state, Date.now()],
      );
  }
  async create(raw: unknown, key: string, principal: string): Promise<Task> {
    const task = await this.locked((tx) => this.createIn(tx, raw, key, principal));
    if (task.status === "READY") this.options.admitted?.(task);
    return task;
  }
  // For callers already holding the scheduler lock: the task commits or rolls back with them.
  async createIn(tx: Sql, raw: unknown, key: string, principal: string): Promise<Task> {
    invariant(key.length >= 1 && key.length <= 200, "INVALID_IDEMPOTENCY_KEY", 400);
    const spec = TaskSpecSchema.parse(raw);
    // The idempotent replay and the queue quota in one round trip.
    const { prior, ...queued } = (
      await tx.query<{
        prior: (Task & { request_hash: string }) | null;
        total: string;
        mine: string;
      }>(
        "SELECT (SELECT to_jsonb(t) FROM tasks t WHERE principal=$1 AND idempotency_key=$2) AS prior, count(*) AS total, count(*) FILTER (WHERE principal=$1) AS mine FROM tasks WHERE status IN ('READY','WAITING_FOR_DEPENDENCY','WAITING_FOR_APPROVAL')",
        [principal, key],
      )
    ).rows[0] ?? { prior: null, total: "0", mine: "0" };
    if (prior) {
      invariant(prior.request_hash === fingerprint(spec), "IDEMPOTENCY_CONFLICT");
      return this.get(prior.id, tx);
    }
    invariant(Date.parse(spec.deadline) > Date.now(), "DEADLINE_EXPIRED", 400);
    // Automation ingress gets its own quota so it cannot crowd out the operator.
    invariant(
      Number(queued?.total) < 1000 && (principal === "operator" || Number(queued?.mine) < 100),
      "QUEUE_FULL",
      429,
    );
    for (const dependency of spec.dependencies) await this.get(dependency, tx);
    if (spec.condition) {
      const observed = await this.get(spec.condition.dependencyId, tx);
      invariant(observed.principal === principal, "CONDITION_DEPENDENCY_FORBIDDEN", 403);
      invariant(
        observed.spec.capability !== "text.generate",
        "CONDITION_REQUIRES_OBSERVATION",
        400,
      );
    }
    if (spec.parentId) {
      let parent: Task | undefined = await this.get(spec.parentId, tx);
      let depth = 1;
      while (parent?.spec.parentId) {
        parent = await this.get(parent.spec.parentId, tx);
        depth++;
        invariant(depth < 4, "MAX_AGENT_DEPTH");
      }
    }
    const id = randomUUID();
    const task = (
      await tx.query<Task>(
        "INSERT INTO tasks(id,correlation_id,principal,idempotency_key,request_hash,spec,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'CREATED',$7) RETURNING *",
        [
          id,
          randomUUID(),
          principal,
          key,
          fingerprint(spec),
          JSON.stringify({ ...spec, context: [] }),
          Date.now(),
        ],
      )
    ).rows[0] as Task;
    for (const entry of spec.context)
      await insertContext(tx, task, entry, this.options.redact ?? ((text) => text));
    for (const dependency of spec.dependencies)
      await write(
        tx,
        "INSERT INTO dependencies(task_id,dependency_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, dependency],
      );
    for (const state of ["VALIDATING", "PLANNING", "READY"] as const)
      await this.move(tx, task, state, "operator-submitted typed plan");
    if (spec.dependencies.length)
      await this.move(tx, task, "WAITING_FOR_DEPENDENCY", "dependencies declared atomically");
    return task;
  }
  async addDependency(id: string, dependency: string): Promise<void> {
    await this.locked(async (tx) => {
      const task = await this.get(id, tx);
      await this.get(dependency, tx);
      invariant(
        ["READY", "WAITING_FOR_DEPENDENCY"].includes(task.status) && task.attempt === 0,
        "DEPENDENCY_IMMUTABLE",
      );
      const cycle = await tx.query(
        "WITH RECURSIVE chain(id) AS (SELECT $1::uuid UNION SELECT d.dependency_id FROM dependencies d JOIN chain c ON d.task_id=c.id) SELECT id FROM chain WHERE id=$2",
        [dependency, id],
      );
      invariant(!cycle.rows.length, "DEPENDENCY_CYCLE");
      await tx.query(
        "INSERT INTO dependencies(task_id,dependency_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, dependency],
      );
      if (task.status === "READY")
        await this.move(tx, task, "WAITING_FOR_DEPENDENCY", "dependency added");
    });
  }
  laneOf(task: Pick<Task, "principal" | "spec">): Lane {
    return (this.options.interactive ?? 0) > 0 &&
      task.spec.lane === "interactive" &&
      task.principal === "operator"
      ? "interactive"
      : "background";
  }
  // Interactive tasks first, on their own capacity; background tasks within `concurrency` and
  // the per-capability limits, which count background work only. A worker may serve one lane.
  async claim(
    owner: string,
    leaseMs: number,
    serve: readonly Lane[] = lanes,
  ): Promise<Task | null> {
    return this.locked(async (tx) => {
      const running = (
        await tx.query<Pick<Task, "principal" | "spec">>(
          "SELECT principal, jsonb_build_object('capability', spec->'capability', 'lane', spec->'lane') AS spec FROM tasks WHERE status IN ('RUNNING','VERIFYING')",
        )
      ).rows;
      const activeByCapability = new Map<Capability, number>();
      let interactive = 0;
      let background = 0;
      for (const task of running) {
        if (this.laneOf(task) === "interactive") interactive++;
        else {
          background++;
          const capability = task.spec.capability;
          activeByCapability.set(capability, (activeByCapability.get(capability) ?? 0) + 1);
        }
      }
      const open = {
        interactive: serve.includes("interactive") && interactive < (this.options.interactive ?? 0),
        background: serve.includes("background") && background < this.options.concurrency,
      };
      if (!open.interactive && !open.background) return null;
      const candidates = (
        await tx.query<Task>(
          "SELECT * FROM tasks WHERE status IN ('READY','WAITING_FOR_DEPENDENCY') AND not_before<=$1 ORDER BY CASE WHEN principal='operator' AND spec->>'lane'='interactive' THEN 0 ELSE 1 END, created_at, id LIMIT 1000",
          [Date.now()],
        )
      ).rows;
      // Two set queries instead of two per candidate: the scheduler lock is held here.
      const dependencyStates = new Map<string, TaskState[]>();
      for (const row of (
        await tx.query<{ task_id: string; status: TaskState }>(
          "SELECT d.task_id,t.status FROM dependencies d JOIN tasks t ON t.id=d.dependency_id WHERE d.task_id = ANY($1::uuid[])",
          [candidates.map((task) => task.id)],
        )
      ).rows)
        dependencyStates.set(row.task_id, [
          ...(dependencyStates.get(row.task_id) ?? []),
          row.status,
        ]);
      for (const task of candidates) {
        if (taskDeadline(task) <= Date.now()) {
          await this.move(tx, task, "FAILED", "deadline expired");
          continue;
        }
        const deps = dependencyStates.get(task.id) ?? [];
        if (deps.some((status) => ["FAILED", "CANCELLED"].includes(status))) {
          await this.move(tx, task, "BLOCKED", "dependency unavailable");
          continue;
        }
        if (deps.some((status) => status !== "COMPLETED" && status !== "SKIPPED")) continue;
        const condition = task.spec.condition;
        let skip = !condition && deps.includes("SKIPPED");
        if (condition) {
          const dependency = await this.get(condition.dependencyId, tx);
          const contains = dependency.result?.text.includes(condition.contains) === true;
          skip =
            dependency.status !== "COMPLETED" ||
            !dependency.result ||
            (condition.not ? contains : !contains);
        }
        if (skip) {
          await this.move(
            tx,
            task,
            "SKIPPED",
            "conditional branch not selected; no executor dispatched",
          );
          continue;
        }
        const lane = this.laneOf(task);
        if (!open[lane]) continue;
        const defaults = {
          "text.generate": 2,
          "browser.extract": 1,
          "workflow.invoke": 1,
          "desktop.act": 1,
          "info.fetch": 2,
          "memory.write": 1,
          "tool.execute": 1,
        };
        const limit = this.options.limits?.[task.spec.capability] ?? defaults[task.spec.capability];
        if (lane === "background" && (activeByCapability.get(task.spec.capability) ?? 0) >= limit)
          continue;
        if (task.status === "WAITING_FOR_DEPENDENCY")
          await this.move(tx, task, "READY", "dependencies completed");
        await this.move(tx, task, "RUNNING", "lease acquired");
        return (
          await tx.query<Task>(
            "UPDATE tasks SET owner=$2, fence=fence+1, lease_until=$3, attempt=attempt+1 WHERE id=$1 RETURNING *",
            [task.id, owner, Date.now() + leaseMs],
          )
        ).rows[0] as Task;
      }
      return null;
    });
  }
  assertLease(task: Task, owner: string | null, fence: number): void {
    invariant(
      task.owner === owner &&
        task.fence === fence &&
        Number(task.lease_until) > Date.now() &&
        ["RUNNING", "VERIFYING"].includes(task.status),
      "LEASE_LOST",
    );
  }
  async heartbeat(id: string, owner: string, fence: number, leaseMs: number): Promise<void> {
    await this.locked(async (tx) => {
      this.assertLease(await this.get(id, tx), owner, fence);
      await tx.query("UPDATE tasks SET lease_until=$2 WHERE id=$1", [id, Date.now() + leaseMs]);
    });
  }
  // Model calls started at admission (see core's speculate): a spoken turn's call runs while
  // the claim and the write-ahead intent travel to the database, and the gateway adopts it.
  #speculative = new Map<
    string,
    { target: string; objective: string; result: Promise<unknown>; abort: AbortController }
  >();
  speculate(task: Task, target: string, run: (signal: AbortSignal) => Promise<unknown>): void {
    if (this.#speculative.has(task.id)) return;
    const abort = new AbortController();
    const deadline = AbortSignal.timeout(Math.max(1, taskDeadline(task) - Date.now()));
    const result = run(AbortSignal.any([abort.signal, deadline]));
    // Handled here too: an unadopted call's failure must not become an unhandled rejection.
    result.catch(() => {});
    this.#speculative.set(task.id, { target, objective: task.spec.objective, result, abort });
  }
  // The speculative call for exactly this provider and prompt, bounded by the gateway's signal;
  // anything else is aborted and the gateway calls the provider itself.
  adopt(
    id: string,
    target: string,
    objective: string,
    signal: AbortSignal,
  ): Promise<unknown> | undefined {
    const call = this.#speculative.get(id);
    if (!call) return undefined;
    this.#speculative.delete(id);
    if (call.target !== target || call.objective !== objective) {
      call.abort.abort();
      return undefined;
    }
    return new Promise((resolve, reject) => {
      const stop = () => {
        call.abort.abort(signal.reason);
        reject(signal.reason);
      };
      if (signal.aborted) return stop();
      signal.addEventListener("abort", stop, { once: true });
      call.result.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    });
  }
  #due = Number.POSITIVE_INFINITY;
  // A backoff: the task is claimable again at `until`. Idle workers sleep until the earliest one
  // instead of polling for it.
  async defer(tx: Sql, id: string, until: number): Promise<void> {
    await write(tx, "UPDATE tasks SET not_before=$2 WHERE id=$1", [id, until]);
    this.#due = Math.min(this.#due, until);
  }
  nextDue(): number | undefined {
    if (this.#due <= Date.now()) this.#due = Number.POSITIVE_INFINITY;
    return Number.isFinite(this.#due) ? this.#due : undefined;
  }
  async release(tx: Sql, id: string): Promise<void> {
    await write(tx, "UPDATE tasks SET owner=NULL,lease_until=NULL WHERE id=$1", [id]);
  }
  // The only way into RECOVERY_REQUIRED: in-flight actions become reconcilable UNCERTAIN.
  async quarantine(tx: Sql, task: Task, reason: string): Promise<void> {
    await this.move(tx, task, "RECOVERY_REQUIRED", reason);
    await tx.query(
      "UPDATE actions SET status='UNCERTAIN' WHERE task_id=$1 AND status='EXECUTING'",
      [task.id],
    );
    await this.release(tx, task.id);
  }
  async attemptedTargets(id: string, tx: Sql = this.db): Promise<string[]> {
    return (
      await tx.query<{ target: string }>(
        "SELECT target FROM actions WHERE task_id=$1 AND status = ANY($2::text[])",
        [id, [...attemptedStatuses]],
      )
    ).rows.map((a) => a.target);
  }
  async cancel(id: string): Promise<Task> {
    return this.locked(async (tx) => {
      const task = await this.get(id, tx);
      if (terminal.has(task.status)) return task;
      invariant(task.status !== "RECOVERY_REQUIRED", "RECONCILIATION_REQUIRED");
      await this.event(tx, task, "cancellation.requested", { principal: "operator" });
      const pending = await this.#unsafeInFlight(tx, id);
      await tx.query("UPDATE tasks SET fence=fence+1 WHERE id=$1", [id]);
      if (pending) await this.quarantine(tx, task, "operator cancellation during external action");
      else {
        await this.move(tx, task, "CANCELLED", "operator cancellation");
        await this.release(tx, id);
      }
      return task;
    });
  }
  // In-flight actions whose interruption leaves the outside world unknown. Interrupted calls of
  // retry-safe providers are marked failed: nothing happened that needs reconciling.
  async #unsafeInFlight(tx: Sql, id: string): Promise<boolean> {
    const executing = (
      await tx.query<{ id: string; target: string }>(
        "SELECT id,target FROM actions WHERE task_id=$1 AND status='EXECUTING'",
        [id],
      )
    ).rows;
    const safe = this.options.retrySafe;
    if (executing.some((action) => !safe?.(action.target))) return true;
    for (const action of executing)
      await tx.query("UPDATE actions SET status='FAILED' WHERE id=$1", [action.id]);
    return false;
  }
  #recovered = 0;
  #recovering: Promise<void> | undefined;
  // Workers call this before each claim: at most one recovery pass per interval for all of
  // them, instead of one scheduler-locked scan per claim attempt.
  recoverDue(intervalMs = 1000): Promise<void> {
    if (this.#recovering) return this.#recovering;
    if (Date.now() - this.#recovered < intervalMs) return Promise.resolve();
    this.#recovered = Date.now();
    this.#recovering = this.recover().finally(() => {
      this.#recovering = undefined;
    });
    return this.#recovering;
  }
  async recover(): Promise<void> {
    await this.locked(async (tx) => {
      await tx.query("DELETE FROM task_context WHERE expires_at<=$1", [Date.now()]);
      const stale = (
        await tx.query<Task>(
          "SELECT * FROM tasks WHERE status IN ('RUNNING','VERIFYING') AND lease_until<=$1",
          [Date.now()],
        )
      ).rows;
      for (const task of stale) {
        if (task.status === "VERIFYING" || (await this.#unsafeInFlight(tx, task.id)))
          await this.quarantine(tx, task, "expired worker lease");
        else {
          await this.move(tx, task, "READY", "expired worker lease");
          await this.release(tx, task.id);
        }
      }
      const expired = (
        await tx.query<Task>(
          "SELECT * FROM tasks WHERE status IN ('WAITING_FOR_APPROVAL','BLOCKED','READY','WAITING_FOR_DEPENDENCY')",
        )
      ).rows;
      for (const task of expired)
        if (taskDeadline(task) <= Date.now())
          await this.move(tx, task, "FAILED", "approval deadline expired");
    });
  }
  async actions(id: string): Promise<Action[]> {
    return (await this.db.query<Action>("SELECT * FROM actions WHERE task_id=$1 ORDER BY id", [id]))
      .rows;
  }
  async events(id: string, after = 0): Promise<object[]> {
    return (
      await this.db.query(
        "SELECT sequence,envelope FROM events WHERE task_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100",
        [id, after],
      )
    ).rows;
  }
  // Summary rows only: objectives and results stay behind the per-task endpoint.
  async list(filter: { status?: TaskState; before?: number; limit: number }): Promise<object[]> {
    return (
      await this.db.query(
        "SELECT id,correlation_id,principal,status,spec->>'capability' AS capability,calls,attempt,created_at FROM tasks WHERE ($1::text IS NULL OR status=$1) AND created_at<$2 ORDER BY created_at DESC,id LIMIT $3",
        [filter.status ?? null, filter.before ?? Number.MAX_SAFE_INTEGER, filter.limit],
      )
    ).rows;
  }
  async approve(actionId: string, approver: string, expiresAt: number): Promise<void> {
    await this.locked(async (tx) => {
      const action = (await tx.query<Action>("SELECT * FROM actions WHERE id=$1", [actionId]))
        .rows[0];
      invariant(action?.status === "AWAITING_APPROVAL", "APPROVAL_NOT_PENDING");
      const task = await this.get(action.task_id, tx);
      invariant(task.status === "WAITING_FOR_APPROVAL", "APPROVAL_NOT_PENDING");
      invariant(
        expiresAt > Date.now() &&
          expiresAt <= Date.now() + 300_000 &&
          taskDeadline(task) > Date.now(),
        "INVALID_APPROVAL_EXPIRY",
      );
      await tx.query(
        "INSERT INTO approvals(action_id,hash,approver,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(action_id) DO UPDATE SET hash=$2,approver=$3,expires_at=$4 WHERE approvals.consumed_at IS NULL",
        [actionId, action.hash, approver, Math.min(expiresAt, taskDeadline(task))],
      );
      await this.event(tx, task, "approval.granted", { actionId, approver });
      await this.move(tx, task, "READY", "approval granted");
    });
  }
  async resume(id: string): Promise<void> {
    await this.locked(async (tx) => {
      const task = await this.get(id, tx);
      invariant(
        task.status === "BLOCKED" &&
          task.calls < task.spec.budget.maxCalls &&
          taskDeadline(task) > Date.now(),
        "RESUME_DENIED",
      );
      const uncertain = (
        await tx.query(
          "SELECT id FROM actions WHERE task_id=$1 AND status IN ('UNCERTAIN','EXECUTING')",
          [id],
        )
      ).rows.length;
      invariant(!uncertain, "RECONCILIATION_REQUIRED");
      await this.move(tx, task, "READY", "operator resumed; admission and routing rechecked");
    });
  }
  async reject(actionId: string, principal: string): Promise<void> {
    await this.locked(async (tx) => {
      const action = (await tx.query<Action>("SELECT * FROM actions WHERE id=$1", [actionId]))
        .rows[0];
      invariant(action?.status === "AWAITING_APPROVAL", "APPROVAL_NOT_PENDING");
      const task = await this.get(action.task_id, tx);
      invariant(task.status === "WAITING_FOR_APPROVAL", "APPROVAL_NOT_PENDING");
      await tx.query("UPDATE actions SET status='DENIED' WHERE id=$1", [actionId]);
      await this.event(tx, task, "approval.rejected", { actionId, principal });
      await this.move(tx, task, "CANCELLED", "operator denied action");
    });
  }
  async reconcile(
    actionId: string,
    outcome: "FAILED" | "COMPLETED",
    evidence: string,
    principal: string,
  ): Promise<void> {
    invariant(evidence.trim().length >= 10 && evidence.length <= 4096, "EVIDENCE_REQUIRED", 400);
    await this.locked(async (tx) => {
      const action = (await tx.query<Action>("SELECT * FROM actions WHERE id=$1", [actionId]))
        .rows[0];
      invariant(action?.status === "UNCERTAIN", "ACTION_NOT_UNCERTAIN");
      const task = await this.get(action.task_id, tx);
      invariant(task.status === "RECOVERY_REQUIRED", "TASK_NOT_UNCERTAIN");
      invariant(outcome !== "COMPLETED" || verified(task.spec, evidence), "VERIFICATION_FAILED");
      const redacted = (this.options.redact ?? ((text) => text))(evidence);
      const result = JSON.stringify({ text: redacted, source: `operator:${principal}` });
      await tx.query("UPDATE actions SET status=$2,result=$3 WHERE id=$1", [
        actionId,
        outcome === "COMPLETED" ? "SUCCEEDED" : "FAILED",
        result,
      ]);
      await tx.query("UPDATE tasks SET result=$2 WHERE id=$1", [task.id, result]);
      await this.event(tx, task, "action.reconciled", {
        actionId,
        outcome,
        evidence: redacted,
        principal,
      });
      await this.move(tx, task, outcome, "operator attested external outcome; no replay");
    });
  }
}
