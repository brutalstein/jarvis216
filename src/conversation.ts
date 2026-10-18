import { randomUUID } from "node:crypto";
import {
  compile,
  isCorrection,
  type Lang,
  narrate,
  readIntent,
  readVoiceCommand,
  repairInstructions,
} from "@jarvis/action-engine";
import type { Brain, IntentRecord } from "@jarvis/brain";
import { z } from "zod";
import { CoreError } from "./contracts.js";
import type { Sql } from "./database.js";
import type { MemoryStore } from "./memory.js";
import type { BrainSettings } from "./permissions.js";
import { conversationPrompt } from "./persona.js";
import type { PlanService, PlanView } from "./plans.js";
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
  // null when Core answered without a model (spoken stop or candidate choice).
  taskId: string | null;
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
      memory?: MemoryStore;
      // The learning brain and the operator's learning switches from Settings.
      brain?: Brain;
      settings?: () => BrainSettings;
    },
  ) {
    const { brain, plans } = options;
    // A plan's real outcome is the reinforcement signal for the request that produced it.
    if (brain && plans)
      plans.on("plan", (view: PlanView) => {
        void this.#planEnded(brain, view).catch(() => {
          process.stderr.write('{"level":"error","code":"BRAIN_OUTCOME_FAILED"}\n');
        });
      });
  }
  get deadlineMs(): number {
    return this.options.deadlineMs ?? 20_000;
  }
  // One spoken request, through layers from fastest to most deliberate:
  // 1. reflexes Core answers itself (stop, status, picking a candidate);
  // 2. a correction marks what JARVIS just did as wrong, then the request continues;
  // 3. procedural memory: a practised, context-free request runs its learned plan;
  // 4. deliberation: one JSON-mode model call with working memory, long-term notes and learned
  //    examples, one repair, then policy (turned-off actions, low confidence) and the plan;
  // 5. learning: the request and, later, its plan's outcome become experience.
  async turn(input: { utterance: string; followUp: boolean }): Promise<TurnResult> {
    const started = Date.now();
    const id = randomUUID();
    const settings = this.options.settings?.() ?? { learning: true, reflexes: true };
    const learning = settings.learning ? this.options.brain : undefined;
    const quick = await this.#command(input.utterance);
    if (quick) return this.#answer(id, started, input, quick);
    if (learning && isCorrection(input.utterance)) await this.#corrected(learning);
    const reflex = settings.reflexes ? await this.#reflex(id, input.utterance, learning) : null;
    if (reflex) return this.#answer(id, started, input, reflex);
    const { providers, plans, brain } = this.options;
    if (!providers.length) throw new CoreError("NO_PROVIDER", 503);
    const [history, working, examples, memories] = await Promise.all([
      this.tasks.db.query<{ utterance: string; say: string }>(
        "SELECT utterance, reply->>'say' AS say FROM conversation_turns c WHERE created_at > $1 AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.turn_id=c.id AND p.steps @> '[{\"action\":\"screen.describe\"}]'::jsonb) ORDER BY created_at DESC LIMIT 6",
        [started - 30 * 60_000],
      ),
      plans?.workingMemory(),
      brain && plans
        ? brain.recall(input.utterance, { k: 4, allowed: (action) => plans.offers(action) })
        : Promise.resolve([]),
      this.options.memory?.promptNotes(),
    ]);
    const prompt = conversationPrompt({
      ...input,
      history: history.rows.reverse(),
      now: new Date(started),
      enabledIntegrations: plans?.integrationCapabilities(),
      optionalActions: plans?.optionalActions(),
      browserUrls: plans?.browserUrls(),
      memories,
      denied: plans?.deniedActions(),
      ...(working && { working }),
      examples,
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
    let understood: IntentRecord | undefined;
    if (reply.addressed && plans) {
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
      const decision = "decision" in parsed ? parsed.decision : undefined;
      if (reply.addressed && !decision) {
        reply.say = narrate({ type: "not-understood" }, reply.lang);
        reply.display = [];
      } else if (reply.addressed && decision?.kind === "cancel") {
        const cancelled = await plans.cancelActive();
        reply.say = cancelled?.say ?? narrate({ type: "cancelled" }, reply.lang);
        reply.display = [];
        understood = { kind: "cancel" };
      } else if (
        reply.addressed &&
        decision?.kind === "plan" &&
        decision.steps.some((step) => plans.modeOf(step) === "deny")
      ) {
        // The model proposed something the operator turned off: say so, propose nothing.
        reply.say = narrate({ type: "denied" }, reply.lang);
        reply.display = [];
      } else if (
        reply.addressed &&
        decision?.kind === "plan" &&
        decision.confidence !== undefined &&
        decision.confidence < 0.5
      ) {
        // Unsure what was meant: ask before acting. The answer comes back as a clarification.
        reply.say = narrate({ type: "confirm", goal: decision.goal }, reply.lang);
        reply.display = [];
        reply.intent = { kind: "clarify", goal: decision.goal };
        understood = { kind: "clarify", goal: decision.goal };
      } else if (reply.addressed && decision?.kind === "plan") {
        const view = await plans.propose({
          turnId: id,
          goal: decision.goal,
          lang: reply.lang,
          steps: decision.steps,
        });
        planId = view.id;
        // Learn before narrating: a quick plan may finish while the reply waits for it.
        await this.#learnPlan(learning, input.utterance, reply.lang, view.id, "model", {
          kind: "plan",
          goal: decision.goal,
          steps: decision.steps.map(({ action, args }) => ({ action, args })),
        });
        reply.display = [];
        reply.say = await this.#planSay(view, reply.lang);
      } else if (reply.addressed && decision) understood = { kind: decision.kind };
    }
    // An empty spoken reply would leave the voice service "speaking" with no audio.
    if (reply.addressed && !reply.say) {
      if (!reply.display.length) throw new CoreError("TURN_FAILED", 502);
      reply.say = onScreen[reply.lang];
    }
    // Speech that was not meant for JARVIS is not kept, not even in the task record.
    if (reply.addressed) await this.#remember(id, started, input, taskId, reply, provider);
    else
      await this.tasks.db.transaction((tx) =>
        this.forget(tx, "idempotency_key LIKE $1", `conversation:${id}%`),
      );
    if (learning && reply.addressed && understood)
      await learning.experience({
        utterance: input.utterance,
        lang: reply.lang,
        intent: understood,
        source: "model",
      });
    return {
      id,
      taskId,
      ...reply,
      provider,
      latencyMs: Date.now() - started,
      ...(planId && { planId }),
    };
  }

  async #answer(
    id: string,
    started: number,
    input: { utterance: string; followUp: boolean },
    quick: { reply: Reply; planId?: string },
  ): Promise<TurnResult> {
    await this.#remember(id, started, input, null, quick.reply, null);
    return {
      id,
      taskId: null,
      ...quick.reply,
      provider: null,
      latencyMs: Date.now() - started,
      ...(quick.planId && { planId: quick.planId }),
    };
  }

  // Spoken stop, a status question or a candidate pick: answered at once, no model call.
  // Nothing to stop or choose means the utterance goes on like any other.
  async #command(utterance: string): Promise<{ reply: Reply; planId?: string } | null> {
    const plans = this.options.plans;
    const command = plans ? readVoiceCommand(utterance) : null;
    if (!plans || !command) return null;
    if (command.kind === "status")
      return {
        reply: {
          addressed: true,
          say: await plans.statusSay(command.lang),
          lang: command.lang,
          display: [],
        },
      };
    if (command.kind === "cancel") {
      const cancelled = await plans.cancelActive();
      if (!cancelled) return null;
      return {
        reply: {
          addressed: true,
          say: cancelled.say ?? narrate({ type: "cancelled" }, command.lang),
          lang: command.lang,
          display: [],
        },
        planId: cancelled.id,
      };
    }
    const pending = await plans.pendingChoice();
    const index = command.index === "last" ? pending?.count : command.index;
    if (!pending || index === undefined || index < 1 || index > pending.count) return null;
    const lang = command.lang ?? pending.lang;
    const view = await plans.choose(pending.id, index);
    return {
      reply: { addressed: true, say: await this.#planSay(view, lang), lang, display: [] },
      planId: view.id,
    };
  }

  // A practised request answered from procedural memory: the learned plan is compiled,
  // authorized and approved like any model proposal; only the model call is skipped.
  async #reflex(
    id: string,
    utterance: string,
    learning: Brain | undefined,
  ): Promise<{ reply: Reply; planId?: string } | null> {
    const { brain, plans } = this.options;
    if (!brain || !plans) return null;
    const reflex = brain.reflex(utterance, (action) => plans.offers(action));
    const compiled = reflex ? compile(reflex.steps) : undefined;
    if (!reflex || !compiled?.ok) return null;
    let view: PlanView;
    try {
      view = await plans.propose({
        turnId: id,
        goal: reflex.goal,
        lang: reflex.lang,
        steps: compiled.steps,
      });
    } catch {
      return null;
    }
    const intent: IntentRecord = { kind: "plan", goal: reflex.goal, steps: reflex.steps };
    await this.#learnPlan(learning, utterance, reflex.lang, view.id, "reflex", intent);
    return {
      reply: {
        addressed: true,
        say: await this.#planSay(view, reflex.lang),
        lang: reflex.lang,
        display: [],
        intent,
      },
      planId: view.id,
    };
  }

  // Records the request behind a plan, then reconciles with a plan that already ended.
  async #learnPlan(
    learning: Brain | undefined,
    utterance: string,
    lang: Lang,
    planId: string,
    source: "model" | "reflex",
    intent: IntentRecord,
  ): Promise<void> {
    if (!learning || !this.options.plans) return;
    await learning.experience({ utterance, lang, intent, source, planId });
    await this.#planEnded(learning, await this.options.plans.get(planId));
  }

  // "Hayır, onu demedim": the latest request was misunderstood. A learned pick it relied on is
  // dropped too.
  async #corrected(brain: Brain): Promise<void> {
    const latest = brain.latest(90_000);
    if (!latest || latest.outcome === "corrected") return;
    await brain.outcome(latest.id, "corrected");
    if (!latest.planId || !this.options.plans) return;
    const view = await this.options.plans.get(latest.planId).catch(() => undefined);
    for (const step of view?.steps ?? [])
      if (step.evidence?.choice)
        await brain.unlearnChoice(step.evidence.choice.target, step.evidence.choice.candidates);
  }

  async #planEnded(brain: Brain, view: PlanView): Promise<void> {
    if (view.status === "RUNNING" || view.status === "AWAITING_APPROVAL") return;
    const experience = brain.experienceForPlan(view.id);
    if (experience?.outcome !== "pending") return;
    // Stopping on several matches is ambiguity on screen, not a misunderstanding.
    if (view.panels.some((panel) => panel.type === "candidates")) return;
    await brain.outcome(
      experience.id,
      view.status === "COMPLETED"
        ? "success"
        : view.status === "CANCELLED"
          ? "cancelled"
          : "failure",
    );
  }

  // Template speech for a proposed plan: a quick LOW-only outcome is narrated in the reply itself.
  async #planSay(proposed: PlanView, lang: Lang): Promise<string> {
    const plans = this.options.plans;
    if (!plans) return narrate({ type: "plan-uncertain" }, lang);
    const view = proposed.needsApproval ? proposed : await plans.waitSettled(proposed.id, 5000);
    const say = narrate(
      { type: "proposed", goal: view.goal, needsApproval: view.needsApproval },
      lang,
    );
    if (view.status === "RUNNING" || view.status === "AWAITING_APPROVAL") return say;
    return (await plans.claimNarration(view.id))
      ? (view.say ?? narrate({ type: "plan-uncertain" }, lang))
      : say;
  }

  async #remember(
    id: string,
    started: number,
    input: { utterance: string; followUp: boolean },
    taskId: string | null,
    reply: Reply,
    provider: string | null,
  ): Promise<void> {
    await this.tasks.db.query(
      "INSERT INTO conversation_turns(id,created_at,utterance,follow_up,task_id,reply,provider) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, started, input.utterance, input.followUp, taskId, JSON.stringify(reply), provider],
    );
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
    // What was learned from those conversations goes with them.
    await this.options.brain?.forgetAll();
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
