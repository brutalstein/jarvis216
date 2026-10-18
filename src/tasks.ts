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
  type Task,
  TaskSpecSchema,
  type TaskState,
  taskDeadline,
  terminal,
  verified,
} from "./contracts.js";
import type { Database, Sql } from "./database.js";

export type TaskChange = { id: string; status: TaskState };

export class TaskService {
  // "change" fires after a transaction that moved tasks has committed, once per task with its
  // final state, so waiters react at once instead of polling. In-process only: pollers remain
  // the safety net.
  readonly changes = new EventEmitter().setMaxListeners(100);
  #moved = new WeakMap<Sql, Map<string, TaskState>>();
  constructor(
    public readonly db: Database,
    private options: {
      concurrency: number;
      redact?: (text: string) => string;
      limits?: Partial<Record<Capability, number>>;
    } = {
      concurrency: 2,
    },
  ) {}

  async locked<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const moved = new Map<string, TaskState>();
    const value = await this.db.transaction(async (tx) => {
      this.#moved.set(tx, moved);
      await tx.query("SELECT id FROM scheduler_lock WHERE id=1 FOR UPDATE");
      return fn(tx);
    });
    for (const [id, status] of moved) this.changes.emit("change", { id, status } as TaskChange);
    return value;
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
    const id = randomUUID();
    // Every caller holds the scheduler lock, so the previous event is stable.
    const previous = (
      await tx.query<{ id: string }>(
        "SELECT envelope->>'messageId' AS id FROM events WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1",
        [task.id],
      )
    ).rows[0];
    const envelope = EnvelopeSchema.parse({
      protocolVersion: 1,
      messageId: id,
      correlationId: task.correlation_id,
      causationId: previous?.id ?? null,
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
    await tx.query("INSERT INTO events(task_id,envelope) VALUES ($1,$2)", [
      task.id,
      JSON.stringify(envelope),
    ]);
  }
  async move(tx: Sql, task: Task, state: TaskState, reason: string): Promise<void> {
    invariant(canTransition(task.status, state), "INVALID_TRANSITION");
    await tx.query("UPDATE tasks SET status=$2 WHERE id=$1", [task.id, state]);
    await this.event(tx, task, "task.transition", { from: task.status, to: state, reason });
    task.status = state;
    this.#moved.get(tx)?.set(task.id, state);
  }
  async create(raw: unknown, key: string, principal: string): Promise<Task> {
    return this.locked((tx) => this.createIn(tx, raw, key, principal));
  }
  // For callers already holding the scheduler lock: the task commits or rolls back with them.
  async createIn(tx: Sql, raw: unknown, key: string, principal: string): Promise<Task> {
    invariant(key.length >= 1 && key.length <= 200, "INVALID_IDEMPOTENCY_KEY", 400);
    const spec = TaskSpecSchema.parse(raw);
    const prior = (
      await tx.query<Task & { request_hash: string }>(
        "SELECT * FROM tasks WHERE principal=$1 AND idempotency_key=$2",
        [principal, key],
      )
    ).rows[0];
    if (prior) {
      invariant(prior.request_hash === fingerprint(spec), "IDEMPOTENCY_CONFLICT");
      return prior;
    }
    invariant(Date.parse(spec.deadline) > Date.now(), "DEADLINE_EXPIRED", 400);
    const queued = (
      await tx.query<{ total: string; mine: string }>(
        "SELECT count(*) AS total, count(*) FILTER (WHERE principal=$1) AS mine FROM tasks WHERE status IN ('READY','WAITING_FOR_DEPENDENCY','WAITING_FOR_APPROVAL')",
        [principal],
      )
    ).rows[0];
    // Automation ingress gets its own quota so it cannot crowd out the operator.
    invariant(
      Number(queued?.total) < 1000 && (principal === "operator" || Number(queued?.mine) < 100),
      "QUEUE_FULL",
      429,
    );
    for (const dependency of spec.dependencies) await this.get(dependency, tx);
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
    await tx.query(
      "INSERT INTO tasks(id,correlation_id,principal,idempotency_key,request_hash,spec,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'CREATED',$7)",
      [
        id,
        randomUUID(),
        principal,
        key,
        fingerprint(spec),
        JSON.stringify({ ...spec, context: [] }),
        Date.now(),
      ],
    );
    const task = await this.get(id, tx);
    for (const entry of spec.context)
      await insertContext(tx, task, entry, this.options.redact ?? ((text) => text));
    for (const dependency of spec.dependencies)
      await tx.query(
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
  async claim(owner: string, leaseMs: number): Promise<Task | null> {
    return this.locked(async (tx) => {
      const active = (
        await tx.query<{ count: string }>(
          "SELECT count(*) FROM tasks WHERE status IN ('RUNNING','VERIFYING')",
        )
      ).rows[0];
      if (Number(active?.count) >= this.options.concurrency) return null;
      const candidates = (
        await tx.query<Task>(
          "SELECT * FROM tasks WHERE status IN ('READY','WAITING_FOR_DEPENDENCY') AND not_before<=$1 ORDER BY created_at,id LIMIT 1000",
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
      const activeByCapability = new Map(
        (
          await tx.query<{ capability: Capability; count: string }>(
            "SELECT spec->>'capability' AS capability,count(*) FROM tasks WHERE status IN ('RUNNING','VERIFYING') GROUP BY 1",
          )
        ).rows.map((row) => [row.capability, Number(row.count)]),
      );
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
        if (deps.some((status) => status !== "COMPLETED")) continue;
        const defaults = {
          "text.generate": 2,
          "browser.extract": 1,
          "workflow.invoke": 1,
          "desktop.act": 1,
          "info.fetch": 2,
        };
        const limit = this.options.limits?.[task.spec.capability] ?? defaults[task.spec.capability];
        if ((activeByCapability.get(task.spec.capability) ?? 0) >= limit) continue;
        if (task.status === "WAITING_FOR_DEPENDENCY")
          await this.move(tx, task, "READY", "dependencies completed");
        await this.move(tx, task, "RUNNING", "lease acquired");
        await tx.query(
          "UPDATE tasks SET owner=$2, fence=fence+1, lease_until=$3, attempt=attempt+1 WHERE id=$1",
          [task.id, owner, Date.now() + leaseMs],
        );
        return this.get(task.id, tx);
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
  async release(tx: Sql, id: string): Promise<void> {
    await tx.query("UPDATE tasks SET owner=NULL,lease_until=NULL WHERE id=$1", [id]);
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
      const pending =
        (await tx.query("SELECT id FROM actions WHERE task_id=$1 AND status='EXECUTING'", [id]))
          .rows.length > 0;
      await tx.query("UPDATE tasks SET fence=fence+1 WHERE id=$1", [id]);
      if (pending) await this.quarantine(tx, task, "operator cancellation during external action");
      else {
        await this.move(tx, task, "CANCELLED", "operator cancellation");
        await this.release(tx, id);
      }
      return task;
    });
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
        const intents = (
          await tx.query("SELECT id FROM actions WHERE task_id=$1 AND status='EXECUTING'", [
            task.id,
          ])
        ).rows;
        if (intents.length || task.status === "VERIFYING")
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
