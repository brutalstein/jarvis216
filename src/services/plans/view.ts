import type { CompiledStep } from "@jarvis/action-engine";
import type { TaskState } from "../../core/contracts.js";
import type { TaskProgress } from "../../core/tasks.js";
import { type Durations, finisherOf } from "../eta.js";
import type { PermissionMode } from "../permissions.js";
import {
  evidenceOf,
  type PlanPanel,
  type PlanProgress,
  type PlanRow,
  type PlanView,
  type StepTask,
} from "./model.js";

// What the operator sees of a plan: steps with their Settings mode and evidence, panels, and a
// running plan's live progress with its expected end. Pure over the rows read.
export type ViewContext = {
  modeOf(step: Pick<CompiledStep, "action" | "risk">): PermissionMode;
  progressOf(taskId: string): TaskProgress | undefined;
  stepStartedAt(taskId: string): number | undefined;
  finishStartedAt(planId: string): number | undefined;
  durations?: Durations;
};

export function planView(
  plan: PlanRow,
  tasks: (StepTask | undefined)[],
  ctx: ViewContext,
): PlanView {
  const steps = plan.steps.map((step, index) => {
    const task = tasks[index];
    const evidence = evidenceOf(task);
    const status: TaskState =
      task?.status ?? (plan.status === "AWAITING_APPROVAL" ? "WAITING_FOR_APPROVAL" : "CANCELLED");
    return {
      action: step.action,
      args: step.args,
      risk: step.risk,
      mode: ctx.modeOf(step),
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
  const progress = plan.status === "RUNNING" ? planProgress(plan, tasks, ctx) : undefined;
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
    ...(progress && { progress }),
  };
}

export function planProgress(
  plan: PlanRow,
  tasks: (StepTask | undefined)[],
  ctx: ViewContext,
): PlanProgress | undefined {
  const durations = ctx.durations;
  const states = tasks.map((task) => task?.status);
  const finishing = states.length > 0 && states.every((state) => state === "COMPLETED");
  let index = states.findIndex((state) => state === "RUNNING" || state === "VERIFYING");
  if (index < 0) index = states.findIndex((state) => state !== "COMPLETED");
  if (index < 0) index = plan.steps.length - 1;
  const step = plan.steps[index];
  if (!step) return undefined;
  const task = tasks[index];
  const reported = task && !finishing ? ctx.progressOf(task.id) : undefined;
  const stepStartedAt = task ? ctx.stepStartedAt(task.id) : undefined;
  const finishStartedAt = ctx.finishStartedAt(plan.id);
  const finisher = durations?.finisher(finisherOf(plan.steps)) ?? 0;
  const later = plan.steps.slice(index + 1).reduce((sum, s) => sum + (durations?.step(s) ?? 0), 0);
  const etaAt = !durations
    ? undefined
    : finishing
      ? finishStartedAt !== undefined
        ? finishStartedAt + finisher
        : undefined
      : stepStartedAt !== undefined
        ? stepStartedAt + durations.step(step) + later + finisher
        : undefined;
  return {
    step: index + 1,
    steps: plan.steps.length,
    action: step.action,
    args: step.args,
    ...(reported && {
      stage: reported.stage,
      ...(reported.detail && { detail: reported.detail }),
      ...(reported.index !== undefined && { index: reported.index }),
      ...(reported.total !== undefined && { total: reported.total }),
    }),
    startedAt: Number(plan.approved_at ?? plan.created_at),
    ...(stepStartedAt !== undefined && !finishing && { stepStartedAt }),
    ...(etaAt !== undefined && { etaAt: Math.round(etaAt) }),
    ...(finishing && { finishing: true }),
  };
}
