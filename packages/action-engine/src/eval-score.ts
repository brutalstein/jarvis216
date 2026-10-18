import { z } from "zod";
import { normalize } from "./ground.js";
import type { Decision } from "./intent.js";

export const EvalCommandSchema = z.strictObject({
  utterance: z.string().min(1).max(500),
  lang: z.enum(["tr", "en"]),
  kind: z.enum(["reply", "clarify", "cancel", "plan"]),
  actions: z.array(z.string()),
  args: z.record(z.string(), z.record(z.string(), z.json())),
});
export type EvalCommand = z.infer<typeof EvalCommandSchema>;

/** Stable, conservative action-sequence scoring; never grants runtime permissions. */
export function scoreIntent(gold: EvalCommand, decision: Decision): boolean {
  if (gold.kind !== decision.kind) return false;
  if (gold.kind !== "plan") return true;
  if (decision.kind !== "plan" || decision.steps.length !== gold.actions.length) return false;
  return decision.steps.every((step, index) => {
    if (step.action !== gold.actions[index]) return false;
    const expected = gold.args[String(index)];
    if (!expected) return false;
    return Object.entries(expected).every(([key, value]) => {
      if (!Object.hasOwn(step.args, key)) return false;
      const actual = step.args[key];
      return typeof value === "string" && typeof actual === "string"
        ? normalize(value) === normalize(actual)
        : JSON.stringify(value) === JSON.stringify(actual);
    });
  });
}
