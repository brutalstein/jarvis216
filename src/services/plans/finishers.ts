import {
  briefPrompt,
  type CompiledStep,
  describePrompt,
  type Lang,
  narrate,
  readBrief,
  readIntent,
  replanPrompt,
  resultBriefPrompt,
} from "@jarvis/action-engine";
import type { TaskService } from "../../core/tasks.js";
import {
  evidenceOf,
  jsonObject,
  type Outcome,
  type PlanRow,
  type PlanStatus,
  type PlanView,
  type StepTask,
} from "./model.js";

// What a plan says when its steps are done (news brief, screen answer, result summary) and
// what happens when a step failed (candidates, one replan). The service supplies the effects.
export type FinisherContext = {
  tasks: TaskService;
  privateProviders: readonly string[];
  screen?: () => Promise<string>;
  text(
    plan: PlanRow,
    label: string,
    prompt: string,
    privacy: "personal" | "private",
    json?: boolean,
  ): Promise<string | null>;
  settle(
    plan: PlanRow,
    status: PlanStatus,
    outcome: Outcome,
    flags?: { narrated?: boolean; replanned?: boolean },
  ): Promise<boolean>;
  create(
    input: { turnId: string; goal: string; lang: Lang; steps: CompiledStep[] },
    flags: { approved: boolean; replanned: boolean; originCreatedAt?: number },
  ): Promise<PlanView>;
  outcome(text: string, lang: Lang, planId: string): void;
  optionalActions(): string[];
  availableActions(): string[];
  browserUrls(): readonly string[];
  deniedActions(): string[];
};

export async function composeResult(
  ctx: FinisherContext,
  plan: PlanRow,
  tasks: (StepTask | undefined)[],
): Promise<boolean> {
  const { lang, steps } = plan;
  const skipped = tasks.filter((task) => task?.status === "SKIPPED").length;
  if (skipped) {
    await ctx.settle(plan, "COMPLETED", {
      say:
        lang === "tr"
          ? `Koşula uymayan ${skipped} adım atlandı; diğer adımlar doğrulandı, efendim.`
          : `${skipped} conditional steps were skipped; the remaining steps were verified, sir.`,
    });
    return true;
  }
  const news = steps.findIndex((step) => step.action === "news.brief");
  const describe = steps.findIndex((step) => step.action === "screen.describe");
  if (news >= 0) {
    const panel = evidenceOf(tasks[news])?.panel;
    const items = panel?.type === "news" ? panel.items : [];
    const brief = await ctx.text(plan, "brief", briefPrompt(items, lang), "personal");
    const say =
      (brief === null ? null : readBrief(brief)) ??
      narrate({ type: "news-fallback", count: items.length }, lang);
    await ctx.settle(plan, "COMPLETED", { say });
    return true;
  }
  if (describe >= 0) {
    const question = steps[describe]?.args.question;
    const screen = evidenceOf(tasks[describe])?.observation ?? "";
    const answer = await ctx.text(
      plan,
      "describe",
      describePrompt(typeof question === "string" ? question : undefined, screen, lang),
      "private",
    );
    const say = answer === null ? null : readBrief(answer);
    await forgetScreen(ctx.tasks, plan, "describe", tasks[describe]?.id);
    await ctx.settle(plan, say === null ? "FAILED" : "COMPLETED", {
      say: say ?? narrate({ type: "plan-failed" }, lang),
    });
    return true;
  }
  // An agent or page read came back with text: say what it found, not just "done".
  const results = tasks.flatMap((task, index) =>
    plan.steps[index]?.kind === "integration" && task?.result?.text?.trim()
      ? [task.result.text.trim()]
      : [],
  );
  if (results.length) {
    const confidential = steps.some(
      (step) =>
        step.kind === "integration" &&
        step.action !== "browser.read" &&
        step.action !== "browser.read_many",
    );
    const brief = await ctx.text(
      plan,
      "result",
      resultBriefPrompt(plan.goal, results, lang),
      confidential ? "private" : "personal",
    );
    const say = (brief === null ? null : readBrief(brief)) ?? narrate({ type: "plan-done" }, lang);
    await ctx.settle(plan, "COMPLETED", { say });
    return true;
  }
  const [only] = steps;
  const say =
    steps.length === 1 && only
      ? narrate({ type: "step-done", action: only.action, args: only.args }, lang)
      : narrate({ type: "plan-done" }, lang);
  await ctx.settle(plan, "COMPLETED", { say });
  return false;
}

export async function failPlan(
  ctx: FinisherContext,
  plan: PlanRow,
  tasks: (StepTask | undefined)[],
): Promise<void> {
  const failedSay = narrate({ type: "plan-failed" }, plan.lang);
  const index = tasks.findIndex((task) =>
    ["FAILED", "CANCELLED", "BLOCKED"].includes(task?.status ?? ""),
  );
  const evidence = evidenceOf(tasks[index]);
  if (evidence?.candidates?.length) {
    await ctx.settle(plan, "FAILED", {
      say: narrate({ type: "candidates", count: evidence.candidates.length }, plan.lang),
      candidates: { index, items: evidence.candidates },
    });
    return;
  }
  const step = plan.steps[index];
  if (
    evidence?.evidence !== "observed-failure" ||
    plan.replanned ||
    !ctx.privateProviders.length ||
    !step
  ) {
    await ctx.settle(plan, "FAILED", { say: failedSay });
    return;
  }
  // One replan: the failed plan ends silently and the operator hears what follows instead.
  if (!(await ctx.settle(plan, "FAILED", { say: failedSay }, { narrated: true, replanned: true })))
    return;
  const screen = await ctx.screen?.().catch(() => undefined);
  const text = await ctx.text(
    plan,
    "replan",
    replanPrompt({
      goal: plan.goal,
      step: { action: step.action, args: step.args },
      observation: evidence.observation,
      ...(screen ? { screen } : {}),
      enabledIntegrations: ctx.optionalActions(),
      availableActions: ctx.availableActions(),
      browserUrls: ctx.browserUrls(),
      denied: ctx.deniedActions(),
    }),
    "private",
    true,
  );
  if (screen) await forgetScreen(ctx.tasks, plan, "replan");
  const read = text === null ? undefined : readIntent(jsonObject(text)?.intent);
  if (read && "decision" in read && read.decision.kind === "plan") {
    try {
      const next = await ctx.create(
        {
          turnId: plan.turn_id,
          goal: read.decision.goal,
          lang: plan.lang,
          steps: read.decision.steps,
        },
        { approved: false, replanned: true, originCreatedAt: Number(plan.created_at) },
      );
      if (next.needsApproval)
        ctx.outcome(
          narrate({ type: "proposed", goal: next.goal, needsApproval: true }, plan.lang),
          plan.lang,
          next.id,
        );
    } catch {
      ctx.outcome(failedSay, plan.lang, plan.id);
    }
  } else ctx.outcome(failedSay, plan.lang, plan.id);
}

// Screen text served its one question or replan: drop it from the prompt and step records,
// keep the outcome. The spoken answer itself stays in the plan outcome.
export async function forgetScreen(
  tasks: TaskService,
  plan: PlanRow,
  label: "describe" | "replan",
  stepTaskId?: string,
): Promise<void> {
  const key = `plan:${plan.id}:${label}`;
  const marker = '"[screen text discarded]"';
  await tasks.db.transaction(async (tx) => {
    await tx.query(
      `UPDATE actions SET parameters = jsonb_set(parameters, '{objective}', '${marker}') WHERE task_id IN (SELECT id FROM tasks WHERE principal='operator' AND idempotency_key=$1)`,
      [key],
    );
    await tx.query(
      `UPDATE tasks SET spec = jsonb_set(spec, '{objective}', '${marker}') WHERE principal='operator' AND idempotency_key=$1`,
      [key],
    );
    if (!stepTaskId) return;
    const evidence = JSON.stringify({
      ok: true,
      evidence: "postcondition",
      observation: "[screen text discarded]",
    });
    for (const table of ["tasks", "actions"] as const)
      await tx.query(
        `UPDATE ${table} SET result = jsonb_set(result, '{text}', to_jsonb($2::text)) WHERE ${table === "tasks" ? "id" : "task_id"}=$1 AND result IS NOT NULL`,
        [stepTaskId, evidence],
      );
  });
}
