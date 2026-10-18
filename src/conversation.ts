import { randomUUID } from "node:crypto";
import { narrate, readIntent, repairInstructions } from "@jarvis/action-engine";
import { z } from "zod";
import { CoreError } from "./contracts.js";
import type { Sql } from "./database.js";
import { conversationPrompt } from "./persona.js";
import type { PlanService } from "./plans.js";
import type { TaskService } from "./tasks.js";
import { runText } from "./text-task.js";

export const DisplayBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    title: z.string().max(80).optional(),
    body: z.string().min(1).max(1200),
  }),
  z.strictObject({
    type: z.literal("list"),
    title: z.string().max(80).optional(),
    items: z.array(z.string().min(1).max(200)).min(1).max(8),
  }),
  z.strictObject({
    type: z.literal("code"),
    language: z.string().max(20).optional(),
    code: z.string().min(1).max(4000),
  }),
]);
export type DisplayBlock = z.infer<typeof DisplayBlockSchema>;
export type Reply = {
  addressed: boolean;
  say: string;
  lang: "tr" | "en";
  display: DisplayBlock[];
  intent?: unknown;
};
export type TurnResult = Reply & {
  id: string;
  taskId: string;
  provider: string | null;
  latencyMs: number;
  planId?: string;
};
export type TurnRecord = {
  id: string;
  createdAt: number;
  utterance: string;
  followUp: boolean;
  reply: Reply;
  provider: string | null;
};

const turkish = /[çğıöşü]|\b(efendim|evet|hayır|tamam|tabii|bir|bu|ve)\b/i;
const detect = (text: string): "tr" | "en" => (turkish.test(text) ? "tr" : "en");

// Models wrap JSON in fences or prose; anything unparseable is treated as the spoken reply.
export function parseReply(text: string): Reply {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let value: unknown;
  try {
    value = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined;
  } catch {
    value = undefined;
  }
  // Braces inside prose ("f() {}") are not a reply object.
  if (!value || typeof value !== "object" || !("say" in value || "addressed" in value))
    value = undefined;
  const parsed = z
    .object({
      addressed: z.boolean().catch(true),
      say: z.string().catch(""),
      lang: z.enum(["tr", "en"]).optional().catch(undefined),
      display: z.array(z.unknown()).catch([]),
      intent: z.unknown().optional(),
    })
    .safeParse(value);
  if (!parsed.success) {
    const say = text.trim();
    return { addressed: true, say, lang: detect(say), display: [] };
  }
  const { addressed, say, lang, display } = parsed.data;
  return {
    addressed,
    say: say.trim(),
    lang: lang ?? detect(say),
    display: display
      .flatMap((block) => {
        const valid = DisplayBlockSchema.safeParse(block);
        return valid.success ? [valid.data] : [];
      })
      .slice(0, 3),
    ...(parsed.data.intent !== undefined ? { intent: parsed.data.intent } : {}),
  };
}

// Realtime order: Gemini with minimal thinking first, Claude at low effort next, free models,
// then the subscription CLI last. Codex is excluded: its HIGH floor would need an approval per
// turn. Adaptive routing may still demote a provider measured as failing or too slow.
export function conversationProviders(ids: string[]): string[] {
  const rank = (id: string) =>
    id === "gemini-live"
      ? 0
      : id === "claude-live"
        ? 1
        : id.startsWith("or-")
          ? 2
          : id.startsWith("nv-")
            ? 3
            : id === "claude-code"
              ? 4
              : -1;
  return ids
    .filter((id) => rank(id) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 5);
}

const conversationTasks = "principal='operator' AND idempotency_key LIKE 'conversation:%'";
const onScreen = { tr: "Ekranda, efendim.", en: "It's on the screen, sir." };

export class ConversationService {
  constructor(
    private tasks: TaskService,
    private options: {
      providers: string[];
      wake(): void;
      deadlineMs?: number;
      plans?: PlanService;
    },
  ) {}
  get deadlineMs(): number {
    return this.options.deadlineMs ?? 20_000;
  }
  async turn(input: { utterance: string; followUp: boolean }): Promise<TurnResult> {
    const { providers } = this.options;
    if (!providers.length) throw new CoreError("NO_PROVIDER", 503);
    const started = Date.now();
    const id = randomUUID();
    const history = (
      await this.tasks.db.query<{ utterance: string; say: string }>(
        "SELECT utterance, reply->>'say' AS say FROM conversation_turns c WHERE created_at > $1 AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.turn_id=c.id AND p.steps @> '[{\"action\":\"screen.describe\"}]'::jsonb) ORDER BY created_at DESC LIMIT 6",
        [started - 30 * 60_000],
      )
    ).rows.reverse();
    const prompt = conversationPrompt({
      ...input,
      history,
      now: new Date(started),
      enabledIntegrations: this.options.plans?.integrationCapabilities(),
      browserUrls: this.options.plans?.browserUrls(),
    });
    const { text, provider, taskId } = await runText(
      this.tasks,
      () => this.options.wake(),
      {
        prompt,
        providers,
        privacy: "personal",
        deadlineMs: this.deadlineMs,
        maxOutputTokens: 600,
        json: true,
      },
      `conversation:${id}`,
    );
    let reply = parseReply(text);
    let planId: string | undefined;
    if (reply.addressed && this.options.plans) {
      let parsed = readIntent(reply.intent);
      if ("errors" in parsed) {
        const repaired = await runText(
          this.tasks,
          () => this.options.wake(),
          {
            prompt: `${prompt}\n\n${repairInstructions(parsed.errors)}`,
            providers,
            privacy: "personal",
            deadlineMs: this.deadlineMs,
            maxOutputTokens: 1000,
            json: true,
          },
          `conversation:${id}:repair`,
        );
        reply = parseReply(repaired.text);
        parsed = readIntent(reply.intent);
      }
      if (reply.addressed && "errors" in parsed) {
        reply.say = narrate({ type: "not-understood" }, reply.lang);
        reply.display = [];
      } else if (reply.addressed && "decision" in parsed && parsed.decision.kind === "cancel") {
        const cancelled = await this.options.plans.cancelActive();
        reply.say = cancelled?.say ?? narrate({ type: "cancelled" }, reply.lang);
        reply.display = [];
      } else if (reply.addressed && "decision" in parsed && parsed.decision.kind === "plan") {
        const decision = parsed.decision;
        let view = await this.options.plans.propose({
          turnId: id,
          goal: decision.goal,
          lang: reply.lang,
          steps: decision.steps,
        });
        planId = view.id;
        if (!view.needsApproval) view = await this.options.plans.waitSettled(view.id, 5000);
        reply.display = [];
        reply.say = narrate(
          { type: "proposed", goal: view.goal, needsApproval: view.needsApproval },
          reply.lang,
        );
        if (view.status !== "RUNNING" && view.status !== "AWAITING_APPROVAL") {
          if (await this.options.plans.claimNarration(view.id))
            reply.say = view.say ?? narrate({ type: "plan-uncertain" }, reply.lang);
        }
      }
    }
    // An empty spoken reply would leave the voice service "speaking" with no audio.
    if (reply.addressed && !reply.say) {
      if (!reply.display.length) throw new CoreError("TURN_FAILED", 502);
      reply.say = onScreen[reply.lang];
    }
    // Speech that was not meant for JARVIS is not kept, not even in the task record.
    if (reply.addressed)
      await this.tasks.db.query(
        "INSERT INTO conversation_turns(id,created_at,utterance,follow_up,task_id,reply,provider) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, started, input.utterance, input.followUp, taskId, JSON.stringify(reply), provider],
      );
    else
      await this.tasks.db.transaction((tx) =>
        this.forget(tx, "idempotency_key LIKE $1", `conversation:${id}%`),
      );
    return {
      id,
      taskId,
      ...reply,
      provider,
      latencyMs: Date.now() - started,
      ...(planId && { planId }),
    };
  }
  async list(limit: number): Promise<TurnRecord[]> {
    const rows = (
      await this.tasks.db.query<{
        id: string;
        created_at: string | number;
        utterance: string;
        follow_up: boolean;
        reply: Reply;
        provider: string | null;
      }>("SELECT * FROM conversation_turns ORDER BY created_at DESC, id LIMIT $1", [limit])
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      createdAt: Number(row.created_at),
      utterance: row.utterance,
      followUp: row.follow_up,
      reply: row.reply,
      provider: row.provider,
    }));
  }
  async deleteAll(): Promise<void> {
    // Stop in-flight turns first so none finishes after the scrub with its prompt intact.
    const active = await this.tasks.db.query<{ id: string }>(
      `SELECT id FROM tasks WHERE ${conversationTasks} AND status NOT IN ('COMPLETED','FAILED','CANCELLED','RECOVERY_REQUIRED')`,
    );
    // A task that settled meanwhile is scrubbed below all the same.
    for (const { id } of active.rows) await this.tasks.cancel(id).catch(() => {});
    await this.scrub(Number.MAX_SAFE_INTEGER);
  }
  purge(olderThanMs: number): Promise<number> {
    return this.scrub(Date.now() - olderThanMs);
  }
  // Scrubs the prompts and replies Core kept for the selected conversation tasks, in any state.
  private async forget(tx: Sql, where: string, value: unknown) {
    await tx.query(
      `UPDATE actions SET parameters = jsonb_set(parameters, '{objective}', '"[deleted]"'), result = NULL WHERE task_id IN (SELECT id FROM tasks WHERE ${conversationTasks} AND ${where})`,
      [value],
    );
    await tx.query(
      `UPDATE tasks SET spec = jsonb_set(spec, '{objective}', '"[deleted]"'), result = NULL WHERE ${conversationTasks} AND ${where}`,
      [value],
    );
  }
  // Deletes turns before the cutoff and scrubs their tasks and plans.
  private async scrub(cutoff: number): Promise<number> {
    const activePlans = this.options.plans
      ? (
          await this.tasks.db.query<{ id: string }>(
            "SELECT p.id FROM plans p LEFT JOIN conversation_turns c ON c.id=p.turn_id WHERE (c.created_at<$1 OR p.created_at<$1) AND p.status IN ('RUNNING','AWAITING_APPROVAL')",
            [cutoff],
          )
        ).rows
      : [];
    for (const { id } of activePlans) {
      try {
        await this.options.plans?.cancel(id);
      } catch (error) {
        if (
          ["RUNNING", "AWAITING_APPROVAL"].includes(
            (await this.options.plans?.get(id))?.status ?? "",
          )
        )
          throw error;
      }
    }
    return this.tasks.db.transaction(async (tx) => {
      const planTasks =
        "principal='operator' AND EXISTS (SELECT 1 FROM plans p LEFT JOIN conversation_turns c ON c.id=p.turn_id WHERE (c.created_at<$1 OR p.created_at<$1) AND idempotency_key LIKE 'plan:' || p.id::text || ':%')";
      await tx.query(
        `UPDATE actions SET parameters = jsonb_set(jsonb_set(parameters, '{objective}', '"[deleted]"'), '{input}', '{}'), result = NULL WHERE task_id IN (SELECT id FROM tasks WHERE ${planTasks})`,
        [cutoff],
      );
      await tx.query(
        `UPDATE tasks SET spec = jsonb_set(jsonb_set(spec, '{objective}', '"[deleted]"'), '{input}', '{}'), result = NULL WHERE ${planTasks}`,
        [cutoff],
      );
      await tx.query(
        "UPDATE plans SET goal='[deleted]', steps='[]', outcome=NULL WHERE created_at<$1 OR turn_id IN (SELECT id FROM conversation_turns WHERE created_at<$1)",
        [cutoff],
      );
      await this.forget(tx, "created_at < $1", cutoff);
      return (
        await tx.query("DELETE FROM conversation_turns WHERE created_at < $1 RETURNING id", [
          cutoff,
        ])
      ).rows.length;
    });
  }
}
