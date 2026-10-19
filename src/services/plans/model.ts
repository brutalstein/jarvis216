import type { CompiledStep, Evidence, Lang, Panel } from "@jarvis/action-engine";
import type { ExecutionResult, TaskState } from "../../core/contracts.js";
import type { PermissionMode } from "../permissions.js";

// Plan records, views and the constants every plan module shares.
export type PlanStatus =
  | "AWAITING_APPROVAL"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RECOVERY_REQUIRED";
export type PlanPanel = Panel | { type: "candidates"; planId: string; items: string[] };
export type WorkingMemory = {
  active: {
    goal: string;
    status: PlanStatus;
    actions: string[];
    // Where a running plan is: its step, what that step reported, time spent and left.
    progress?: {
      step: number;
      steps: number;
      action: string;
      args: Record<string, unknown>;
      detail?: string;
      elapsedMs: number;
      remainingMs?: number;
      finishing?: boolean;
    };
  }[];
  last?: { goal: string; status: PlanStatus; say: string | null; agoMs: number };
  entities: string[];
  asked?: string;
};
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
    // The operator's current Settings decision for this action.
    mode: PermissionMode;
    status: TaskState;
    evidence?: Evidence;
    approval?: { id: string; target: string };
  }[];
  panels: PlanPanel[];
  say?: string;
  // A running plan's live state: the step it is on, what that step reported (where it looks),
  // and when it is expected to end, from measured durations. Timestamps keep the view stable.
  progress?: PlanProgress;
};
export type PlanProgress = {
  step: number;
  steps: number;
  action: string;
  args: Record<string, unknown>;
  stage?: string;
  detail?: string;
  index?: number;
  total?: number;
  startedAt: number;
  stepStartedAt?: number;
  etaAt?: number;
  // Every step is done; JARVIS is composing the spoken result.
  finishing?: boolean;
};
export type Outcome = { say: string; candidates?: { index: number; items: string[] } };
export type PlanRow = {
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
export type StepTask = {
  id: string;
  status: TaskState;
  result: ExecutionResult | null;
  approval: { id: string; target: string } | null;
};

// A spoken turn may narrate a quick outcome itself; announcements wait this long for it.
export const replyWaitMs = 5000;
export const stepWindowMs = 15_000;
export const planWindowMs = 120_000;
export const active = "status IN ('AWAITING_APPROVAL','RUNNING')";
export const ended = new Set<PlanStatus>(["COMPLETED", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"]);

export function evidenceOf(task: StepTask | undefined): Evidence | undefined {
  if (!task?.result) return undefined;
  try {
    const value = JSON.parse(task.result.text) as Evidence;
    return typeof value?.ok === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}
// Models wrap JSON in fences or prose.
export function jsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined;
  } catch {
    return undefined;
  }
}
