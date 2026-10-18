import { catalogLines, compile } from "@jarvis/action-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/contracts.js";
import { ConversationService } from "../src/conversation.js";
import type { Database } from "../src/database.js";
import { MemoryExecutor, MemoryStore, maxMemories } from "../src/memory.js";
import { conversationPrompt } from "../src/persona.js";
import { PlanService } from "../src/plans.js";
import { ProviderFailure, ProviderRegistry } from "../src/routing.js";
import { buildServer } from "../src/server.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let db: Database;
let store: MemoryStore;
beforeEach(async () => {
  db = await memoryDatabase();
  store = new MemoryStore(db);
});
afterEach(async () => {
  await db.close();
});

describe("memory store", () => {
  it("saves a note once, newest first, and forgets by topic", async () => {
    expect(await store.save("Annemin doğum günü 3 Mayıs")).toMatchObject({ ok: true });
    expect(await store.save("  annemin  DOĞUM günü 3 mayıs ")).toMatchObject({
      ok: true,
      observation: "already remembered",
    });
    await store.save("Kahvemi sade içerim");
    expect((await store.list()).map((m) => m.note)).toEqual([
      "Kahvemi sade içerim",
      "Annemin doğum günü 3 Mayıs",
    ]);
    expect(await store.forget("doğum günü")).toMatchObject({
      ok: true,
      observation: "1 notes forgotten",
    });
    expect(await store.forget("tatil planı")).toMatchObject({ ok: false });
    expect((await store.list()).map((m) => m.note)).toEqual(["Kahvemi sade içerim"]);
  });

  it("refuses credentials and stops at the size cap", async () => {
    expect(await store.save("Wi-Fi şifrem kedi123")).toMatchObject({
      ok: false,
      evidence: "refused",
    });
    expect(await store.list()).toEqual([]);
    for (let index = 0; index < maxMemories; index++)
      await db.query(
        "INSERT INTO memories(id,note,normalized,created_at) VALUES(gen_random_uuid(),$1,$1,$2)",
        [`not ${index}`, index],
      );
    expect(await store.save("bir tane daha")).toMatchObject({ ok: false });
  });

  it("bounds the notes it hands to the prompt", async () => {
    for (let index = 0; index < 20; index++) await store.save(`${index} ${"x".repeat(300)}`);
    const notes = await store.promptNotes();
    expect(notes.join("").length).toBeLessThanOrEqual(3000);
    expect(notes[0]?.startsWith("19 ")).toBe(true);
  });
});

describe("memory executor", () => {
  const task = (input: unknown, overrides: Record<string, unknown> = {}) =>
    ({
      spec: TaskSpecSchema.parse({
        objective: "remember",
        capability: "memory.write",
        providers: ["memory"],
        risk: "MEDIUM",
        input,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: '"ok":true' },
        ...overrides,
      }),
    }) as Task;

  it("runs only compiled memory steps at their catalog risk", async () => {
    const executor = new MemoryExecutor(store);
    const signal = new AbortController().signal;
    const saved = await executor.execute(
      task({ action: "memory.save", args: { note: "Toplantılar salı" } }),
      signal,
    );
    expect(JSON.parse(saved.text)).toMatchObject({ ok: true, observation: "remembered" });
    await expect(
      executor.execute(task({ action: "app.open", args: { name: "Notepad" } }), signal),
    ).rejects.toBeInstanceOf(ProviderFailure);
    await expect(
      executor.execute(
        task({ action: "memory.save", args: { note: "x" } }, { risk: "LOW" }),
        signal,
      ),
    ).rejects.toMatchObject({ kind: "policy-denied" });
  });
});

describe("memory in plans and conversation", () => {
  let tasks: TaskService;
  let stop: AbortController;
  let running: Promise<void>;
  let plans: PlanService;
  const start = (memory: boolean) => {
    tasks = new TaskService(db);
    const executor = new MemoryExecutor(store);
    const worker = new Worker(
      tasks,
      new ProviderRegistry([
        {
          id: executor.id,
          capability: executor.capability,
          external: executor.external,
          retrySafe: executor.retrySafe,
          outcomeObservable: executor.outcomeObservable,
          enabled: true,
          authenticated: true,
          priority: 10,
          maxInputChars: 20_000,
          execute: executor.execute.bind(executor),
        },
      ]),
    );
    stop = new AbortController();
    running = worker.run(stop.signal);
    plans = new PlanService({
      tasks,
      wake: () => worker.wake(),
      onCancel: (id) => worker.cancel(id),
      conversationProviders: [],
      privateProviders: [],
      memory,
    });
  };
  afterEach(async () => {
    stop?.abort();
    await running;
  });
  const steps = (action: string, args: Record<string, unknown>) => {
    const compiled = compile([{ action, args }]);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    return compiled.steps;
  };

  it("saves a note only after the operator approves the plan", async () => {
    start(true);
    const proposed = await plans.propose({
      turnId: crypto.randomUUID(),
      goal: "Hatırla",
      lang: "tr",
      steps: steps("memory.save", { note: "Ali'nin doğum günü 12 Haziran" }),
    });
    expect(proposed.needsApproval).toBe(true);
    expect(await store.list()).toEqual([]);
    await plans.approve(proposed.id, proposed.hash);
    const done = await plans.waitSettled(proposed.id, 5000);
    expect(done.status).toBe("COMPLETED");
    expect((await store.list()).map((m) => m.note)).toEqual(["Ali'nin doğum günü 12 Haziran"]);
  });

  it("rejects memory steps when memory is disabled", async () => {
    start(false);
    await expect(
      plans.propose({
        turnId: crypto.randomUUID(),
        goal: "Hatırla",
        lang: "tr",
        steps: steps("memory.save", { note: "x" }),
      }),
    ).rejects.toThrow("MEMORY_DISABLED");
    expect(plans.optionalActions()).toEqual([]);
  });

  it("offers memory actions and notes to the model only when enabled", async () => {
    start(true);
    expect(plans.optionalActions()).toEqual(["memory.save", "memory.forget"]);
    expect(catalogLines(new Set())).not.toContain("memory.save");
    expect(catalogLines(new Set(plans.optionalActions()))).toContain("memory.save(note: string)");
    await store.save("Kahvemi sade içerim");
    const conversation = new ConversationService(tasks, {
      providers: ["fake"],
      wake: () => {},
      deadlineMs: 300,
      plans,
      memory: store,
    });
    // The turn fails without a provider; the prompt it admitted is what matters.
    await conversation
      .turn({ utterance: "Jarvis, kahveyi nasıl içerim?", followUp: false })
      .catch(() => {});
    const prompt = String(
      (
        await db.query<{ objective: string }>(
          "SELECT spec->>'objective' AS objective FROM tasks WHERE idempotency_key LIKE 'conversation:%'",
        )
      ).rows[0]?.objective,
    );
    expect(prompt).toContain("- Kahvemi sade içerim");
    expect(prompt).toContain("memory.save(note: string)");
    expect(
      conversationPrompt({ utterance: "x", followUp: false, history: [], now: new Date() }),
    ).not.toContain("Notes the operator asked you to remember");
  });
});

describe("memory API", () => {
  const operator = "operator-fixture-32-characters-minimum";
  it("lists and forgets notes for the operator only", async () => {
    await store.save("Kahvemi sade içerim");
    const app = buildServer(new TaskService(db), new ProviderRegistry([]), {
      operatorToken: operator,
      webhookToken: "webhook-fixture-32-characters-minimum",
      onCancel: () => {},
      memory: store,
    });
    const auth = { authorization: `Bearer ${operator}` };
    expect((await app.inject({ method: "GET", url: "/v1/memories" })).statusCode).toBe(401);
    const listed = await app.inject({ method: "GET", url: "/v1/memories", headers: auth });
    const [note] = listed.json().memories;
    expect(note.note).toBe("Kahvemi sade içerim");
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/memories/${note.id}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(204);
    const again = await app.inject({
      method: "DELETE",
      url: `/v1/memories/${note.id}`,
      headers: auth,
    });
    expect(again.statusCode).toBe(404);
    await store.save("bir not");
    await app.inject({ method: "DELETE", url: "/v1/memories", headers: auth });
    expect(await store.list()).toEqual([]);
    await app.close();
  });
});
