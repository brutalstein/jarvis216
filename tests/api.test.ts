import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, migrate } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { ProviderRegistry } from "../src/routing.js";
import { buildServer } from "../src/server.js";
import { TaskService } from "../src/tasks.js";

const operatorToken = "test-operator-token-with-32-characters";
const webhookToken = "test-webhook-token-with-32-characters";
let db: Database;
let tasks: TaskService;
let app: ReturnType<typeof buildServer>;
beforeAll(async () => {
  const pg = new PGlite();
  db = {
    query: (s, p) => pg.query(s, p as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  await migrate(db);
  tasks = new TaskService(db);
  app = buildServer(tasks, new ProviderRegistry([]), {
    operatorToken,
    webhookToken,
    onCancel: () => {},
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});
describe("local control boundary", () => {
  it("denies unauthenticated tasks and webhook credentials on operator endpoints", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/tasks", payload: {} })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tasks",
          headers: { authorization: `Bearer ${webhookToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  });
  it("admits signed-in operator plans and validates schema without leaking input", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${operatorToken}`, "idempotency-key": "api-test" },
      payload: {
        objective: "Return verified",
        capability: "text.generate",
        providers: ["test"],
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: "verified" },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("READY");
    const bad = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { secret: "must-not-appear" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain("must-not-appear");
  });
  it("deduplicates n8n events and denies replay with altered payload", async () => {
    const payload = {
      eventId: "event-42",
      sentAt: new Date().toISOString(),
      objective: "Return verified",
      verificationText: "verified",
    };
    const request = {
      method: "POST" as const,
      url: "/v1/hooks/n8n",
      headers: { authorization: `Bearer ${webhookToken}` },
      payload,
    };
    const first = await app.inject(request);
    const duplicate = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(duplicate.json().id).toBe(first.json().id);
    const changed = await app.inject({
      ...request,
      payload: { ...payload, objective: "Changed content" },
    });
    expect(changed.statusCode).toBe(409);
  });
  it("lists tasks with bounded pagination and status filter for a future control surface", async () => {
    const auth = { authorization: `Bearer ${operatorToken}` };
    expect((await app.inject({ url: "/v1/tasks" })).statusCode).toBe(401);
    const page = await app.inject({ url: "/v1/tasks?limit=1", headers: auth });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toHaveLength(1);
    expect(page.json()[0]).toMatchObject({ id: expect.any(String), status: expect.any(String) });
    const ready = await app.inject({ url: "/v1/tasks?status=READY", headers: auth });
    expect(ready.json().every((t: { status: string }) => t.status === "READY")).toBe(true);
    expect((await app.inject({ url: "/v1/tasks?limit=1000", headers: auth })).statusCode).toBe(400);
  });
  it("reports task duration and retry metrics", async () => {
    const task = await tasks.create(
      {
        objective: "Return verified",
        capability: "text.generate",
        providers: ["metric"],
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: "verified" },
      },
      "metrics-task",
      "operator",
    );
    await db.query("UPDATE tasks SET status='CANCELLED' WHERE id<>$1 AND status='READY'", [
      task.id,
    ]);
    await new ActionGateway(tasks).run(
      (await tasks.claim("w", 10_000))!,
      {
        id: "metric",
        capability: "text.generate",
        external: false,
        retrySafe: true,
        execute: async () => ({ text: "verified", source: "fixture" }),
      },
      new AbortController().signal,
    );
    const metrics = await app.inject({
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(metrics.json()).toMatchObject({
      completedDurationMs: { count: 1, p50: expect.any(Number), p95: expect.any(Number) },
      retries: 0,
    });
  });
});
