import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  briefPrompt,
  type CompiledStep,
  describePrompt,
  type Evidence,
  type Lang,
  narrate,
  type Panel,
  readBrief,
  readIntent,
  replanPrompt,
} from "@jarvis/action-engine";
import { IntegrationError, type IntegrationHub } from "@jarvis/integration-hub";
import {
  CoreError,
  type ExecutionResult,
  fingerprint,
  invariant,
  type TaskState,
} from "./contracts.js";
import type { Sql } from "./database.js";
import { planApprovalMs } from "./gateway.js";
import type { TaskService } from "./tasks.js";
import { runText } from "./text-task.js";

export type PlanStatus =
  | "AWAITING_APPROVAL"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RECOVERY_REQUIRED";
export type PlanPanel = Panel | { type: "candidates"; planId: string; items: string[] };
export type PlanView = {
  id: string;
  goal: string;
  lang: Lang;
  kind: "desktop" | "info" | "integration";
  status: PlanStatus;
  hash: string;
  needsApproval: boolean;
  expiresAt: number;
  steps: {
    action: string;
    args: Record<string, unknown>;
    risk: CompiledStep["risk"];
    status: TaskState;
    evidence?: Evidence;
    approval?: { id: string; target: string };
  }[];
  panels: PlanPanel[];
  say?: string;
};
type Outcome = { say: string; candidates?: { index: number; items: string[] } };
type PlanRow = {
  id: string;
  turn_id: string;
  goal: string;
  lang: Lang;
  kind: "desktop" | "info" | "integration";
  steps: CompiledStep[];
  hash: string;
  status: PlanStatus;
  task_ids: string[];
  created_at: string | number;
  expires_at: string | number;
  approved_at: string | number | null;
  narrated: boolean;
  continued: boolean;
  replanned: boolean;
  outcome: Outcome | null;
};
type StepTask = {
  id: string;
  status: TaskState;
  result: ExecutionResult | null;
  approval: { id: string; target: string } | null;
};

// A spoken turn may narrate a quick outcome itself; announcements wait this long for it.
export const replyWaitMs = 5000;
const stepWindowMs = 15_000;
const planWindowMs = 120_000;
const active = "status IN ('AWAITING_APPROVAL','RUNNING')";
const ended = new Set<PlanStatus>(["COMPLETED", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"]);

function evidenceOf(task: StepTask | undefined): Evidence | undefined {
  if (!task?.result) return undefined;
  try {
    const value = JSON.parse(task.result.text) as Evidence;
    return typeof value?.ok === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}
// Models wrap JSON in fences or prose.
function jsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined;
  } catch {
    return undefined;
  }
}

// Plans are the operator-facing unit over step tasks: admission, approval, status, narration.
export class PlanService extends EventEmitter {
  #seen = new Map<string, string>();
  #finishing = new Set<string>();
  #refreshing: Promise<void> | undefined;
  #creating = Promise.resolve();
  constructor(
    private options: {
      tasks: TaskService;
      wake(): void;
      onCancel(taskId: string): void;
      conversationProviders: string[];
      privateProviders: string[];
      integrations?: IntegrationHub;
      // Text summary of the current screen for a replan (window and element names).
      screen?: () => Promise<string>;
    },
  ) {
    super();
  }

  integrationCapabilities(): string[] {
    return this.options.integrations?.available() ?? [];
  }
  browserUrls(): readonly string[] {
    return this.options.integrations?.browserUrls ?? [];
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
    const steps = [
      { ...failed, args: { ...failed.args, target: items[index - 1] } },
      ...plan.steps.slice(at + 1),
    ];
    // Within the plan's approval window the operator's tap still holds; later it asks again.
    const approved =
      plan.approved_at !== null && Date.now() <= Number(plan.approved_at) + planApprovalMs;
    return this.#create(
      { turnId: plan.turn_id, goal: plan.goal, lang: plan.lang, steps },
      { approved, replanned: plan.replanned },
    );
  }

  async get(id: string): Promise<PlanView> {
    const plan = await this.#row(id);
    return this.#view(plan, await this.#stepTasks(plan));
  }

  // Waits until the plan ends or needs the operator, or until `ms` passes.
  async waitSettled(id: string, ms: number): Promise<PlanView> {
    const end = Date.now() + ms;
    for (;;) {
      await this.refresh();
      const view = await this.get(id);
      if (view.status !== "RUNNING" || Date.now() >= end) return view;
      await delay(50);
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

  refresh(): Promise<void> {
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  start(signal: AbortSignal): void {
    void (async () => {
      while (!signal.aborted) {
        await this.refresh().catch(() => {
          process.stderr.write('{"level":"error","code":"PLAN_REFRESH_FAILED"}\n');
        });
        await delay(300, undefined, { signal }).catch(() => {});
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
      if (step.kind !== "integration") continue;
      invariant(this.options.integrations, "INTEGRATION_DISABLED", 400);
      this.options.integrations.compile(step.action, step.args);
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
    const needsApproval = !flags.approved && input.steps.some((step) => step.risk !== "LOW");
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
      const external =
        step.kind === "integration"
          ? this.options.integrations?.compile(step.action, step.args)
          : undefined;
      invariant(step.kind !== "integration" || external, "INTEGRATION_DISABLED", 400);
      const duration = external?.budget.maxDurationMs ?? (desktop ? stepWindowMs : planWindowMs);
      elapsed += duration;
      const task = await this.options.tasks.createIn(
        tx,
        {
          objective: external?.objective ?? `${plan.goal}: ${step.action}`,
          capability: external?.capability ?? (desktop ? "desktop.act" : "info.fetch"),
          input: external?.input ?? { action: step.action, args: step.args },
          providers: external?.providers ?? [desktop ? "windows-mcp" : "news"],
          risk: external?.risk ?? step.risk,
          privacy: external?.privacy ?? "personal",
          budget: external?.budget ?? { maxCalls: 1, maxDurationMs: duration },
          deadline: new Date(started + Math.min(elapsed, planWindowMs)).toISOString(),
          dependencies: ids.slice(-1),
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

  #view(plan: PlanRow, tasks: (StepTask | undefined)[]): PlanView {
    const steps = plan.steps.map((step, index) => {
      const task = tasks[index];
      const evidence = evidenceOf(task);
      const status: TaskState =
        task?.status ??
        (plan.status === "AWAITING_APPROVAL" ? "WAITING_FOR_APPROVAL" : "CANCELLED");
      return {
        action: step.action,
        args: step.args,
        risk: step.risk,
        status,
        ...(evidence && { evidence }),
        ...(task?.status === "WAITING_FOR_APPROVAL" && task.approval
          ? { approval: task.approval }
          : {}),
      };
    });
    const panels: PlanPanel[] = steps.flatMap((step) =>
      step.evidence?.panel ? [step.evidence.panel] : [],
    );
    if (plan.kind === "integration")
      tasks.forEach((task, index) => {
        const body = task?.result?.text?.trim();
        if (body)
          panels.push({
            type: "text",
            title: steps[index]?.action ?? "Result",
            body: body.slice(0, 4000),
          });
      });
    const candidates = plan.outcome?.candidates;
    if (candidates) panels.push({ type: "candidates", planId: plan.id, items: candidates.items });
    return {
      id: plan.id,
      goal: plan.goal,
      lang: plan.lang,
      kind: plan.kind,
      status: plan.status,
      hash: plan.hash,
      needsApproval: plan.status === "AWAITING_APPROVAL",
      expiresAt: Number(plan.expires_at),
      steps,
      panels,
      ...(plan.outcome?.say && { say: plan.outcome.say }),
    };
  }

  // Emits the view when it changed since it was last emitted.
  async #publish(id: string): Promise<PlanView> {
    const view = await this.get(id);
    const seen = JSON.stringify(view);
    if (this.#seen.get(id) !== seen) {
      this.#seen.set(id, seen);
      this.emit("plan", view);
    }
    if (ended.has(view.status)) this.#seen.delete(id);
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
    if (updated.rows.length) await this.#publish(plan.id);
    return updated.rows.length > 0;
  }

  async #cancel(plan: PlanRow, silent: boolean): Promise<void> {
    for (const taskId of plan.task_ids) {
      this.options.onCancel(taskId);
      // A task already settled or uncertain keeps its state.
      await this.options.tasks.cancel(taskId).catch(() => {});
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

  async #refresh(): Promise<void> {
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
      const states = tasks.map((task) => task?.status);
      const say = (type: "plan-uncertain" | "plan-failed") => ({
        say: narrate({ type }, plan.lang),
      });
      if (states.includes("RECOVERY_REQUIRED"))
        await this.#settle(plan, "RECOVERY_REQUIRED", say("plan-uncertain"));
      else if (states.every((state) => state === "COMPLETED"))
        this.#detach(plan, () => this.#finish(plan, tasks));
      else if (states.includes("WAITING_FOR_APPROVAL")) {
        // External HIGH actions need their own exact Core action approval. Keep the plan
        // active while the operator decides; task deadlines still bound the wait.
        if (plan.steps.some((step) => step.kind === "integration" && step.risk === "HIGH"))
          await this.#publish(plan.id);
        else {
          for (const taskId of plan.task_ids)
            await this.options.tasks.cancel(taskId).catch(() => {});
          await this.#settle(plan, "FAILED", say("plan-failed"));
        }
      } else if (
        states.some(
          (state) => state === "FAILED" || state === "CANCELLED" || state === "BLOCKED",
        ) &&
        !states.some((state) => state === "RUNNING" || state === "VERIFYING")
      )
        this.#detach(plan, () => this.#fail(plan, tasks));
      else await this.#publish(plan.id);
    }
    await this.#announce();
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
    const { lang, steps } = plan;
    const news = steps.findIndex((step) => step.action === "news.brief");
    const describe = steps.findIndex((step) => step.action === "screen.describe");
    if (news >= 0) {
      const panel = evidenceOf(tasks[news])?.panel;
      const items = panel?.type === "news" ? panel.items : [];
      const brief = await this.#text(plan, "brief", briefPrompt(items, lang), "personal");
      const say =
        (brief === null ? null : readBrief(brief)) ??
        narrate({ type: "news-fallback", count: items.length }, lang);
      await this.#settle(plan, "COMPLETED", { say });
      return;
    }
    if (describe >= 0) {
      const question = steps[describe]?.args.question;
      const screen = evidenceOf(tasks[describe])?.observation ?? "";
      const answer = await this.#text(
        plan,
        "describe",
        describePrompt(typeof question === "string" ? question : undefined, screen, lang),
        "private",
      );
      const say = answer === null ? null : readBrief(answer);
      await this.#settle(plan, say === null ? "FAILED" : "COMPLETED", {
        say: say ?? narrate({ type: "plan-failed" }, lang),
      });
      return;
    }
    const [only] = steps;
    const say =
      steps.length === 1 && only
        ? narrate({ type: "step-done", action: only.action, args: only.args }, lang)
        : narrate({ type: "plan-done" }, lang);
    await this.#settle(plan, "COMPLETED", { say });
  }

  async #fail(plan: PlanRow, tasks: (StepTask | undefined)[]): Promise<void> {
    const failedSay = narrate({ type: "plan-failed" }, plan.lang);
    const index = tasks.findIndex((task) =>
      ["FAILED", "CANCELLED", "BLOCKED"].includes(task?.status ?? ""),
    );
    const evidence = evidenceOf(tasks[index]);
    if (evidence?.candidates?.length) {
      await this.#settle(plan, "FAILED", {
        say: narrate({ type: "candidates", count: evidence.candidates.length }, plan.lang),
        candidates: { index, items: evidence.candidates },
      });
      return;
    }
    const step = plan.steps[index];
    if (
      evidence?.evidence !== "observed-failure" ||
      plan.replanned ||
      !this.options.privateProviders.length ||
      !step
    ) {
      await this.#settle(plan, "FAILED", { say: failedSay });
      return;
    }
    // One replan: the failed plan ends silently and the operator hears what follows instead.
    if (
      !(await this.#settle(plan, "FAILED", { say: failedSay }, { narrated: true, replanned: true }))
    )
      return;
    const screen = await this.options.screen?.().catch(() => undefined);
    const text = await this.#text(
      plan,
      "replan",
      replanPrompt({
        goal: plan.goal,
        step: { action: step.action, args: step.args },
        observation: evidence.observation,
        ...(screen ? { screen } : {}),
        enabledIntegrations: this.integrationCapabilities(),
        browserUrls: this.browserUrls(),
      }),
      "private",
      true,
    );
    const read = text === null ? undefined : readIntent(jsonObject(text)?.intent);
    if (read && "decision" in read && read.decision.kind === "plan") {
      try {
        const next = await this.#create(
          {
            turnId: plan.turn_id,
            goal: read.decision.goal,
            lang: plan.lang,
            steps: read.decision.steps,
          },
          { approved: false, replanned: true, originCreatedAt: Number(plan.created_at) },
        );
        if (next.needsApproval)
          this.emit("announce", {
            text: narrate({ type: "proposed", goal: next.goal, needsApproval: true }, plan.lang),
            lang: plan.lang,
          });
      } catch {
        this.emit("announce", { text: failedSay, lang: plan.lang });
      }
    } else this.emit("announce", { text: failedSay, lang: plan.lang });
  }

  // Each ended plan is spoken once, after the turn had its chance to narrate it.
  async #announce(): Promise<void> {
    const now = Date.now();
    const due = await this.options.tasks.db.query<{ lang: Lang; outcome: Outcome | null }>(
      "UPDATE plans SET narrated=true WHERE narrated=false AND status IN ('COMPLETED','FAILED','CANCELLED','RECOVERY_REQUIRED') AND created_at<=$1 AND created_at>$2 RETURNING lang,outcome",
      [now - replyWaitMs, now - 600_000],
    );
    for (const { lang, outcome } of due.rows)
      if (outcome?.say) this.emit("announce", { text: outcome.say, lang });
  }
}
