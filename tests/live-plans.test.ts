import { createIntegrationHub } from "@jarvis/integration-hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Progress, Task } from "../src/contracts.js";
import { ConversationService } from "../src/conversation.js";
import type { Database } from "../src/database.js";
import { Durations } from "../src/eta.js";
import { type Announcement, Narrator } from "../src/narrator.js";
import { PlanService, type PlanView } from "../src/plans.js";
import { type Provider, ProviderRegistry } from "../src/routing.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const urls = ["https://www.reuters.com/", "https://bbc.com/"];
const research = {
  kind: "plan",
  goal: "Haberlere bak",
  steps: [
    {
      action: "browser.read_many",
      args: {
        pages: [
          { url: urls[0], expectedText: "Reuters" },
          { url: urls[1], expectedText: "BBC" },
        ],
      },
    },
  ],
};

let db: Database;
let tasks: TaskService;
let stop: AbortController;
let running: Promise<void>[];
let replies: unknown[];
let prompts: string[];
let gates: (() => void)[];
let durations: Durations;
let announced: Announcement[];

function provider(
  id: string,
  capability: Provider["capability"],
  execute: (task: Task, progress?: (update: Progress) => void) => Promise<string>,
): Provider {
  return {
    id,
    capability,
    external: false,
    retrySafe: true,
    trustedForPrivate: true,
    enabled: true,
    authenticated: true,
    priority: 1,
    maxInputChars: 200_000,
    execute: async (task, _signal, progress) => ({
      text: await execute(task, progress),
      source: id,
    }),
  };
}
const gate = () =>
  new Promise<void>((open) => {
    gates.push(open);
  });

beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 2, interactive: 1 });
  stop = new AbortController();
  replies = [];
  prompts = [];
  gates = [];
  announced = [];
  durations = new Durations(db);
});
afterEach(async () => {
  for (const open of gates) open();
  stop.abort();
  await Promise.all(running);
  await db.close();
});

function start() {
  const registry = new ProviderRegistry([
    provider("gemini-live", "text.generate", async (task) => {
      prompts.push(task.spec.objective);
      const next = replies.shift() ?? { kind: "reply" };
      const say = typeof next === "string" ? next : "Tamam";
      // Spoken result briefs are plain text; conversation turns are JSON.
      if (task.spec.responseFormat !== "json") return say;
      return JSON.stringify({
        addressed: true,
        say,
        lang: "tr",
        intent: typeof next === "string" ? { kind: "reply" } : next,
      });
    }),
    // The page reader reports each page as it opens it, then waits to be let go.
    provider("browser-use", "browser.extract", async (_task, progress) => {
      progress?.({ stage: "reading", detail: "reuters.com", index: 1, total: 2 });
      await gate();
      progress?.({ stage: "reading", detail: "bbc.com", index: 2, total: 2 });
      await gate();
      return "Reuters: piyasalar sakin\n\n---\n\nBBC: seçim haberleri";
    }),
    provider(
      "windows-mcp",
      "desktop.act",
      async () => '{"ok":true,"evidence":"postcondition","observation":"ok"}',
    ),
  ]);
  const workers = [
    new Worker(tasks, registry),
    new Worker(tasks, registry, undefined, {}, undefined, ["interactive"]),
  ];
  running = workers.map((worker) => worker.run(stop.signal));
  const wake = () => {
    for (const worker of workers) worker.wake();
  };
  const plans = new PlanService({
    tasks,
    wake,
    onCancel: (id) => {
      for (const worker of workers) worker.cancel(id);
    },
    conversationProviders: ["gemini-live"],
    privateProviders: [],
    integrations: createIntegrationHub({ browserUrls: urls }),
    durations,
  });
  plans.start(stop.signal);
  plans.on("announce", (announcement: Announcement) => announced.push(announcement));
  new Narrator(plans, { pacing: { quietMs: 0, longMs: 0, gapMs: 0 } }).start(stop.signal);
  const conversation = new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake,
    plans,
    deadlineMs: 5000,
  });
  const say = (utterance: string) => conversation.turn({ utterance, followUp: false });
  return { plans, say };
}
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("talking while JARVIS works", () => {
  it("acknowledges at once, says where it looks, answers in between and learns the timing", async () => {
    const { plans, say } = start();
    replies.push(research);
    const started = Date.now();
    const ack = await say("Jarvis, Reuters ve BBC'de ne var bir bak");
    // No waiting on the research: what it does, where, and about how long.
    expect(Date.now() - started).toBeLessThan(2500);
    expect(ack.say).toBe(
      "Reuters.com ve bbc.com sayfalarına bakıyorum, efendim; yaklaşık 20 saniye sürer. Bu arada başka bir şey isterseniz buradayım.",
    );
    const planId = ack.planId ?? "";
    const reading = await until(
      () => plans.get(planId),
      (view: PlanView) => view.progress?.detail === "reuters.com",
    );
    expect(reading.progress).toMatchObject({
      step: 1,
      steps: 1,
      action: "browser.read_many",
      stage: "reading",
      index: 1,
      total: 2,
    });
    expect(reading.progress?.etaAt).toBeGreaterThan(Date.now());

    // A status question is answered from Core's records, without a model call.
    const status = await say("Jarvis, durum ne?");
    expect(status.provider).toBeNull();
    expect(status.say).toMatch(
      /^Haberlere bak: şu an reuters\.com sayfasını okuyorum; .* kaldı, efendim\.$/,
    );

    // Small talk goes on while the pages are read, and the model knows where things are.
    replies.push("Saat on, efendim.");
    const chat = await say("Jarvis, bu arada saat kaç?");
    expect(chat.say).toBe("Saat on, efendim.");
    expect(prompts.at(-1)).toContain('Running: "Haberlere bak" (browser.read_many) — step 1 of 1');
    expect(prompts.at(-1)).toContain("now on reuters.com");
    expect((await plans.get(planId)).status).toBe("RUNNING");

    gates.shift()?.();
    await until(
      () => announced,
      (list) => list.some((a) => a.kind === "progress" && a.text.includes("bbc.com")),
    );
    expect(announced.find((a) => a.text.includes("bbc.com"))).toMatchObject({
      text: "Son sayfa, bbc.com.",
      kind: "progress",
      planId,
    });
    replies.push("Reuters'ta piyasalar sakin, BBC seçimleri yazıyor.");
    gates.shift()?.();
    const done = await until(
      () => plans.get(planId),
      (view: PlanView) => view.status === "COMPLETED",
    );
    expect(done.say).toBe("Reuters'ta piyasalar sakin, BBC seçimleri yazıyor.");
    // What it measured replaces the starting guess for the next time.
    expect(durations.estimate("browser.page")).toBeLessThan(8000);
  });

  it("still waits for quick plans so the reply says how they ended", async () => {
    const { say } = start();
    replies.push({
      kind: "plan",
      goal: "Not Defteri aç",
      steps: [{ action: "app.open", args: { name: "Not Defteri" } }],
    });
    const quick = await say("Jarvis, Not Defteri'ni aç");
    expect(quick.say).toBe("Not Defteri açıldı, efendim.");
  });
});
