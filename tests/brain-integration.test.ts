import { type CompiledStep, compile } from "@jarvis/action-engine";
import { Brain } from "@jarvis/brain";
import { IntegrationHub } from "@jarvis/integration-hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Executor, Task } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { buildServer } from "../src/http/server.js";
import { PostgresBrainStore } from "../src/services/brain-store.js";
import { ConversationService } from "../src/services/conversation.js";
import type { BrainSettings } from "../src/services/permissions.js";
import { PlanService } from "../src/services/plans/index.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let db: Database;
let tasks: TaskService;
let brain: Brain;
let plans: PlanService;
let worker: Worker;
let stop: AbortController;
let running: Promise<void>;
let responses: unknown[];
let prompts: string[];
let desktopResults: string[];
let settings: BrainSettings;

const provider = (
  id: string,
  capability: Executor["capability"],
  execute: (task: Task) => Promise<string>,
) => ({
  id,
  capability,
  external: false,
  retrySafe: true,
  outcomeObservable: capability !== "text.generate",
  trustedForPrivate: true,
  enabled: true,
  authenticated: true,
  priority: 1,
  maxInputChars: 200_000,
  execute: async (task: Task) => ({ text: await execute(task), source: id }),
});
const reply = (intent: unknown, say = "Tamam") =>
  JSON.stringify({ addressed: true, say, lang: "tr", intent });
const open = (name: string) => ({
  kind: "plan",
  goal: `${name} aç`,
  steps: [{ action: "app.open", args: { name } }],
});

function start(hub?: IntegrationHub) {
  worker = new Worker(
    tasks,
    new ProviderRegistry([
      provider("gemini-live", "text.generate", async (task) => {
        prompts.push(task.spec.objective);
        return reply(responses.shift());
      }),
      provider("claude-code", "text.generate", async () => "Ajan raporu hazırladı, efendim."),
      provider("openclaw", "text.generate", async () => "UZUN AJAN ÇIKTISI"),
      provider(
        "windows-mcp",
        "desktop.act",
        async () =>
          desktopResults.shift() ?? '{"ok":true,"evidence":"postcondition","observation":"ok"}',
      ),
    ]),
  );
  running = worker.run(stop.signal);
  plans = new PlanService({
    tasks,
    wake: () => worker.wake(),
    onCancel: (id) => worker.cancel(id),
    conversationProviders: ["gemini-live"],
    privateProviders: ["claude-code"],
    ...(hub && { integrations: hub }),
    onChoice: (target, candidates, chosen) => void brain.learnChoice(target, candidates, chosen),
  });
  plans.start(stop.signal);
}
const conversation = () =>
  new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
    brain,
    settings: () => settings,
  });
const say = (utterance: string) => conversation().turn({ utterance, followUp: false });
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 2 });
  brain = new Brain(new PostgresBrainStore(db));
  await brain.load();
  stop = new AbortController();
  responses = [];
  prompts = [];
  desktopResults = [];
  settings = { learning: true, reflexes: true };
});
afterEach(async () => {
  stop.abort();
  await running;
  await db.close();
});

const pending = async () =>
  (
    await db.query<{ data: { outcome: string } }>("SELECT data FROM brain_experiences ORDER BY at")
  ).rows.map((row) => row.data.outcome);

describe("learning from conversation", () => {
  it("practised requests become a reflex that skips the model, then keeps learning", async () => {
    start();
    for (let i = 0; i < 3; i++) {
      responses.push(open("Spotify"));
      const turn = await say("Jarvis, Spotify'ı aç");
      expect(turn.planId).toBeTruthy();
      await until(pending, (outcomes) => !outcomes.includes("pending"));
    }
    expect(prompts).toHaveLength(3);
    expect(brain.stats().skills).toBe(1);
    const reflex = await say("Jarvis Spotify'ı aç lütfen");
    expect(reflex).toMatchObject({ provider: null, taskId: null });
    expect(reflex.planId).toBeTruthy();
    expect(prompts).toHaveLength(3);
    expect(reflex.say).toContain("Spotify açıldı");
    await until(pending, (outcomes) => outcomes.length === 4 && !outcomes.includes("pending"));
    expect(brain.skills()[0]).toMatchObject({ successes: 4, uses: 1 });
  });

  it("recalls similar past requests and Core's working memory into the prompt", async () => {
    start();
    responses.push(open("Spotify"));
    await say("Jarvis, Spotify'ı aç");
    await until(pending, (outcomes) => outcomes[0] === "success");
    responses.push({ kind: "reply" });
    await say("Jarvis, spotifayı tekrar açar mısın");
    const prompt = prompts[1] ?? "";
    expect(prompt).toContain("Requests this operator made before that worked");
    expect(prompt).toContain('"Jarvis, Spotify\'ı aç" → {"kind":"plan"');
    expect(prompt).toContain("Working memory");
    expect(prompt).toContain("Last finished");
    expect(prompt).toContain('Recently referred to: "Spotify"');
  });

  it("a correction marks the misunderstood request and the request goes on", async () => {
    start();
    responses.push(open("Spotify"));
    await say("Jarvis, Spotify'ı aç");
    await until(pending, (outcomes) => outcomes[0] === "success");
    responses.push(open("Not Defteri"));
    const next = await say("Hayır, Not Defteri'ni aç");
    expect(next.planId).toBeTruthy();
    expect((await pending())[0]).toBe("corrected");
  });

  it("answers a status question from Core's records without a model", async () => {
    start();
    const compiled = compile([{ action: "app.close", args: { name: "Notepad" } }]);
    if (!compiled.ok) throw new Error("fixture");
    await plans.propose({
      turnId: crypto.randomUUID(),
      goal: "Notepad'i kapat",
      lang: "tr",
      steps: compiled.steps,
    });
    const status = await say("Jarvis, durum ne?");
    expect(status.say).toBe("Notepad'i kapat: onayınızı bekliyorum, efendim.");
    expect(prompts).toHaveLength(0);
  });

  it("asks first when the model is unsure, and remembers that it asked", async () => {
    start();
    responses.push({ ...open("Spotify"), confidence: 0.3 });
    const unsure = await say("Jarvis, şeyi aç");
    expect(unsure.say).toBe("Spotify aç: bunu mu istiyorsunuz, efendim?");
    expect(unsure.planId).toBeUndefined();
    responses.push(open("Spotify"));
    await say("Evet");
    expect(prompts[1]).toContain("You just asked the operator");
  });

  it("confirms its reading of words speech recognition doubted", async () => {
    start();
    responses.push({ ...open("Spotify"), confidence: 0.7 });
    const doubtful = await conversation().turn({
      utterance: "Jarvis, spotifiyi aç",
      followUp: false,
      uncertain: true,
    });
    expect(doubtful.say).toBe("Spotify aç: bunu mu istiyorsunuz, efendim?");
    expect(doubtful.planId).toBeUndefined();
    expect(prompts[0]).toContain("Speech recognition was unsure");
  });

  it("learning off records nothing; reflexes off always deliberate", async () => {
    start();
    settings = { learning: false, reflexes: true };
    responses.push(open("Spotify"));
    await say("Jarvis, Spotify'ı aç");
    expect(await pending()).toEqual([]);
    settings = { learning: true, reflexes: false };
    for (let i = 0; i < 3; i++) {
      responses.push(open("Spotify"));
      await say("Spotify'ı aç");
      await until(pending, (outcomes) => !outcomes.includes("pending"));
    }
    responses.push(open("Spotify"));
    const deliberate = await say("Spotify'ı aç");
    expect(deliberate.provider).toBe("gemini-live");
  });

  it("learns the operator's pick among candidates for the same situation", async () => {
    start();
    const compiled = compile([{ action: "ui.click", args: { target: "Kaydet" } }]);
    if (!compiled.ok) throw new Error("fixture");
    desktopResults.push(
      JSON.stringify({
        ok: false,
        evidence: "observed-failure",
        observation: "two matches",
        candidates: ["Kaydet", "Kaydetme"],
      }),
    );
    const proposed = await plans.propose({
      turnId: crypto.randomUUID(),
      goal: "Kaydet",
      lang: "tr",
      steps: compiled.steps as CompiledStep[],
    });
    await plans.approve(proposed.id, proposed.hash);
    await plans.waitSettled(proposed.id, 5000);
    await say("ikincisi");
    await until(
      () => brain.preferredChoice("Kaydet", ["Kaydet", "Kaydetme"]),
      (choice) => choice !== undefined,
    );
    expect(brain.preferredChoice("Kaydet", ["Kaydetme", "Kaydet"])).toBe("Kaydetme");
  });
});

describe("continuing after the intent", () => {
  it("summarises what an agent brought back instead of just saying done", async () => {
    const hub = new IntegrationHub();
    hub.register("agent.delegate", () => ({
      capability: "text.generate",
      providers: ["openclaw"],
      objective: "delegate",
      input: {},
      risk: "LOW",
      privacy: "private",
      budget: { maxCalls: 1, maxDurationMs: 60_000, maxOutputTokens: 1024 },
      verification: { kind: "non-empty" },
    }));
    start(hub);
    const compiled = compile([{ action: "agent.delegate", args: { instruction: "araştır" } }]);
    if (!compiled.ok) throw new Error("fixture");
    const view = await plans.propose({
      turnId: crypto.randomUUID(),
      goal: "Araştır",
      lang: "tr",
      steps: compiled.steps.map((step) => ({ ...step, risk: "LOW" as const })),
    });
    const done = await until(
      () => plans.get(view.id),
      (current) => current.status === "COMPLETED",
    );
    expect(done.say).toBe("Ajan raporu hazırladı, efendim.");
  });
});

describe("brain API", () => {
  it("shows what was learned, sleeps on request and forgets", async () => {
    start();
    for (let i = 0; i < 2; i++) {
      responses.push(open("Spotify"));
      await say("Spotify'ı aç");
      await until(pending, (outcomes) => !outcomes.includes("pending"));
    }
    const operator = "operator-fixture-32-characters-minimum";
    const app = buildServer(tasks, new ProviderRegistry([]), {
      operatorToken: operator,
      webhookToken: "webhook-fixture-32-characters-minimum",
      onCancel: () => {},
      brain,
    });
    const headers = { authorization: `Bearer ${operator}` };
    try {
      expect((await app.inject({ method: "GET", url: "/v1/brain" })).statusCode).toBe(401);
      const learned = (await app.inject({ method: "GET", url: "/v1/brain", headers })).json();
      expect(learned.stats).toMatchObject({ experiences: 2, skills: 1 });
      expect(learned.skills[0]).toMatchObject({ goal: "Spotify aç", steps: ["app.open"] });
      const slept = await app.inject({ method: "POST", url: "/v1/brain/consolidate", headers });
      expect(slept.json()).toMatchObject({ experiences: 2 });
      const forgot = await app.inject({
        method: "DELETE",
        url: `/v1/brain/skills/${learned.skills[0].id}`,
        headers,
      });
      expect(forgot.statusCode).toBe(204);
      await app.inject({ method: "DELETE", url: "/v1/brain", headers });
      expect(brain.stats().experiences).toBe(0);
    } finally {
      await app.close();
    }
  });
});
