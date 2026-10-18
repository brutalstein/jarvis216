import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskSpecSchema } from "../src/contracts.js";
import type { Database } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { Outbox } from "../src/outbox.js";
import { TaskService } from "../src/tasks.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const token = "callback-token-fixture-32-characters-min";
const spec = (overrides: Record<string, unknown> = {}) =>
  TaskSpecSchema.parse({
    objective: "Return exactly JARVIS_OK",
    capability: "text.generate",
    providers: ["fixture"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "contains", value: "JARVIS_OK" },
    ...overrides,
  });
const executor = {
  id: "fixture",
  capability: "text.generate" as const,
  external: false,
  retrySafe: true,
  execute: async () => ({ text: "JARVIS_OK", source: "fixture" }),
};

let db: Database;
let tasks: TaskService;
let received: { headers: IncomingHttpHeaders; body: Record<string, unknown> }[];
let statuses: number[];
let server: ReturnType<typeof createServer>;
let url: string;
beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 2, outbox: { principals: ["n8n"] } });
  received = [];
  statuses = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.statusCode = statuses.shift() ?? 200;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/jarvis-events`;
});
afterEach(async () => {
  server.close();
  await db.close();
});
const pending = async () =>
  (
    await db.query<{ status: string; attempts: number; delivered_at: unknown; failed_at: unknown }>(
      "SELECT status,attempts,delivered_at,failed_at FROM deliveries ORDER BY created_at,id",
    )
  ).rows;

describe("transactional outbox", () => {
  it("queues notable transitions of the configured principal only, with the commit", async () => {
    const mine = await tasks.create(spec(), "n8n:evt-1", "n8n");
    await tasks.create(spec(), "operator-task", "operator");
    expect(await pending()).toEqual([]);
    await expect(
      tasks.locked(async (tx) => {
        await tasks.move(tx, await tasks.get(mine.id, tx), "CANCELLED", "rolled back");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await pending()).toEqual([]);
    await tasks.cancel(mine.id);
    expect((await pending()).map((row) => row.status)).toEqual(["CANCELLED"]);
  });

  it("pushes a verified completion with its result once, authenticated and idempotent", async () => {
    const task = await tasks.create(spec(), "n8n:evt-2", "n8n");
    await new ActionGateway(tasks).run(
      (await tasks.claim("w", 10_000))!,
      executor,
      new AbortController().signal,
    );
    const outbox = new Outbox(db, { url, token });
    expect(await outbox.deliverDue()).toBe(1);
    expect(await outbox.deliverDue()).toBe(0);
    expect(received).toHaveLength(1);
    const [event] = received;
    expect(event?.headers.authorization).toBe(`Bearer ${token}`);
    expect(event?.headers["x-jarvis-idempotency-key"]).toBe(event?.body.eventId);
    expect(event?.body).toMatchObject({
      protocolVersion: 1,
      type: "task.status",
      taskId: task.id,
      status: "COMPLETED",
      result: { text: "JARVIS_OK", source: "fixture" },
    });
    expect((await pending())[0]?.delivered_at).not.toBeNull();
  });

  it("never carries a result for anything but a verified completion", async () => {
    await tasks.create(spec({ risk: "HIGH" }), "n8n:evt-3", "n8n");
    await new ActionGateway(tasks).run(
      (await tasks.claim("w", 10_000))!,
      executor,
      new AbortController().signal,
    );
    await new Outbox(db, { url, token }).deliverDue();
    expect(received[0]?.body).toMatchObject({ status: "WAITING_FOR_APPROVAL", result: null });
  });

  it("retries with backoff and dead-letters after the last attempt", async () => {
    await tasks.cancel((await tasks.create(spec(), "n8n:evt-4", "n8n")).id);
    let now = Date.now() + 1;
    statuses.push(500, 503);
    const outbox = new Outbox(db, { url, token }, { maxAttempts: 2, now: () => now });
    expect(await outbox.deliverDue()).toBe(0);
    expect((await pending())[0]).toMatchObject({ attempts: 1, failed_at: null });
    // Not due yet: backoff holds the retry back.
    expect(await outbox.deliverDue()).toBe(0);
    expect(received).toHaveLength(1);
    now += 10_000;
    expect(await outbox.deliverDue()).toBe(0);
    expect((await pending())[0]?.failed_at).not.toBeNull();
    now += 600_000;
    await outbox.deliverDue();
    expect(received).toHaveLength(2);
  });

  it("recovers once the receiver is back", async () => {
    await tasks.cancel((await tasks.create(spec(), "n8n:evt-5", "n8n")).id);
    let now = Date.now() + 1;
    statuses.push(502);
    const outbox = new Outbox(db, { url, token }, { now: () => now });
    await outbox.deliverDue();
    now += 10_000;
    expect(await outbox.deliverDue()).toBe(1);
    expect(received.map((event) => event.body.eventId)).toEqual([
      received[0]?.body.eventId,
      received[0]?.body.eventId,
    ]);
  });

  it("refuses a plain-HTTP callback to a remote host", () => {
    expect(() => new Outbox(db, { url: "http://example.com/hook", token })).toThrow(
      "REMOTE_SERVICE_REQUIRES_TLS",
    );
  });
});

describe("callback configuration", () => {
  const base = {
    DATABASE_URL: "postgresql://jarvis:local-secret@127.0.0.1:55432/jarvis",
    JARVIS_TOKEN: "operator-token-fixture-32-characters-x",
    N8N_INGRESS_TOKEN: "ingress-token-fixture-32-characters-x",
  };
  it("needs the URL and a strong token together", async () => {
    const { ConfigSchema } = await import("../src/config.js");
    expect(ConfigSchema.safeParse(base).success).toBe(true);
    expect(
      ConfigSchema.safeParse({ ...base, N8N_CALLBACK_URL: "", N8N_CALLBACK_TOKEN: "" }).success,
    ).toBe(true);
    expect(
      ConfigSchema.safeParse({ ...base, N8N_CALLBACK_URL: "http://n8n:5678/webhook/x" }).success,
    ).toBe(false);
    expect(
      ConfigSchema.safeParse({
        ...base,
        N8N_CALLBACK_URL: "http://n8n:5678/webhook/x",
        N8N_CALLBACK_TOKEN: "short",
      }).success,
    ).toBe(false);
    expect(
      ConfigSchema.safeParse({
        ...base,
        N8N_CALLBACK_URL: "http://n8n:5678/webhook/x",
        N8N_CALLBACK_TOKEN: token,
      }).success,
    ).toBe(true);
  });
});
