import { once } from "node:events";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type Executor, TaskSpecSchema } from "../src/contracts.js";
import { type Database, migrate } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { OpenClawExecutor, WorkflowExecutor } from "../src/integrations/services.js";
import { type Provider, ProviderFailure, ProviderRegistry } from "../src/routing.js";
import { buildServer } from "../src/server.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";

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
  tasks = new TaskService(db);
});
afterEach(async () => {
  await db.close();
});

function spec(overrides: Record<string, unknown> = {}) {
  return TaskSpecSchema.parse({
    objective: "Return verified",
    capability: "text.generate",
    providers: ["svc"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "contains", value: "verified" },
    ...overrides,
  });
}
function provider(executor: Partial<Provider> & Pick<Executor, "execute">): Provider {
  return {
    id: "svc",
    capability: "text.generate",
    external: true,
    retrySafe: false,
    enabled: true,
    authenticated: true,
    priority: 1,
    maxInputChars: 20_000,
    ...executor,
  };
}

it("never strands a task in RECOVERY_REQUIRED without a reconcilable action", async () => {
  let failNext = false;
  const flaky = new TaskService({
    ...db,
    transaction: (fn) => {
      if (!failNext) return db.transaction(fn);
      failNext = false;
      return Promise.reject(new Error("transient database error"));
    },
  });
  const task = await flaky.create(spec(), "stranded", "operator");
  const registry = new ProviderRegistry([
    provider({
      execute: async () => {
        failNext = true;
        throw new Error("connection lost after send");
      },
    }),
  ]);
  await new Worker(flaky, registry).once();
  expect((await flaky.get(task.id)).status).toBe("RECOVERY_REQUIRED");
  const [action] = await flaky.actions(task.id);
  expect(action?.status).toBe("UNCERTAIN");
  await flaky.reconcile(action!.id, "FAILED", "checked the external system: no effect", "operator");
  expect((await flaky.get(task.id)).status).toBe("FAILED");
});

it("requires reconciliation when a side-effecting executor returns unverified output", async () => {
  const task = await tasks.create(spec(), "unverified-effect", "operator");
  await new ActionGateway(tasks).run(
    (await tasks.claim("w", 10_000))!,
    provider({ execute: async () => ({ text: "workflow ran, criterion absent", source: "svc" }) }),
    new AbortController().signal,
  );
  expect((await tasks.get(task.id)).status).toBe("RECOVERY_REQUIRED");
  expect((await tasks.actions(task.id))[0]?.status).toBe("UNCERTAIN");
});

it("survives one failed heartbeat while the lease is still valid", async () => {
  const task = await tasks.create(spec(), "heartbeat", "operator");
  const real = tasks.heartbeat.bind(tasks);
  let failures = 0;
  tasks.heartbeat = async (...args) => {
    if (failures++ === 0) throw new Error("transient database error");
    return real(...args);
  };
  const registry = new ProviderRegistry([
    provider({
      execute: (_task, signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ text: "verified", source: "svc" }), 500);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          });
        }),
    }),
  ]);
  await new Worker(tasks, registry, undefined, { leaseMs: 1_000, renewMs: 120, drainMs: 0 }).once();
  expect((await tasks.get(task.id)).status).toBe("COMPLETED");
  expect(failures).toBeGreaterThan(1);
});

it("drains an in-flight action on shutdown instead of aborting it", async () => {
  const task = await tasks.create(spec(), "drain", "operator");
  let started: () => void = () => {};
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const registry = new ProviderRegistry([
    provider({
      execute: (_task, signal) =>
        new Promise((resolve, reject) => {
          started();
          const timer = setTimeout(() => resolve({ text: "verified", source: "svc" }), 300);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          });
        }),
    }),
  ]);
  const stop = new AbortController();
  const worker = new Worker(tasks, registry, undefined, { drainMs: 5_000 });
  const loop = worker.run(stop.signal);
  await running;
  stop.abort();
  await loop;
  expect((await tasks.get(task.id)).status).toBe("COMPLETED");
});

it("rejects unregistered and prototype workflow names before any dispatch", async () => {
  const executor = new WorkflowExecutor({});
  for (const workflow of ["missing", "__proto__", "constructor"]) {
    const task = {
      ...(await tasks.get((await tasks.create(spec(), workflow, "operator")).id)),
    };
    task.spec = { ...task.spec, input: { workflow, payload: {} } };
    await expect(executor.execute(task, new AbortController().signal)).rejects.toMatchObject({
      dispatched: false,
    });
  }
});

it("treats an authentication rejection as never dispatched", async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 401;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const task = await tasks.create(spec({ providers: ["openclaw"] }), "auth", "operator");
    const status = await new ActionGateway(tasks).run(
      (await tasks.claim("w", 10_000))!,
      new OpenClawExecutor(`http://127.0.0.1:${address.port}`, "expired", "agent"),
      new AbortController().signal,
    );
    expect(status).toBe("WAITING_FOR_APPROVAL");
    const [action] = await tasks.actions(task.id);
    await tasks.approve(action!.id, "operator", Date.now() + 30_000);
    expect(
      await new ActionGateway(tasks).run(
        (await tasks.claim("w", 10_000))!,
        new OpenClawExecutor(`http://127.0.0.1:${address.port}`, "expired", "agent"),
        new AbortController().signal,
      ),
    ).toBe("FAILED");
  } finally {
    server.close();
  }
});

it("requires approval for agent runtimes even on public low-risk tasks", async () => {
  expect(new OpenClawExecutor("http://127.0.0.1:1", "t", "a").riskFloor).toBe("HIGH");
  expect(new WorkflowExecutor({}).riskFloor).toBe("HIGH");
  await tasks.create(spec(), "agent-floor", "operator");
  const status = await new ActionGateway(tasks).run(
    (await tasks.claim("w", 10_000))!,
    provider({
      riskFloor: "HIGH",
      execute: async () => ({ text: "verified", source: "svc" }),
    }),
    new AbortController().signal,
  );
  expect(status).toBe("WAITING_FOR_APPROVAL");
});

it("supersedes a stale pending action so its approval cannot be granted", async () => {
  const task = await tasks.create(spec({ risk: "HIGH" }), "superseded", "operator");
  const gateway = new ActionGateway(tasks);
  const run = (configuration: string) =>
    tasks
      .claim("w", 10_000)
      .then((claim) =>
        gateway.run(
          claim!,
          provider({ configuration, execute: async () => ({ text: "verified", source: "svc" }) }),
          new AbortController().signal,
        ),
      );
  await run("v1");
  const [stale] = await tasks.actions(task.id);
  await tasks.approve(stale!.id, "operator", Date.now() + 30_000);
  await run("v2");
  await expect(tasks.approve(stale!.id, "operator", Date.now() + 30_000)).rejects.toThrow(
    "APPROVAL_NOT_PENDING",
  );
  const current = (await tasks.actions(task.id)).find((a) => a.id !== stale!.id);
  await tasks.approve(current!.id, "operator", Date.now() + 30_000);
  expect(await run("v2")).toBe("COMPLETED");
});

it("opens a circuit after repeated outages so fallback does not waste call budget", async () => {
  let now = 1_000_000;
  const outage = async () => {
    throw new ProviderFailure("provider-unavailable", true);
  };
  const registry = new ProviderRegistry(
    [
      provider({ id: "a", priority: 1, execute: outage }),
      provider({ id: "b", priority: 2, execute: async () => ({ text: "ok", source: "b" }) }),
    ],
    () => now,
  );
  const task = await tasks.get(
    (await tasks.create(spec({ providers: ["a", "b"] }), "cb", "op")).id,
  );
  for (let i = 0; i < 3; i++)
    await expect(
      registry.select(task, []).execute(task, new AbortController().signal),
    ).rejects.toThrow();
  expect(registry.select(task, []).id).toBe("b");
  now += 61_000;
  expect(registry.select(task, []).id).toBe("a");
});

it("caps queued tasks per non-operator principal", async () => {
  for (let i = 0; i < 100; i++) await tasks.create(spec(), `n8n-${i}`, "n8n");
  await expect(tasks.create(spec(), "n8n-100", "n8n")).rejects.toThrow("QUEUE_FULL");
  await expect(tasks.create(spec(), "operator-still-admitted", "operator")).resolves.toBeTruthy();
}, 30_000);

it("refuses to silently cancel a task that needs reconciliation", async () => {
  const task = await tasks.create(spec(), "cancel-recovery", "operator");
  await tasks.locked(async (tx) => {
    const current = await tasks.get(task.id, tx);
    await tasks.move(tx, current, "RUNNING", "test");
    await tasks.move(tx, current, "RECOVERY_REQUIRED", "test");
  });
  await expect(tasks.cancel(task.id)).rejects.toThrow("RECONCILIATION_REQUIRED");
});

it("returns 400, not 500, for malformed JSON", async () => {
  const token = "operator-token-with-32-characters-x";
  const app = buildServer(tasks, new ProviderRegistry([]), {
    operatorToken: token,
    webhookToken: "webhook-token-with-32-characters-x",
    onCancel: () => {},
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": "bad-json",
      },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
  } finally {
    await app.close();
  }
});
