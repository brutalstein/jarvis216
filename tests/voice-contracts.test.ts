import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema, verified } from "../src/contracts.js";
import type { Database } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { type Provider, ProviderRegistry } from "../src/routing.js";
import { TaskService } from "../src/tasks.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const base = {
  objective: "Greet the operator",
  capability: "text.generate",
  providers: ["test"],
  deadline: new Date(Date.now() + 60_000).toISOString(),
  verification: { kind: "non-empty" },
};
const spec = (overrides: Record<string, unknown> = {}) =>
  TaskSpecSchema.parse({ ...base, ...overrides });

describe("voice contract additions", () => {
  it("parses personal privacy, non-empty verification and listed order", () => {
    const parsed = spec({ privacy: "personal", providerOrder: "listed" });
    expect(parsed.privacy).toBe("personal");
    expect(parsed.providerOrder).toBe("listed");
    expect(parsed.verification).toEqual({ kind: "non-empty" });
    expect(spec().providerOrder).toBe("priority");
  });

  it("rejects a non-empty verification carrying a value", () => {
    expect(() => spec({ verification: { kind: "non-empty", value: "x" } })).toThrow();
  });

  it("verified() applies each kind", () => {
    const contains = spec({ verification: { kind: "contains", value: "ok" } });
    expect(verified(contains, "is ok")).toBe(true);
    expect(verified(contains, "nope")).toBe(false);
    expect(verified(spec(), "  hi ")).toBe(true);
    expect(verified(spec(), "   ")).toBe(false);
  });

  it("listed order picks the first listed eligible provider regardless of priority", () => {
    const provider = (id: string, priority: number): Provider => ({
      id,
      priority,
      capability: "text.generate",
      external: false,
      retrySafe: true,
      enabled: true,
      authenticated: true,
      maxInputChars: 20_000,
      execute: async () => ({ text: id, source: id }),
    });
    const registry = new ProviderRegistry([provider("a", 10), provider("b", 50)]);
    const task = (providerOrder: string) =>
      ({ spec: spec({ providers: ["b", "a"], providerOrder }) }) as Task;
    expect(registry.select(task("listed"), []).id).toBe("b");
    expect(registry.select(task("priority"), []).id).toBe("a");
    expect(registry.select(task("listed"), ["b"]).id).toBe("a");
  });
});

describe("non-empty verification in the gateway", () => {
  let db: Database;
  let tasks: TaskService;
  beforeEach(async () => {
    db = await memoryDatabase();
    tasks = new TaskService(db);
  });
  afterEach(async () => {
    await db.close();
  });

  const run = async (text: string) => {
    const task = await tasks.create(spec(), `reply-${text.length}`, "operator");
    const claim = await tasks.claim("w", 10_000);
    await new ActionGateway(tasks).run(
      claim!,
      {
        id: "test",
        capability: "text.generate",
        external: false,
        retrySafe: true,
        execute: async () => ({ text, source: "test-fixture" }),
      },
      new AbortController().signal,
    );
    return (await tasks.get(task.id)).status;
  };

  it("gateway completes a non-empty reply and fails a blank one", async () => {
    expect(await run("Merhaba")).toBe("COMPLETED");
    expect(await run("   ")).toBe("FAILED");
  });
});

describe("JSON response format", () => {
  it("is optional, text.generate only, and absent from plain specs", () => {
    expect(spec()).not.toHaveProperty("responseFormat");
    expect(spec({ responseFormat: "json" }).responseFormat).toBe("json");
    expect(() =>
      spec({
        capability: "info.fetch",
        providers: ["news"],
        input: { action: "news.brief", args: {} },
        responseFormat: "json",
      }),
    ).toThrow();
  });
});
