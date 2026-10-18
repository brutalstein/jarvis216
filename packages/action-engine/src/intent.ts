import { z } from "zod";
import { catalogLines, compile } from "./catalog.js";
import type { CompiledStep } from "./types.js";

export type Decision =
  | { kind: "reply" }
  | { kind: "clarify" }
  | { kind: "cancel" }
  | { kind: "plan"; goal: string; steps: CompiledStep[] };

export const maxSteps = 8;
const IntentSchema = z.object({
  kind: z.enum(["reply", "clarify", "plan", "cancel"]),
  goal: z.string().trim().min(1).max(200).optional(),
  steps: z.array(z.unknown()).optional(),
});

// The model's intent is an untrusted proposal: one invalid step rejects the whole plan.
export function readIntent(value: unknown): { decision: Decision } | { errors: string[] } {
  if (value === undefined || value === null) return { decision: { kind: "reply" } };
  const parsed = IntentSchema.safeParse(value);
  if (!parsed.success)
    return { errors: parsed.error.issues.map((i) => `intent.${i.path.join(".")} ${i.message}`) };
  const { kind, goal, steps = [] } = parsed.data;
  if (kind !== "plan") return { decision: { kind } };
  const errors: string[] = [];
  if (!goal) errors.push("intent.goal is required for a plan");
  if (!steps.length) errors.push("intent.steps needs at least one step");
  if (steps.length > maxSteps) errors.push(`too many steps (at most ${maxSteps})`);
  const compiled = compile(steps);
  if (!compiled.ok) errors.push(...compiled.errors);
  if (errors.length || !compiled.ok || !goal) return { errors };
  return { decision: { kind, goal, steps: compiled.steps } };
}

export function intentInstructions(): string {
  return `Add an "intent" field to the JSON object:
{"kind": "reply" | "clarify" | "plan" | "cancel", "goal": "<short goal, plan only>",
 "steps": [{"action": "<catalog id>", "args": {...}}]}
- "reply": conversation or a question you can answer yourself.
- "clarify": an argument is missing or ambiguous; "say" asks one short question.
- "plan": the operator wants something done on this computer or wants news; 1 to ${maxSteps} steps,
  only actions from the catalog below, arguments exactly as typed there.
- "cancel": the operator says stop, cancel, dur, iptal, vazgeç.
Rules: never invent actions. Anything outside the catalog (deleting files, running commands,
installing, paying, passwords, messages) is "reply" and "say" explains you cannot do it yet.
For a plan, never claim in "say" that anything is done or started: the system reports outcomes.
Catalog (action(arguments) — Turkish / English):
${catalogLines()}`;
}

export function repairInstructions(errors: string[]): string {
  return `Your previous "intent" was rejected by the validator:
${errors.map((error) => `- ${error}`).join("\n")}
Reply again with exactly one JSON object. Fix the intent using only catalog actions and their exact
arguments; if the request cannot be expressed with them, use kind "reply".`;
}
