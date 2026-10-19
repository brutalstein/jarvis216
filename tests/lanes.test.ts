import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../src/core/contracts.js";
import { TaskSpecSchema } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { type Provider, ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { ConversationService } from "../src/services/conversation.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const spec = (overrides: Record<string, unknown> = {}) =>
  TaskSpecSchema.parse({
    objective: "Work",
    capability: "text.generate",
    providers: ["slow"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "non-empty" },
    ...overrides,
  });

let db: Database;
let tasks: TaskService;
beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 1, interactive: 1 });
});
afterEach(async () => {
  await db.close();
});

describe("interactive lane", () => {
  it("a spoken turn is claimed even while background capacity is full", async () => {
    await tasks.create(spec(), "agent", "operator");
    expect(await tasks.claim("w1", 10_000)).toMatchObject({ spec: { objective: "Work" } });
    await tasks.create(spec(), "queued", "operator");
    await tasks.create(spec({ objective: "Turn", lane: "interactive" }), "turn", "operator");
    const turn = await tasks.claim("w2", 10_000);
    expect(turn?.spec.objective).toBe("Turn");
    // Both lanes are full now; the queued background task waits.
    expect(await tasks.claim("w3", 10_000)).toBeNull();
  });

  it("goes ahead of older background work and has its own capability budget", async () => {
    tasks = new TaskService(db, { concurrency: 3, interactive: 1, limits: { "text.generate": 1 } });
    await tasks.create(spec({ objective: "Brief" }), "brief", "operator");
    await tasks.create(spec({ objective: "Older" }), "older", "operator");
    await tasks.create(spec({ objective: "Turn", lane: "interactive" }), "turn", "operator");
    expect((await tasks.claim("a", 10_000))?.spec.objective).toBe("Turn");
    expect((await tasks.claim("b", 10_000))?.spec.objective).toBe("Brief");
    // text.generate is at its background limit; the interactive turn did not count against it.
    expect(await tasks.claim("c", 10_000)).toBeNull();
  });

  it("an interactive-only worker never takes background work", async () => {
    await tasks.create(spec(), "background", "operator");
    expect(await tasks.claim("voice", 10_000, ["interactive"])).toBeNull();
    expect(await tasks.claim("general", 10_000)).not.toBeNull();
  });

  it("is honoured for the operator only, and only with interactive capacity", async () => {
    await tasks.create(spec({ objective: "Busy" }), "busy", "operator");
    await tasks.claim("w", 10_000);
    await tasks.create(spec({ lane: "interactive" }), "n8n", "n8n");
    expect(await tasks.claim("voice", 10_000, ["interactive"])).toBeNull();
    const plain = new TaskService(db, { concurrency: 1 });
    await tasks.create(spec({ lane: "interactive" }), "operator-turn", "operator");
    // Without reserved capacity the lane is ignored: background is full, nothing runs.
    expect(await plain.claim("w", 10_000)).toBeNull();
    expect((await tasks.claim("voice", 10_000, ["interactive"]))?.principal).toBe("operator");
  });

  it("recovery runs at most once per interval for all workers", async () => {
    let passes = 0;
    const recover = tasks.recover.bind(tasks);
    tasks.recover = async () => {
      passes++;
      await recover();
    };
    await Promise.all([tasks.recoverDue(), tasks.recoverDue(), tasks.recoverDue()]);
    await tasks.recoverDue();
    expect(passes).toBe(1);
    await tasks.recoverDue(0);
    expect(passes).toBe(2);
  });
});

describe("conversation while JARVIS works", () => {
  it("answers a spoken turn while a long agent task holds the only background worker", async () => {
    let release = () => {};
    const agentRunning = new Promise<void>((started) => {
      release = started;
    });
    let finishAgent = () => {};
    const agentDone = new Promise<void>((resolve) => {
      finishAgent = resolve;
    });
    const provider = (id: string, execute: (task: Task) => Promise<string>): Provider => ({
      id,
      capability: "text.generate",
      external: false,
      retrySafe: true,
      trustedForPrivate: true,
      enabled: true,
      authenticated: true,
      priority: 1,
      maxInputChars: 200_000,
      execute: async (task) => ({ text: await execute(task), source: id }),
    });
    const registry = new ProviderRegistry([
      provider("slow", async () => {
        release();
        await agentDone;
        return "report";
      }),
      provider("gemini-live", async () =>
        JSON.stringify({ addressed: true, say: "Buradayım, efendim.", lang: "tr" }),
      ),
    ]);
    const stop = new AbortController();
    const workers = [
      new Worker(tasks, registry),
      new Worker(tasks, registry, undefined, {}, undefined, ["interactive"]),
    ];
    const running = workers.map((worker) => worker.run(stop.signal));
    try {
      await tasks.create(spec({ objective: "Research" }), "agent", "operator");
      for (const worker of workers) worker.wake();
      await agentRunning;
      const turn = await new ConversationService(tasks, {
        providers: ["gemini-live"],
        wake: () => {
          for (const worker of workers) worker.wake();
        },
        deadlineMs: 5000,
      }).turn({ utterance: "Jarvis, orada mısın?", followUp: false });
      expect(turn.say).toBe("Buradayım, efendim.");
    } finally {
      finishAgent();
      stop.abort();
      await Promise.all(running);
    }
  });
});
