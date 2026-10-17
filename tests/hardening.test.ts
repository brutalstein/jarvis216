import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fingerprint, TaskSpecSchema } from "../src/contracts.js";
import { type Database, migrate } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { ClaudeExecutor } from "../src/integrations/models.js";
import { OpenClawExecutor } from "../src/integrations/services.js";
import { ProviderFailure } from "../src/routing.js";
import { TaskService } from "../src/tasks.js";

let pg: PGlite;
let db: Database;
let tasks: TaskService;
beforeEach(async () => {
  pg = new PGlite();
  db = {
    query: (s, p) => pg.query(s, p as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  await migrate(db);
  tasks = new TaskService(db, {
    concurrency: 2,
    redact: (text) => text.replaceAll("s3cret-value", "[REDACTED]"),
  });
});
afterEach(async () => {
  await db.close();
});

function spec(overrides: Record<string, unknown> = {}) {
  return TaskSpecSchema.parse({
    objective: "Return verified",
    capability: "text.generate",
    providers: ["openclaw"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "contains", value: "verified" },
    ...overrides,
  });
}
async function closedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  server.close();
  await once(server, "close");
  return address.port;
}
async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return address.port;
}

it("hashes keys by code unit, independent of the process locale", () => {
  const value = { b: 1, B: 2, a: 3, _: 4 };
  const expected = createHash("sha256").update('{"B":2,"_":4,"a":3,"b":1}').digest("hex");
  expect(fingerprint(value)).toBe(expected);
});

it("treats a refused connection as a definite failure, not an uncertain side effect", async () => {
  const task = await tasks.create(spec(), "refused", "operator");
  const executor = new OpenClawExecutor(`http://127.0.0.1:${await closedPort()}`, "token", "agent");
  const status = await new ActionGateway(tasks).run(
    (await tasks.claim("w", 10_000))!,
    executor,
    new AbortController().signal,
  );
  expect(status).toBe("FAILED");
  expect((await tasks.actions(task.id))[0]?.status).toBe("FAILED");
});

it("keeps a dropped response from a non-retry-safe service uncertain", async () => {
  const server = createServer((req) => req.socket.destroy());
  const port = await listen(server);
  try {
    const task = await tasks.create(spec(), "dropped", "operator");
    const executor = new OpenClawExecutor(`http://127.0.0.1:${port}`, "token", "agent");
    await new ActionGateway(tasks).run(
      (await tasks.claim("w", 10_000))!,
      executor,
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("RECOVERY_REQUIRED");
    expect((await tasks.actions(task.id))[0]?.status).toBe("UNCERTAIN");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it("classifies Claude SDK timeouts and refused connections as transient and retryable", async () => {
  const server = createServer(() => {});
  const port = await listen(server);
  try {
    for (const baseURL of [`http://127.0.0.1:${port}`, `http://127.0.0.1:${await closedPort()}`]) {
      const client = new Anthropic({ apiKey: "fixture-key", baseURL, maxRetries: 0, timeout: 200 });
      const error = await new ClaudeExecutor("fixture-key", "model", client)
        .execute(
          await tasks.get((await tasks.create(spec(), baseURL, "operator")).id),
          new AbortController().signal,
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderFailure);
      expect(error).toMatchObject({ kind: "transient", retryable: true });
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it("fails a retry-safe call that exhausted the task deadline instead of demanding reconciliation", async () => {
  const task = await tasks.create(spec({ providers: ["model"] }), "deadline", "operator");
  const claim = (await tasks.claim("w", 10_000))!;
  await db.query("UPDATE tasks SET created_at=$2 WHERE id=$1", [task.id, Date.now() - 59_800]);
  const status = await new ActionGateway(tasks).run(
    { ...claim, created_at: Date.now() - 59_800 },
    {
      id: "model",
      capability: "text.generate",
      external: true,
      retrySafe: true,
      execute: (_task, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
    },
    new AbortController().signal,
  );
  expect(status).toBe("FAILED");
});

it("redacts known secrets from operator reconciliation evidence", async () => {
  const task = await tasks.create(spec({ providers: ["svc"] }), "reconcile-redact", "operator");
  await new ActionGateway(tasks).run(
    (await tasks.claim("w", 10_000))!,
    {
      id: "svc",
      capability: "text.generate",
      external: true,
      retrySafe: false,
      execute: async () => {
        throw new Error("lost");
      },
    },
    new AbortController().signal,
  );
  const [action] = await tasks.actions(task.id);
  await tasks.reconcile(
    action!.id,
    "COMPLETED",
    "verified readback token s3cret-value",
    "operator",
  );
  expect((await tasks.get(task.id)).result?.text).toBe("verified readback token [REDACTED]");
  expect(JSON.stringify(await tasks.events(task.id))).not.toContain("s3cret-value");
});

it("chains each task event to the event that caused it", async () => {
  const task = await tasks.create(spec(), "causation", "operator");
  await tasks.cancel(task.id);
  const envelopes = (
    (await tasks.events(task.id)) as {
      envelope: { messageId: string; causationId: string | null; type: string };
    }[]
  ).map((e) => e.envelope);
  expect(envelopes.length).toBeGreaterThan(3);
  expect(envelopes[0]?.causationId).toBeNull();
  for (let i = 1; i < envelopes.length; i++)
    expect(envelopes[i]?.causationId).toBe(envelopes[i - 1]?.messageId);
  expect(envelopes.map((e) => e.type)).toContain("cancellation.requested");
});
