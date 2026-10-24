import { type Lang, narrate, narrateLive } from "@jarvis/action-engine";
import type { Sql } from "../../core/database.js";
import { ended, type PlanRow, type PlanView, type WorkingMemory } from "./model.js";

// What Core knows right now, for the model's working memory: active plans, the last outcome,
// things recently referred to, and a question JARVIS just asked.
export async function workingMemory(
  db: Sql,
  get: (id: string) => Promise<PlanView>,
): Promise<WorkingMemory> {
  const now = Date.now();
  const recent = (
    await db.query<PlanRow>(
      "SELECT * FROM plans WHERE created_at>$1 ORDER BY created_at DESC LIMIT 6",
      [now - 15 * 60_000],
    )
  ).rows;
  const active = await Promise.all(
    recent
      .filter((plan) => !ended.has(plan.status))
      .map(async (plan) => {
        const progress =
          plan.status === "RUNNING"
            ? (await get(plan.id).catch(() => undefined))?.progress
            : undefined;
        return {
          goal: plan.goal,
          status: plan.status,
          actions: plan.steps.map((step) => step.action),
          ...(progress && {
            progress: {
              step: progress.step,
              steps: progress.steps,
              action: progress.action,
              args: progress.args,
              ...(progress.detail && { detail: progress.detail }),
              elapsedMs: now - progress.startedAt,
              ...(progress.etaAt !== undefined && { remainingMs: progress.etaAt - now }),
              ...(progress.finishing && { finishing: true }),
            },
          }),
        };
      }),
  );
  const last = recent.find((plan) => ended.has(plan.status) && plan.goal !== "[deleted]");
  const entities = [
    ...new Set(
      recent.flatMap((plan) =>
        plan.steps.flatMap((step) =>
          ["name", "target", "folder", "path", "source", "destination", "url", "topic"]
            .map((key) => step.args[key])
            .filter((value): value is string => typeof value === "string" && value.length <= 200),
        ),
      ),
    ),
  ].slice(0, 8);
  const asked = (
    await db.query<{ say: string; kind: string | null; utterance: string }>(
      "SELECT reply->>'say' AS say, reply->'intent'->>'kind' AS kind, utterance FROM conversation_turns WHERE created_at>$1 ORDER BY created_at DESC LIMIT 1",
      [now - 120_000],
    )
  ).rows[0];
  return {
    active,
    ...(last && {
      last: {
        goal: last.goal,
        status: last.status,
        say: last.outcome?.say ?? null,
        agoMs: now - Number(last.created_at),
      },
    }),
    entities,
    ...(asked?.kind === "clarify" && asked.say
      ? { asked: asked.say, askedAbout: asked.utterance }
      : {}),
  };
}

// "Ne yapıyorsun?" answered from plan records.
export function statusSay(memory: WorkingMemory, lang: Lang): string {
  const [current] = memory.active;
  const progress = current?.progress;
  if (current && progress && !progress.finishing)
    return narrateLive(
      {
        type: "status",
        goal: current.goal,
        step: { action: progress.action, args: progress.args },
        ...(progress.detail && { detail: progress.detail }),
        ...(progress.remainingMs !== undefined && { remainingMs: progress.remainingMs }),
      },
      lang,
    );
  if (current && progress?.finishing) return narrateLive({ type: "composing" }, lang);
  if (current)
    return narrate(
      {
        type: current.status === "AWAITING_APPROVAL" ? "status-waiting" : "status-running",
        goal: current.goal,
      },
      lang,
    );
  if (memory.last?.say && memory.last.agoMs < 5 * 60_000) return memory.last.say;
  return narrate({ type: "status-idle" }, lang);
}
