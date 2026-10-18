import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskSpecSchema } from "../src/contracts.js";
import type { Database } from "../src/database.js";
import { ProviderRegistry } from "../src/routing.js";
import { buildServer } from "../src/server.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const spec = () => ({
  objective: "Say hello",
  capability: "text.generate",
  providers: ["instant"],
  deadline: new Date(Date.now() + 60_000).toISOString(),
  verification: { kind: "non-empty" },
});
const registry = new ProviderRegistry([
  {
    id: "instant",
    capability: "text.generate",
    external: false,
    retrySafe: true,
    enabled: true,
    authenticated: true,
    priority: 1,
    maxInputChars: 20_000,
    execute: async () => ({ text: "hello", source: "instant" }),
  },
]);

describe("worker wake", () => {
  let db: Database;
  let tasks: TaskService;
  beforeEach(async () => {
    db = await memoryDatabase();
    tasks = new TaskService(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("wake shortens the idle wait", async () => {
    const worker = new Worker(tasks, registry);
    const stop = new AbortController();
    const running = worker.run(stop.signal);
    await delay(50);
    const task = await tasks.create(TaskSpecSchema.parse(spec()), "wake", "operator");
    const admitted = Date.now();
    worker.wake();
    while ((await tasks.get(task.id)).status !== "COMPLETED" && Date.now() - admitted < 1000)
      await delay(10);
    expect((await tasks.get(task.id)).status).toBe("COMPLETED");
    expect(Date.now() - admitted).toBeLessThan(250);
    stop.abort();
    await running;
  });

  it("task admission calls onAdmit", async () => {
    let admitted = 0;
    const app = buildServer(tasks, registry, {
      operatorToken: "operator-fixture-32-characters-minimum",
      webhookToken: "webhook-fixture-32-characters-minimum",
      onCancel: () => {},
      onAdmit: () => admitted++,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: {
        authorization: "Bearer operator-fixture-32-characters-minimum",
        "idempotency-key": "admit",
      },
      payload: spec(),
    });
    expect(response.statusCode).toBe(201);
    expect(admitted).toBe(1);
    await app.close();
  });
});
