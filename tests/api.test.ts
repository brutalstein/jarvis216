import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, migrate } from "../src/database.js";
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
});
