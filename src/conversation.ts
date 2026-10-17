import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { CoreError, type TaskState, terminal } from "./contracts.js";
import { conversationPrompt } from "./persona.js";
import type { TaskService } from "./tasks.js";

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
export type Reply = { addressed: boolean; say: string; lang: "tr" | "en"; display: DisplayBlock[] };
export type TurnResult = Reply & {
  id: string;
  taskId: string;
  provider: string | null;
  latencyMs: number;
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
  const parsed = z
    .object({
      addressed: z.boolean().catch(true),
      say: z.string().catch(""),
      lang: z.enum(["tr", "en"]).optional().catch(undefined),
      display: z.array(z.unknown()).catch([]),
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
  };
}

// Realtime order: Gemini with minimal thinking first, free models next, subscription CLI last.
// Codex is excluded: its HIGH floor would need an approval per turn.
export function conversationProviders(ids: string[]): string[] {
  const rank = (id: string) =>
    id === "gemini-live"
      ? 0
      : id.startsWith("or-")
        ? 1
        : id.startsWith("nv-")
          ? 2
          : id === "claude-code"
            ? 3
            : -1;
  return ids
    .filter((id) => rank(id) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 5);
}

// States where waiting longer cannot produce a reply.
const settled = new Set<TaskState>([
  ...terminal,
  "BLOCKED",
  "RECOVERY_REQUIRED",
  "WAITING_FOR_APPROVAL",
]);
const conversationTasks =
  "principal='operator' AND idempotency_key LIKE 'conversation:%' AND status IN ('COMPLETED','FAILED','CANCELLED') AND created_at < $1";

export class ConversationService {
  constructor(
    private tasks: TaskService,
    private options: { providers: string[]; wake(): void; deadlineMs?: number },
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
        "SELECT utterance, reply->>'say' AS say FROM conversation_turns WHERE created_at > $1 ORDER BY created_at DESC LIMIT 6",
        [started - 30 * 60_000],
      )
    ).rows.reverse();
    const task = await this.tasks.create(
      {
        objective: conversationPrompt({ ...input, history, now: new Date(started) }),
        capability: "text.generate",
        providers,
        providerOrder: "listed",
        privacy: "personal",
        budget: {
          maxCalls: providers.length,
          maxDurationMs: this.deadlineMs,
          maxOutputTokens: 600,
        },
        deadline: new Date(started + this.deadlineMs).toISOString(),
        verification: { kind: "non-empty" },
      },
      `conversation:${id}`,
      "operator",
    );
    this.options.wake();
    // The task deadline aborts the provider call itself; the grace covers Core's bookkeeping.
    let current = task;
    while (!settled.has(current.status) && Date.now() < started + this.deadlineMs + 2000) {
      await delay(50);
      current = await this.tasks.get(task.id);
    }
    if (current.status !== "COMPLETED" || !current.result) {
      const late = Date.now() >= started + this.deadlineMs;
      throw new CoreError(late ? "TURN_TIMEOUT" : "TURN_FAILED", late ? 504 : 502);
    }
    const reply = parseReply(current.result.text);
    const provider =
      (await this.tasks.actions(task.id)).find((action) => action.status === "SUCCEEDED")?.target ??
      null;
    // Speech that was not meant for JARVIS is not kept.
    if (reply.addressed)
      await this.tasks.db.query(
        "INSERT INTO conversation_turns(id,created_at,utterance,follow_up,task_id,reply,provider) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, started, input.utterance, input.followUp, task.id, JSON.stringify(reply), provider],
      );
    return { id, taskId: task.id, ...reply, provider, latencyMs: Date.now() - started };
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
    await this.scrub(Number.MAX_SAFE_INTEGER);
  }
  purge(olderThanMs: number): Promise<number> {
    return this.scrub(Date.now() - olderThanMs);
  }
  // Deletes turns before the cutoff and scrubs the prompts and replies Core kept for them.
  private scrub(cutoff: number): Promise<number> {
    return this.tasks.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE actions SET parameters = jsonb_set(parameters, '{objective}', '"[deleted]"'), result = NULL WHERE task_id IN (SELECT id FROM tasks WHERE ${conversationTasks})`,
        [cutoff],
      );
      await tx.query(
        `UPDATE tasks SET spec = jsonb_set(spec, '{objective}', '"[deleted]"'), result = NULL WHERE ${conversationTasks}`,
        [cutoff],
      );
      return (
        await tx.query("DELETE FROM conversation_turns WHERE created_at < $1 RETURNING id", [
          cutoff,
        ])
      ).rows.length;
    });
  }
}
