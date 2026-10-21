import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { type CompiledStep, catalog, type Lang, narrate } from "@jarvis/action-engine";
import { IntegrationError, type IntegrationHub } from "@jarvis/integration-hub";
import { CoreError, fingerprint, invariant } from "../../core/contracts.js";
import type { Sql } from "../../core/database.js";
import { planApprovalMs } from "../../core/gateway.js";
import type { TaskChange, TaskService } from "../../core/tasks.js";
import { runText } from "../../core/text-task.js";
import { type Durations, durationKey, finisherOf } from "../eta.js";
import type { Announcement } from "../narrator.js";
import type { PermissionMode, PermissionService } from "../permissions.js";
import { composeResult, type FinisherContext, failPlan } from "./finishers.js";
import {
  active,
  ended,
  type Outcome,
  type PlanRow,
  type PlanStatus,
  type PlanView,
  planWindowMs,
  replyWaitMs,
  type StepTask,
  stepWindowMs,
  type WorkingMemory,
} from "./model.js";
import { planView, type ViewContext } from "./view.js";
import { statusSay, workingMemory } from "./working-memory.js";

// Plans are the operator-facing unit over step tasks: admission, approval, status, narration.
export class PlanService extends EventEmitter {
  #seen = new Map<string, string>();
  #finishing = new Set<string>();
  // When Core first saw each step task running, and when each plan's finisher started.
  #stepStarted = new Map<string, number>();
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #finishStarted = new Map<string, number>();
  #refreshing: Promise<void> | undefined;
  #again = false;
  // Any plan running or awaiting approval at the last refresh (sets the poll cadence).
  #active = true;
  #creating = Promise.resolve();
  #viewContext: ViewContext;
  #finisher: FinisherContext;
  constructor(
    private options: {
      tasks: TaskService;
      wake(): void;
      onCancel(taskId: string): void;
      conversationProviders: string[];
      privateProviders: string[];
      integrations?: IntegrationHub;
      // Operator-approved long-term memory actions are enabled.
      memory?: boolean;
      // The operator's per-action decisions from Settings; absent means catalog risk decides.
      permissions?: Pick<PermissionService, "mode" | "denied">;
      // Catalog actions this configuration can run at all (desktop, news, integrations...).
      available?: () => ReadonlySet<string>;
      // The operator picked one of several on-screen candidates (learning signal).
      onChoice?: (target: string, candidates: string[], chosen: string) => void;
      // Text summary of the current screen for a replan (window and element names).
      screen?: () => Promise<string>;
      // Measured durations: learned here, used for ETAs and pacing the spoken reply.
      durations?: Durations;
    },
  ) {
    super();
    // Up to 8 desktop streams, the conversation's learning hook and each waiting turn listen.
    this.setMaxListeners(50);
    this.#viewContext = {
      modeOf: (step) => this.modeOf(step),
      progressOf: (id) => options.tasks.progressOf(id),
      stepStartedAt: (id) => this.#stepStarted.get(id),
      finishStartedAt: (id) => this.#finishStarted.get(id),
      ...(options.durations && { durations: options.durations }),
    };
    this.#finisher = {
      tasks: options.tasks,
      privateProviders: options.privateProviders,
      ...(options.screen && { screen: options.screen }),
      text: (plan, label, prompt, privacy, json) => this.#text(plan, label, prompt, privacy, json),
      settle: (plan, status, outcome, flags) => this.#settle(plan, status, outcome, flags),
      create: (input, flags) => this.#create(input, flags),
      outcome: (text, lang, planId) => this.#outcome(text, lang, planId),
      optionalActions: () => this.optionalActions(),
      availableActions: () => this.availableActions(),
      browserUrls: () => this.browserUrls(),
      deniedActions: () => this.deniedActions(),
    };
  }

  integrationCapabilities(): string[] {
    return this.options.integrations?.available() ?? [];
  }
  browserUrls(): readonly string[] {
    return this.options.integrations?.browserUrls ?? [];
  }
  // Catalog actions offered beyond desktop and info: enabled integrations and memory, minus
  // anything the operator turned off.
  optionalActions(): string[] {
    const denied = this.deniedActions();
    return [
      ...this.integrationCapabilities(),
      ...(this.options.memory ? ["memory.save", "memory.forget"] : []),
    ].filter((action) => !denied.includes(action));
  }
  deniedActions(): string[] {
    return [...(this.options.permissions?.denied() ?? [])].sort();
  }
  availableActions(): string[] {
    return Object.keys(catalog).filter((action) => this.offers(action));
  }
  // Could a plan with this action run here and now: known, configured and not turned off.
  offers(action: string): boolean {
    if (!Object.hasOwn(catalog, action) || this.modeOf({ action, risk: "LOW" }) === "deny")
      return false;
    const kind = catalog[action]?.kind;
    if (kind === "integration") return this.integrationCapabilities().includes(action);
    if (kind === "memory") return this.options.memory === true;
    return this.options.available ? this.options.available().has(action) : true;
  }

  // What Core knows right now, for the model's working memory.
  workingMemory(): Promise<WorkingMemory> {
    return workingMemory(this.options.tasks.db, (id) => this.get(id));
  }

  // "Ne yapıyorsun?" answered from plan records.
  async statusSay(lang: Lang): Promise<string> {
    return statusSay(await this.workingMemory(), lang);
  }

  // ask: the plan waits for a tap; allow: it runs; deny: it is refused.
  modeOf(step: Pick<CompiledStep, "action" | "risk">): PermissionMode {
    return this.options.permissions?.mode(step.action) ?? (step.risk === "LOW" ? "allow" : "ask");
  }

  // How long this plan is expected to take, end to end, from what Core measured.
  expectedMs(
    steps: readonly { action: string; args: Record<string, unknown> }[],
  ): number | undefined {
    return this.options.durations?.plan(steps);
  }

  propose(input: {
    turnId: string;
    goal: string;
    lang: Lang;
    steps: CompiledStep[];
  }): Promise<PlanView> {
    return this.#create(input, { approved: false, replanned: false });
  }

  async approve(id: string, hash: string): Promise<void> {
    await this.options.tasks.locked(async (tx) => {
      const plan = await this.#row(id, tx);
      invariant(
        plan.status === "AWAITING_APPROVAL" && Date.now() <= Number(plan.expires_at),
        "PLAN_NOT_PENDING",
      );
      invariant(hash === plan.hash, "PLAN_HASH_MISMATCH");
      await tx.query("UPDATE plans SET status='RUNNING', approved_at=$2 WHERE id=$1", [
        id,
        Date.now(),
      ]);
      await this.#admit(tx, id);
    });
    this.options.wake();
    await this.#publish(id);
  }

  async reject(id: string): Promise<void> {
    const plan = await this.#row(id);
    invariant(plan.status === "AWAITING_APPROVAL", "PLAN_NOT_PENDING");
    await this.#cancel(plan, false);
  }

  async cancel(id: string): Promise<void> {
    const plan = await this.#row(id);
    invariant(!ended.has(plan.status), "PLAN_NOT_ACTIVE");
    await this.#cancel(plan, false);
  }

  // Stops the active desktop plan; the caller speaks the returned view's outcome itself.
  async cancelActive(): Promise<PlanView | null> {
    const plan = (
      await this.options.tasks.db.query<PlanRow>(
        `SELECT * FROM plans WHERE kind IN ('desktop','integration') AND ${active} ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0];
    if (!plan) return null;
    await this.#cancel(plan, true);
    return this.get(plan.id);
  }

  // The operator picked one of several on-screen matches: a clarification, not an approval.
  async choose(id: string, index: number): Promise<PlanView> {
    const plan = await this.options.tasks.locked(async (tx) => {
      const plan = await this.#row(id, tx);
      const candidates = plan.outcome?.candidates;
      invariant(plan.status === "FAILED" && candidates, "PLAN_NOT_CHOOSING");
      invariant(!plan.continued, "PLAN_ALREADY_CONTINUED");
      invariant(
        Number.isInteger(index) && index >= 1 && index <= candidates.items.length,
        "CANDIDATE_OUT_OF_RANGE",
        400,
      );
      await tx.query("UPDATE plans SET continued=true WHERE id=$1", [id]);
      return plan;
    });
    const { index: at, items } = plan.outcome?.candidates ?? { index: 0, items: [] };
    const failed = plan.steps[at] as CompiledStep;
    const chosen = items[index - 1];
    if (typeof failed.args.target === "string" && chosen)
      this.options.onChoice?.(failed.args.target, items, chosen);
    const steps = [
      { ...failed, args: { ...failed.args, target: items[index - 1] } },
      ...plan.steps.slice(at + 1),
    ];
    // Within the plan's approval window the operator's tap still holds; later it asks again.
    const approved =
      plan.approved_at !== null && Date.now() <= Number(plan.approved_at) + planApprovalMs;
    try {
      return await this.#create(
        { turnId: plan.turn_id, goal: plan.goal, lang: plan.lang, steps },
        { approved, replanned: plan.replanned },
      );
    } catch (error) {
      // The pick stays open: the operator can choose again once the cause is gone.
      await this.options.tasks.db.query("UPDATE plans SET continued=false WHERE id=$1", [id]);
      throw error;
    }
  }

  // The newest plan, if it just stopped on several on-screen matches the operator may pick
  // from by voice ("ikincisi"). Older plans or other outcomes are not a pending choice.
  async pendingChoice(): Promise<{ id: string; count: number; lang: Lang } | null> {
    const plan = (
      await this.options.tasks.db.query<PlanRow>(
        "SELECT * FROM plans ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    const items = plan?.outcome?.candidates?.items;
    if (
      !plan ||
      !items?.length ||
      plan.status !== "FAILED" ||
      plan.continued ||
      Date.now() - Number(plan.created_at) > planWindowMs
    )
      return null;
    return { id: plan.id, count: items.length, lang: plan.lang };
  }

  async get(id: string): Promise<PlanView> {
    const plan = await this.#row(id);
    return planView(plan, await this.#stepTasks(plan), this.#viewContext);
  }

  // Waits until the plan ends or needs the operator, or until `ms` passes. Task transitions
  // and plan updates wake it; the short poll is only a safety net.
  async waitSettled(id: string, ms: number): Promise<PlanView> {
    const end = Date.now() + ms;
    let dirty = false;
    let resume = () => {};
    const poke = () => {
      dirty = true;
      resume();
    };
    const onPlan = (view: PlanView) => {
      if (view.id === id) poke();
    };
    const onChange = (change: TaskChange) => {
      if (change.planId === id) poke();
    };
    this.options.tasks.changes.on("change", onChange);
    this.on("plan", onPlan);
    try {
      for (;;) {
        dirty = false;
        await this.refresh();
        const view = await this.get(id);
        if (view.status !== "RUNNING" || Date.now() >= end) return view;
        if (!dirty)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.min(200, Math.max(1, end - Date.now())));
            resume = () => {
              clearTimeout(timer);
              resolve();
            };
          });
      }
    } finally {
      this.options.tasks.changes.off("change", onChange);
      this.off("plan", onPlan);
    }
  }

  // The turn reply narrates the outcome; true means no announcement will repeat it.
  async claimNarration(id: string): Promise<boolean> {
    return (
      (
        await this.options.tasks.db.query(
          "UPDATE plans SET narrated=true WHERE id=$1 AND narrated=false RETURNING id",
          [id],
        )
      ).rows.length > 0
    );
  }

  // Single flight; a request arriving mid-refresh runs one more pass so no change is missed.
  refresh(): Promise<void> {
    if (this.#refreshing) {
      this.#again = true;
      return this.#refreshing;
    }
    this.#refreshing = (async () => {
      do {
        this.#again = false;
        this.#active = await this.#refresh();
      } while (this.#again);
    })().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  start(signal: AbortSignal): void {
    const failed = () => {
      process.stderr.write('{"level":"error","code":"PLAN_REFRESH_FAILED"}\n');
    };
    // A plan step's transition refreshes plans at once; other tasks (spoken turns, API tasks)
    // never touch plan state, so they do not cost a refresh. The poll covers expiries.
    const onChange = (change: TaskChange) => {
      if (change.planId) void this.refresh().catch(failed);
    };
    // A step reporting where it looks updates its plan card and narration at once.
    const onProgress = () => void this.refresh().catch(failed);
    this.options.tasks.changes.on("change", onChange);
    this.options.tasks.progress.on("progress", onProgress);
    signal.addEventListener(
      "abort",
      () => {
        this.options.tasks.changes.off("change", onChange);
        this.options.tasks.progress.off("progress", onProgress);
        for (const timer of this.#timers) clearTimeout(timer);
      },
      { once: true },
    );
    void (async () => {
      while (!signal.aborted) {
        await this.refresh().catch(failed);
        // Idle, a slower poll is enough: new plans and step transitions refresh at once.
        await delay(this.#active ? 500 : 2000, undefined, { signal }).catch(() => {});
      }
    })();
  }

  #create(
    input: { turnId: string; goal: string; lang: Lang; steps: CompiledStep[] },
    flags: { approved: boolean; replanned: boolean; originCreatedAt?: number },
  ): Promise<PlanView> {
    const next = this.#creating
      .then(() => this.#createNow(input, flags))
      .catch((error: unknown) => {
        if (error instanceof IntegrationError) throw new CoreError(error.code, 400);
        throw error;
      });
    this.#creating = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  async #createNow(
    input: { turnId: string; goal: string; lang: Lang; steps: CompiledStep[] },
    flags: { approved: boolean; replanned: boolean; originCreatedAt?: number },
  ): Promise<PlanView> {
    const kind = input.steps.some((step) => step.kind === "desktop")
      ? "desktop"
      : input.steps.some((step) => step.kind === "integration")
        ? "integration"
        : "info";
    for (const step of input.steps) {
      invariant(this.modeOf(step) !== "deny", "ACTION_DENIED", 403);
      invariant(step.kind !== "memory" || this.options.memory, "MEMORY_DISABLED", 400);
      if (step.kind === "integration") {
        invariant(this.options.integrations, "INTEGRATION_DISABLED", 400);
        this.options.integrations.compile(step.action, step.args);
      }
      invariant(this.offers(step.action), "ACTION_UNAVAILABLE", 400);
    }
    // Admission is serialized within this Core; multiple Core hosts need a shared plan lock.
    if (kind === "desktop" && flags.originCreatedAt !== undefined) {
      const newer = await this.options.tasks.db.query(
        `SELECT id FROM plans WHERE kind='desktop' AND ${active} AND created_at >= $1 LIMIT 1`,
        [flags.originCreatedAt],
      );
      if (newer.rows.length) throw new CoreError("STALE_REPLAN");
    }
    if (kind === "desktop")
      for (const plan of (
        await this.options.tasks.db.query<PlanRow>(
          `SELECT * FROM plans WHERE kind='desktop' AND ${active}`,
        )
      ).rows)
        await this.#cancel(plan, true);
    // Steps the operator allowed in Settings need no tap; one "ask" step makes the plan wait.
    const needsApproval =
      !flags.approved && input.steps.some((step) => this.modeOf(step) === "ask");
    const id = randomUUID();
    const now = Date.now();
    await this.options.tasks.locked(async (tx) => {
      await tx.query(
        "INSERT INTO plans(id,turn_id,goal,lang,kind,steps,hash,status,task_ids,created_at,expires_at,approved_at,replanned) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'[]',$9,$10,$11,$12)",
        [
          id,
          input.turnId,
          input.goal,
          input.lang,
          kind,
          JSON.stringify(input.steps),
          fingerprint(input.steps),
          needsApproval ? "AWAITING_APPROVAL" : "RUNNING",
          now,
          now + planApprovalMs,
          flags.approved ? now : null,
          flags.replanned,
        ],
      );
      // An unapproved plan has no tasks, so none of its steps can run before the tap.
      if (!needsApproval) await this.#admit(tx, id);
    });
    if (!needsApproval) this.options.wake();
    return this.#publish(id);
  }

  // One Core task per step, chained, bound to the plan for the gateway's MEDIUM rule.
  async #admit(tx: Sql, id: string): Promise<void> {
    const plan = await this.#row(id, tx);
    const ids: string[] = [];
    const started = Date.now();
    let elapsed = 0;
    for (const [index, step] of plan.steps.entries()) {
      const desktop = step.kind === "desktop";
      const memory = step.kind === "memory";
      const external =
        step.kind === "integration"
          ? this.options.integrations?.compile(step.action, step.args)
          : undefined;
      invariant(step.kind !== "integration" || external, "INTEGRATION_DISABLED", 400);
      const duration =
        external?.budget.maxDurationMs ?? (desktop || memory ? stepWindowMs : planWindowMs);
      const conditionalDependency = step.when ? ids[step.when.step - 1] : undefined;
      invariant(!step.when || conditionalDependency, "INVALID_CONDITION", 400);
      elapsed += duration;
      const task = await this.options.tasks.createIn(
        tx,
        {
          objective: external?.objective ?? `${plan.goal}: ${step.action}`,
          capability:
            external?.capability ??
            (desktop ? "desktop.act" : memory ? "memory.write" : "info.fetch"),
          input: external?.input ?? { action: step.action, args: step.args },
          providers: external?.providers ?? [desktop ? "windows-mcp" : memory ? "memory" : "news"],
          risk: external?.risk ?? step.risk,
          privacy: external?.privacy ?? "personal",
          // Tasks share admission time; later steps must retain their dependency wait budget.
          budget: {
            ...(external?.budget ?? { maxCalls: 1 }),
            maxDurationMs: Math.min(elapsed, planWindowMs),
          },
          deadline: new Date(started + Math.min(elapsed, planWindowMs)).toISOString(),
          dependencies: [
            ...new Set([
              ...ids.slice(-1),
              ...(conditionalDependency ? [conditionalDependency] : []),
            ]),
          ],
          ...(step.when && {
            condition: {
              dependencyId: conditionalDependency,
              contains: step.when.contains,
              ...(step.when.not !== undefined && { not: step.when.not }),
            },
          }),
          verification: external?.verification ?? { kind: "contains", value: '"ok":true' },
          planId: id,
        },
        `plan:${id}:${index}`,
        "operator",
      );
      ids.push(task.id);
    }
    await tx.query("UPDATE plans SET task_ids=$2 WHERE id=$1", [id, JSON.stringify(ids)]);
  }

  async #row(id: string, tx: Sql = this.options.tasks.db): Promise<PlanRow> {
    const plan = (await tx.query<PlanRow>("SELECT * FROM plans WHERE id=$1", [id])).rows[0];
    invariant(plan, "PLAN_NOT_FOUND", 404);
    return plan;
  }

  async #stepTasks(plan: PlanRow): Promise<(StepTask | undefined)[]> {
    const rows = (
      await this.options.tasks.db.query<StepTask>(
        "SELECT t.id,t.status,t.result,(SELECT jsonb_build_object('id',a.id,'target',a.target) FROM actions a WHERE a.task_id=t.id AND a.status='AWAITING_APPROVAL' LIMIT 1) AS approval FROM tasks t WHERE t.id = ANY($1::uuid[])",
        [plan.task_ids],
      )
    ).rows;
    return plan.task_ids.map((id) => rows.find((row) => row.id === id));
  }

  // Step durations as Core observes them: first seen running to completed.
  #time(plan: PlanRow, tasks: (StepTask | undefined)[]): void {
    const now = Date.now();
    tasks.forEach((task, index) => {
      if (!task) return;
      const started = this.#stepStarted.get(task.id);
      if (task.status === "RUNNING" || task.status === "VERIFYING") {
        if (started === undefined) this.#stepStarted.set(task.id, now);
        return;
      }
      if (started === undefined) return;
      this.#stepStarted.delete(task.id);
      const step = plan.steps[index];
      if (task.status === "COMPLETED" && step) {
        const { key, units } = durationKey(step);
        this.options.durations?.record(key, (now - started) / units);
      }
    });
  }

  // Emits the view when it changed since it was last emitted.
  async #publish(id: string): Promise<PlanView> {
    return this.#emitChanged(await this.get(id));
  }
  #emitChanged(view: PlanView): PlanView {
    const seen = JSON.stringify(view);
    if (this.#seen.get(view.id) !== seen) {
      this.#seen.set(view.id, seen);
      this.emit("plan", view);
    }
    if (ended.has(view.status)) this.#seen.delete(view.id);
    return view;
  }

  // Compare-and-set on the status the caller saw, so concurrent settlers end a plan once.
  async #settle(
    plan: PlanRow,
    status: PlanStatus,
    outcome: Outcome,
    flags: { narrated?: boolean; replanned?: boolean } = {},
  ): Promise<boolean> {
    const updated = await this.options.tasks.db.query(
      "UPDATE plans SET status=$2, outcome=$3, narrated=narrated OR $4, replanned=replanned OR $5 WHERE id=$1 AND status=$6 RETURNING id",
      [
        plan.id,
        status,
        JSON.stringify(outcome),
        flags.narrated ?? false,
        flags.replanned ?? false,
        plan.status,
      ],
    );
    if (updated.rows.length) {
      for (const taskId of plan.task_ids) this.#stepStarted.delete(taskId);
      this.#finishStarted.delete(plan.id);
      await this.#publish(plan.id);
      // Its announcement is due once the turn's reply window has passed.
      const due = Number(plan.created_at) + replyWaitMs - Date.now();
      if (!flags.narrated && due > 0) {
        const timer = setTimeout(() => {
          this.#timers.delete(timer);
          void this.refresh().catch(() => {});
        }, due + 20);
        timer.unref?.();
        this.#timers.add(timer);
      }
    }
    return updated.rows.length > 0;
  }

  async #cancel(plan: PlanRow, silent: boolean): Promise<void> {
    for (const taskId of plan.task_ids) {
      // A task already settled or uncertain keeps its state.
      await this.options.tasks.cancel(taskId).catch(() => {});
      this.options.onCancel(taskId);
    }
    const uncertain = (await this.#stepTasks(plan)).some(
      (task) => task?.status === "RECOVERY_REQUIRED",
    );
    await this.#settle(
      plan,
      uncertain ? "RECOVERY_REQUIRED" : "CANCELLED",
      { say: narrate({ type: uncertain ? "plan-uncertain" : "cancelled" }, plan.lang) },
      { narrated: silent },
    );
  }

  async #refresh(): Promise<boolean> {
    const { db } = this.options.tasks;
    const plans = (
      await db.query<PlanRow>(`SELECT * FROM plans WHERE ${active} ORDER BY created_at`)
    ).rows;
    for (const plan of plans) {
      if (plan.status === "AWAITING_APPROVAL") {
        if (Date.now() > Number(plan.expires_at)) await this.#cancel(plan, false);
        continue;
      }
      const tasks = await this.#stepTasks(plan);
      this.#time(plan, tasks);
      const states = tasks.map((task) => task?.status);
      const say = (type: "plan-uncertain" | "plan-failed") => ({
        say: narrate({ type }, plan.lang),
      });
      if (states.includes("RECOVERY_REQUIRED"))
        await this.#settle(plan, "RECOVERY_REQUIRED", say("plan-uncertain"));
      else if (states.every((state) => state === "COMPLETED" || state === "SKIPPED"))
        this.#detach(plan, () => this.#finish(plan, tasks));
      else if (states.includes("WAITING_FOR_APPROVAL")) {
        // Every exact action approval stays actionable; task deadlines still bound the wait.
        await this.#publish(plan.id);
      } else if (
        states.some(
          (state) => state === "FAILED" || state === "CANCELLED" || state === "BLOCKED",
        ) &&
        !states.some((state) => state === "RUNNING" || state === "VERIFYING")
      )
        this.#detach(plan, () => failPlan(this.#finisher, plan, tasks));
      // Steady state: the rows just read are current, no second read.
      else this.#emitChanged(planView(plan, tasks, this.#viewContext));
    }
    await this.#announce();
    return plans.length > 0;
  }

  #detach(plan: PlanRow, work: () => Promise<void>): void {
    if (this.#finishing.has(plan.id)) return;
    this.#finishing.add(plan.id);
    void work()
      .catch(() => {
        process.stderr.write('{"level":"error","code":"PLAN_FINISH_FAILED"}\n');
      })
      .finally(() => this.#finishing.delete(plan.id));
  }

  // A spoken text from a finisher; null when no provider may take it, it fails or is unusable.
  async #text(
    plan: PlanRow,
    label: string,
    prompt: string,
    privacy: "personal" | "private",
    json = false,
  ): Promise<string | null> {
    const providers =
      privacy === "private" ? this.options.privateProviders : this.options.conversationProviders;
    if (!providers.length) return null;
    try {
      const { text } = await runText(
        this.options.tasks,
        () => this.options.wake(),
        {
          prompt,
          providers,
          privacy,
          deadlineMs: privacy === "private" ? 60_000 : 20_000,
          maxOutputTokens: 600,
          json,
        },
        `plan:${plan.id}:${label}`,
      );
      return text;
    } catch {
      return null;
    }
  }

  async #finish(plan: PlanRow, tasks: (StepTask | undefined)[]): Promise<void> {
    const finisher = finisherOf(plan.steps);
    if (!finisher) {
      await composeResult(this.#finisher, plan, tasks);
      return;
    }
    const started = Date.now();
    this.#finishStarted.set(plan.id, started);
    await this.#publish(plan.id);
    // Only a spoken result a model composed is a finisher run worth learning from.
    if (await composeResult(this.#finisher, plan, tasks))
      this.options.durations?.record(`finish:${finisher}`, Date.now() - started);
  }

  // Each ended plan is spoken once, after the turn had its chance to narrate it.
  async #announce(): Promise<void> {
    const now = Date.now();
    const due = await this.options.tasks.db.query<{
      id: string;
      lang: Lang;
      outcome: Outcome | null;
    }>(
      "UPDATE plans SET narrated=true WHERE narrated=false AND status IN ('COMPLETED','FAILED','CANCELLED','RECOVERY_REQUIRED') AND created_at<=$1 AND created_at>$2 RETURNING id,lang,outcome",
      [now - replyWaitMs, now - 600_000],
    );
    for (const { id, lang, outcome } of due.rows)
      if (outcome?.say) this.#outcome(outcome.say, lang, id);
  }
  #outcome(text: string, lang: Lang, planId: string): void {
    const announcement: Announcement = { text, lang, kind: "outcome", planId };
    this.emit("announce", announcement);
  }
}
