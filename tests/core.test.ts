import { PGlite } from "@electric-sql/pglite";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskSpecSchema, canTransition, fingerprint } from "../src/contracts.js";
import { migrate, type Database, type Sql } from "../src/database.js";
import { TaskService } from "../src/tasks.js";
import { ActionGateway } from "../src/gateway.js";

export function spec(overrides: Record<string, unknown> = {}) {
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
    transaction: (fn) => pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  await migrate(db);
  tasks = new TaskService(db, { concurrency: 2 });
});
afterEach(async () => { await db.close(); });

describe("task authority", () => {
  it("rejects terminal-state regression for every status", () => {
    fc.assert(fc.property(fc.string(), (state) => {
      expect(canTransition("COMPLETED", state)).toBe(false);
      expect(canTransition("CANCELLED", state)).toBe(false);
    }));
  });

  it("deduplicates identical input and rejects identity reuse for different input", async () => {
    const input = spec();
    const first = await tasks.create(input, "same-key", "operator");
    expect((await tasks.create(input, "same-key", "operator")).id).toBe(first.id);
    await expect(tasks.create({ ...input, objective: "Different" }, "same-key", "operator")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
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
    await expect(tasks.heartbeat(task.id, "dead", first?.fence ?? 0, 10_000)).rejects.toThrow("LEASE_LOST");
  });
});

describe("execution gateway", () => {
  const executor = {
    id: "test", capability: "text.generate" as const, external: false, retrySafe: true,
    execute: async () => ({ text: "verified result", source: "test-fixture" }),
  };

  it("requires matching single-use approval for high risk", async () => {
    const task = await tasks.create(spec({ risk: "HIGH" }), "approval", "operator");
    const gateway = new ActionGateway(tasks);
    const claim = await tasks.claim("w", 10_000);
    expect(await gateway.run(claim!, executor, new AbortController().signal)).toBe("WAITING_FOR_APPROVAL");
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
    await gateway.run(claim!, { ...executor, execute: async () => ({ text: "wrong", source: "fixture" }) }, new AbortController().signal);
    expect((await tasks.get(task.id)).status).toBe("FAILED");
  });

  it("never repeats an ambiguous external side effect", async () => {
    const task = await tasks.create(spec(), "uncertain", "operator");
    const claim = await tasks.claim("w", 10_000);
    const gateway = new ActionGateway(tasks);
    let calls = 0;
    await gateway.run(claim!, { ...executor, retrySafe: false, execute: async () => { calls++; throw new Error("connection lost"); } }, new AbortController().signal);
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
    await expect(gateway.run(claim!, { ...executor, capability: "browser.extract", execute: async () => { ran = true; return { text: "verified", source: "x" }; } }, new AbortController().signal)).rejects.toThrow("CAPABILITY_DENIED");
    expect(ran).toBe(false);
  });
});
