import { PGlite } from "@electric-sql/pglite";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canTransition, fingerprint, TaskSpecSchema } from "../src/contracts.js";
import { type Database, migrate, type Sql } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { ProviderFailure } from "../src/routing.js";
import { EnvSecrets } from "../src/security.js";
import { TaskService } from "../src/tasks.js";

function spec(overrides: Record<string, unknown> = {}) {
  return TaskSpecSchema.parse({
    objective: "Return an engineering proposal",
    capability: "text.generate",
    input: {},
    providers: ["test"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "contains", value: "verified" },
    ...overrides,
  });
}

let pg: PGlite;
let db: Database;
let tasks: TaskService;
beforeEach(async () => {
  pg = new PGlite();
  const query: Sql["query"] = async (text, params) => pg.query(text, params as unknown[]);
  db = {
    query,
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  await migrate(db);
  tasks = new TaskService(db, { concurrency: 2 });
});
afterEach(async () => {
  await db.close();
});

describe("task authority", () => {
  it("rejects terminal-state regression for every status", () => {
    fc.assert(
      fc.property(fc.string(), (state) => {
        expect(canTransition("COMPLETED", state)).toBe(false);
        expect(canTransition("CANCELLED", state)).toBe(false);
      }),
    );
  });

  it("deduplicates identical input and rejects identity reuse for different input", async () => {
    const input = spec();
    const first = await tasks.create(input, "same-key", "operator");
    expect((await tasks.create(input, "same-key", "operator")).id).toBe(first.id);
    await expect(
      tasks.create({ ...input, objective: "Different" }, "same-key", "operator"),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("only one competing worker acquires a task", async () => {
    await tasks.create(spec(), "race", "operator");
    const claims = await Promise.all([tasks.claim("a", 10_000), tasks.claim("b", 10_000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("rejects dependency cycles and blocks premature execution", async () => {
    const a = await tasks.create(spec(), "a", "operator");
    const b = await tasks.create(spec(), "b", "operator");
    await tasks.addDependency(a.id, b.id);
    await expect(tasks.addDependency(b.id, a.id)).rejects.toThrow("DEPENDENCY_CYCLE");
    expect((await tasks.claim("worker", 10_000))?.id).toBe(b.id);
  });

  it("recovers an abandoned claim but fences the old owner", async () => {
    const task = await tasks.create(spec(), "crash", "operator");
    const first = await tasks.claim("dead", 1);
    await db.query("UPDATE tasks SET lease_until=0 WHERE id=$1", [task.id]);
    await tasks.recover();
    const second = await tasks.claim("new", 10_000);
    expect(second?.fence).toBeGreaterThan(first?.fence ?? 0);
    await expect(tasks.heartbeat(task.id, "dead", first?.fence ?? 0, 10_000)).rejects.toThrow(
      "LEASE_LOST",
    );
  });
});

describe("execution gateway", () => {
  const executor = {
    id: "test",
    capability: "text.generate" as const,
    external: false,
    retrySafe: true,
    execute: async () => ({ text: "verified result", source: "test-fixture" }),
  };

  it("requires matching single-use approval for high risk", async () => {
    const task = await tasks.create(spec({ risk: "HIGH" }), "approval", "operator");
    const gateway = new ActionGateway(tasks);
    const claim = await tasks.claim("w", 10_000);
    expect(await gateway.run(claim!, executor, new AbortController().signal)).toBe(
      "WAITING_FOR_APPROVAL",
    );
    const [action] = await tasks.actions(task.id);
    expect(action?.status).toBe("AWAITING_APPROVAL");
    await tasks.approve(action!.id, "operator", Date.now() + 30_000);
    const approved = await tasks.claim("w", 10_000);
    await gateway.run(approved!, executor, new AbortController().signal);
    expect((await tasks.get(task.id)).status).toBe("COMPLETED");
    await expect(tasks.approve(action!.id, "operator", Date.now() + 30_000)).rejects.toThrow();
  });

  it("cannot mark failed verification completed", async () => {
    const task = await tasks.create(spec(), "verify", "operator");
    const gateway = new ActionGateway(tasks);
    const claim = await tasks.claim("w", 10_000);
    await gateway.run(
      claim!,
      { ...executor, execute: async () => ({ text: "wrong", source: "fixture" }) },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("FAILED");
  });

  it("never repeats an ambiguous external side effect", async () => {
    const task = await tasks.create(spec(), "uncertain", "operator");
    const claim = await tasks.claim("w", 10_000);
    const gateway = new ActionGateway(tasks);
    let calls = 0;
    await gateway.run(
      claim!,
      {
        ...executor,
        retrySafe: false,
        execute: async () => {
          calls++;
          throw new Error("connection lost");
        },
      },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("RECOVERY_REQUIRED");
    await tasks.recover();
    expect(await tasks.claim("again", 10_000)).toBeNull();
    expect(calls).toBe(1);
  });

  it("binds approval to actual parameters with order-independent hashes", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ amount: 10 })).not.toBe(fingerprint({ amount: 100 }));
  });

  it("rejects a capability mismatch before executor side effects", async () => {
    await tasks.create(spec(), "denied", "operator");
    const claim = await tasks.claim("w", 10_000);
    let ran = false;
    const gateway = new ActionGateway(tasks);
    await expect(
      gateway.run(
        claim!,
        {
          ...executor,
          capability: "browser.extract",
          execute: async () => {
            ran = true;
            return { text: "verified", source: "x" };
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("CAPABILITY_DENIED");
    expect(ran).toBe(false);
  });

  it("uses bounded compatible fallback only after a known retry-safe failure", async () => {
    const task = await tasks.create(
      spec({ providers: ["test", "second"] }),
      "fallback",
      "operator",
    );
    const gateway = new ActionGateway(tasks);
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      {
        ...executor,
        execute: async () => {
          throw new ProviderFailure("rate-limited", true);
        },
      },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("READY");
    await db.query("UPDATE tasks SET not_before=0 WHERE id=$1", [task.id]);
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      { ...executor, id: "second" },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("COMPLETED");
    expect((await tasks.get(task.id)).calls).toBe(2);
  });

  it("falls back to another listed provider after a failure tied to the first", async () => {
    const task = await tasks.create(spec({ providers: ["test", "second"] }), "revoked", "operator");
    const gateway = new ActionGateway(tasks);
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      {
        ...executor,
        execute: async () => {
          throw new ProviderFailure("authentication-required", false);
        },
      },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("READY");
  });

  it("cancellation racing the result cannot become completed", async () => {
    const task = await tasks.create(spec(), "cancel-race", "operator");
    const gateway = new ActionGateway(tasks);
    const claim = (await tasks.claim("w", 10_000))!;
    await gateway.run(
      claim,
      {
        ...executor,
        execute: async () => {
          await tasks.cancel(task.id);
          return { text: "verified", source: "late" };
        },
      },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("RECOVERY_REQUIRED");
  });

  it("expires an approval and prevents execution after policy configuration changes", async () => {
    const task = await tasks.create(spec({ risk: "HIGH" }), "changed", "operator");
    const gateway = new ActionGateway(tasks);
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      { ...executor, configuration: "model-v1" },
      new AbortController().signal,
    );
    const [action] = await tasks.actions(task.id);
    await tasks.approve(action!.id, "operator", Date.now() + 30_000);
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      { ...executor, configuration: "model-v2" },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("WAITING_FOR_APPROVAL");
    expect((await tasks.get(task.id)).calls).toBe(0);
  });

  it("never consumes more than the admitted call budget", async () => {
    const task = await tasks.create(
      spec({ providers: ["test", "second"], budget: { maxCalls: 1 } }),
      "budget",
      "operator",
    );
    await new ActionGateway(tasks).run(
      (await tasks.claim("w", 10_000))!,
      {
        ...executor,
        execute: async () => {
          throw new ProviderFailure("rate-limited", true);
        },
      },
      new AbortController().signal,
    );
    expect((await tasks.get(task.id)).status).toBe("FAILED");
    expect((await tasks.get(task.id)).calls).toBe(1);
  });
});

it("resumes a DAG after its uncertain dependency is reconciled", async () => {
  const parent = await tasks.create(spec(), "parent-uncertain", "operator");
  const child = await tasks.create(
    spec({ dependencies: [parent.id] }),
    "child-dependent",
    "operator",
  );
  const claim = (await tasks.claim("w", 10_000))!;
  await new ActionGateway(tasks).run(
    claim,
    {
      id: "test",
      capability: "text.generate",
      external: true,
      retrySafe: false,
      execute: async () => {
        throw new Error("unknown");
      },
    },
    new AbortController().signal,
  );
  expect(await tasks.claim("w", 10_000)).toBeNull();
  const [action] = await tasks.actions(parent.id);
  await expect(
    tasks.reconcile(action!.id, "COMPLETED", "Unsubstantiated claim", "operator"),
  ).rejects.toThrow("VERIFICATION_FAILED");
  await tasks.reconcile(action!.id, "COMPLETED", "verified by authoritative readback", "operator");
  expect((await tasks.get(parent.id)).result?.source).toBe("operator:operator");
  expect((await tasks.claim("w", 10_000))?.id).toBe(child.id);
});

it("does not persist configured secrets containing JSON special characters", async () => {
  const task = await tasks.create(spec(), "redact-json", "operator");
  const secret = 'credential-with-"quotes';
  const secrets = new EnvSecrets({ API_KEY: secret });
  await new ActionGateway(tasks, (text) => secrets.redact(text)).run(
    (await tasks.claim("w", 10_000))!,
    {
      id: "test",
      capability: "text.generate",
      external: false,
      retrySafe: true,
      execute: async () => ({ text: `verified ${secret}`, source: "fixture" }),
    },
    new AbortController().signal,
  );
  expect((await tasks.get(task.id)).result?.text).toBe("verified [REDACTED]");
});

it("expired approvals cannot dispatch the action", async () => {
  const task = await tasks.create(spec({ risk: "HIGH" }), "expired-approval", "operator");
  const gateway = new ActionGateway(tasks);
  const executor = {
    id: "test",
    capability: "text.generate" as const,
    external: false,
    retrySafe: true,
    execute: async () => ({ text: "verified", source: "fixture" }),
  };
  await gateway.run((await tasks.claim("w", 10_000))!, executor, new AbortController().signal);
  const [action] = await tasks.actions(task.id);
  await tasks.approve(action!.id, "operator", Date.now() + 30_000);
  await db.query("UPDATE approvals SET expires_at=0 WHERE action_id=$1", [action!.id]);
  await gateway.run((await tasks.claim("w", 10_000))!, executor, new AbortController().signal);
  expect((await tasks.get(task.id)).calls).toBe(0);
  expect((await tasks.get(task.id)).status).toBe("WAITING_FOR_APPROVAL");
});

it("does not reset total task duration for a later attempt", async () => {
  const task = await tasks.create(spec({ budget: { maxDurationMs: 100 } }), "duration", "operator");
  await db.query("UPDATE tasks SET created_at=$2 WHERE id=$1", [task.id, Date.now() - 500]);
  expect(await tasks.claim("w", 10_000)).toBeNull();
  expect((await tasks.get(task.id)).status).toBe("FAILED");
});

it("applies browser backpressure while allowing a different capability to use capacity", async () => {
  const browserSpec = spec({
    capability: "browser.extract",
    providers: ["browser-use"],
    input: { url: "https://example.com/", expectedText: "documentation" },
  });
  const a = await tasks.create(browserSpec, "browser-a", "operator");
  const b = await tasks.create(browserSpec, "browser-b", "operator");
  const model = await tasks.create(spec(), "model-capacity", "operator");
  expect([a.id, b.id]).toContain((await tasks.claim("browser-worker", 10_000))?.id);
  expect((await tasks.claim("model-worker", 10_000))?.id).toBe(model.id);
});

it("allows an operator to resume a blocked task without replaying an uncertain action", async () => {
  const task = await tasks.create(spec(), "resume", "operator");
  await tasks.locked(async (tx) => {
    await tasks.move(tx, await tasks.get(task.id, tx), "BLOCKED", "provider disabled");
  });
  await tasks.resume(task.id);
  expect((await tasks.claim("w", 10_000))?.id).toBe(task.id);
});
