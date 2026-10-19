import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configuredProviders } from "../src/app/config.js";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { ActionGateway } from "../src/core/gateway.js";
import {
  loadObservations,
  minReliabilitySamples,
  type Observation,
  ReliabilityTracker,
  wilsonUpper,
} from "../src/core/reliability.js";
import { type Provider, ProviderFailure, ProviderRegistry } from "../src/core/routing.js";
import { EnvSecrets } from "../src/core/security.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const now = 10_000_000_000;
const spec = (overrides: Record<string, unknown> = {}) =>
  TaskSpecSchema.parse({
    objective: "Answer",
    capability: "text.generate",
    providers: ["a", "b"],
    deadline: new Date(now + 60_000).toISOString(),
    verification: { kind: "non-empty" },
    ...overrides,
  });
const task = (overrides: Record<string, unknown> = {}, createdAt = now) =>
  ({ id: "t", created_at: createdAt, spec: spec(overrides) }) as Task;
const provider = (id: string, priority: number): Provider => ({
  id,
  priority,
  capability: "text.generate",
  external: true,
  retrySafe: true,
  enabled: true,
  authenticated: true,
  maxInputChars: 20_000,
  execute: async () => ({ text: id, source: id }),
});
const seen = (
  provider: string,
  outcome: Observation["outcome"],
  options: Partial<Observation> = {},
): Observation => ({
  provider,
  capability: "text.generate",
  outcome,
  kind: outcome === "success" ? "verified" : outcome === "failure" ? "invalid-response" : "aborted",
  durationMs: 1000,
  observedAt: now - 1000,
  ...options,
});
const repeat = (count: number, make: (index: number) => Observation) =>
  Array.from({ length: count }, (_, index) => make(index));

describe("statistics", () => {
  it("wilsonUpper separates confident failure from small samples", () => {
    expect(wilsonUpper(0, 0)).toBe(1);
    expect(wilsonUpper(0, 8)).toBeLessThan(0.5);
    expect(wilsonUpper(2, 8)).toBeGreaterThan(0.5);
    expect(wilsonUpper(8, 8)).toBeCloseTo(1, 5);
    expect(wilsonUpper(30, 100)).toBeLessThan(0.5);
  });

  it("tracks a bounded day window; neutral attempts count as usage only", () => {
    const tracker = new ReliabilityTracker();
    tracker.record(seen("a", "success", { observedAt: now - 2 * 86_400_000 }));
    for (const observation of repeat(60, (i) => seen("a", "success", { durationMs: i * 100 })))
      tracker.record(observation);
    tracker.record(seen("a", "neutral", { inputTokens: 10, outputTokens: 5 }));
    const health = tracker.health("a", now);
    expect(health.samples).toBe(50);
    expect(health.successRate).toBe(1);
    expect(health.p90Ms).toBe(5400);
    expect(tracker.usage("a", now)).toEqual({ calls: 61, tokens: 15 });
    expect(tracker.health("b", now)).toMatchObject({ samples: 0, successRate: null, p90Ms: null });
  });

  it("reports no latency percentiles below five successes", () => {
    const tracker = new ReliabilityTracker();
    for (const observation of repeat(4, () => seen("a", "success"))) tracker.record(observation);
    expect(tracker.health("a", now).p50Ms).toBeNull();
  });
});

describe("adaptive routing", () => {
  const registry = (budgets = {}) =>
    new ProviderRegistry([provider("a", 10), provider("b", 20)], () => now, { budgets });

  it("keeps priority order without statistically meaningful evidence", () => {
    const routing = registry();
    routing.hydrate(repeat(minReliabilitySamples - 1, () => seen("a", "failure")));
    const { provider: chosen, reason } = routing.choose(task(), []);
    expect(chosen.id).toBe("a");
    expect(reason).toMatchObject({ routing: "adaptive-v1", demoted: "", samples: 7 });
  });

  it("demotes a provider that fails more often than not, but keeps it as a last resort", () => {
    const routing = registry();
    routing.hydrate([
      ...repeat(10, () => seen("a", "failure")),
      ...repeat(10, () => seen("b", "success")),
    ]);
    const { provider: chosen, reason } = routing.choose(task(), []);
    expect(chosen.id).toBe("b");
    expect(reason).toMatchObject({ demoted: "a", successRate: 1, samples: 10 });
    expect(routing.select(task(), ["b"]).id).toBe("a");
    expect(
      (routing.list() as { id: string; reliability: { degraded: boolean } }[])[0],
    ).toMatchObject({ id: "a", reliability: { degraded: true, successRate: 0 } });
  });

  it("demotes a provider whose p90 latency exceeds the time left", () => {
    const routing = registry();
    routing.hydrate([
      ...repeat(10, () => seen("a", "success", { durationMs: 30_000 })),
      ...repeat(10, () => seen("b", "success", { durationMs: 2_000 })),
    ]);
    // 20 s left: "a" usually needs 30 s.
    expect(routing.select(task({ deadline: new Date(now + 20_000).toISOString() }), []).id).toBe(
      "b",
    );
    // A minute left: priority decides again.
    expect(routing.select(task(), []).id).toBe("a");
  });

  it("listed order stays the base order under demotion", () => {
    const routing = registry();
    routing.hydrate(repeat(12, () => seen("b", "failure")));
    expect(routing.select(task({ providers: ["b", "a"], providerOrder: "listed" }), []).id).toBe(
      "a",
    );
  });

  it("skips a provider whose daily call budget is spent and fails closed when none is left", () => {
    const routing = registry({ a: { callsPerDay: 2 } });
    routing.record(seen("a", "success"));
    expect(routing.select(task(), []).id).toBe("a");
    routing.record(seen("a", "neutral"));
    expect(routing.select(task(), []).id).toBe("b");
    expect(() => routing.select(task({ providers: ["a"] }), [])).toThrow("NO_COMPATIBLE_PROVIDER");
    expect((routing.list() as { budgetExhausted?: boolean }[])[0]?.budgetExhausted).toBe(true);
  });

  it("skips a provider whose daily token budget is spent", () => {
    const routing = registry({ a: { tokensPerDay: 100 } });
    routing.record(seen("a", "success", { inputTokens: 60, outputTokens: 40 }));
    expect(routing.select(task(), []).id).toBe("b");
  });

  it("rebuilds an open circuit from recent outages after a restart", () => {
    const outages = repeat(3, (i) =>
      seen("a", "failure", { kind: "rate-limited", observedAt: now - 3000 + i * 1000 }),
    );
    const restarted = registry();
    restarted.hydrate(outages);
    expect(restarted.select(task(), []).id).toBe("b");
    expect((restarted.list() as { circuitOpen: boolean }[])[0]?.circuitOpen).toBe(true);
    const recovered = registry();
    recovered.hydrate([...outages, seen("a", "success", { observedAt: now - 500 })]);
    expect(recovered.select(task(), []).id).toBe("a");
    const expired = registry();
    expired.hydrate(outages.map((o) => ({ ...o, observedAt: o.observedAt - 120_000 })));
    expect(expired.select(task(), []).id).toBe("a");
  });
});

describe("gateway observations", () => {
  let db: Database;
  let tasks: TaskService;
  beforeEach(async () => {
    db = await memoryDatabase();
    tasks = new TaskService(db, { concurrency: 2 });
  });
  afterEach(async () => {
    await db.close();
  });
  const live = (overrides: Record<string, unknown> = {}) =>
    spec({ deadline: new Date(Date.now() + 60_000).toISOString(), providers: ["a"], ...overrides });

  it("records outcomes with tokens durably and tells the registry", async () => {
    const recorded: Observation[] = [];
    const gateway = new ActionGateway(tasks, undefined, (o) => recorded.push(o));
    const executor = {
      ...provider("a", 10),
      execute: async () => ({
        text: "ok",
        source: "fixture",
        usage: { inputTokens: 12, outputTokens: 3 },
      }),
    };
    await tasks.create(live(), "ok", "operator");
    await gateway.run((await tasks.claim("w", 10_000))!, executor, new AbortController().signal);
    await tasks.create(live({ budget: { maxCalls: 1 } }), "limited", "operator");
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      {
        ...executor,
        execute: async () => {
          throw new ProviderFailure("rate-limited", true, false);
        },
      },
      new AbortController().signal,
    );
    await tasks.create(live(), "refused", "operator");
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      {
        ...executor,
        execute: async () => {
          throw new ProviderFailure("policy-denied", false);
        },
      },
      new AbortController().signal,
    );
    const durable = await loadObservations(db, 0);
    expect(durable.map((o) => [o.outcome, o.kind])).toEqual([
      ["success", "verified"],
      ["failure", "rate-limited"],
      ["neutral", "policy-denied"],
    ]);
    expect(durable[0]).toMatchObject({ provider: "a", inputTokens: 12, outputTokens: 3 });
    expect(recorded).toHaveLength(3);
    const replayed = new ProviderRegistry([provider("a", 10)]);
    replayed.hydrate(durable);
    expect(
      (replayed.list() as { usage24h: { calls: number; tokens: number } }[])[0]?.usage24h,
    ).toEqual({ calls: 3, tokens: 15 });
  });

  it("an operator abort is neutral, not a provider failure", async () => {
    const gateway = new ActionGateway(tasks);
    await tasks.create(live(), "abort", "operator");
    const controller = new AbortController();
    await gateway.run(
      (await tasks.claim("w", 10_000))!,
      {
        ...provider("a", 10),
        execute: async () => {
          controller.abort();
          throw new Error("aborted");
        },
      },
      controller.signal,
    );
    expect((await loadObservations(db, 0)).map((o) => o.outcome)).toEqual(["neutral"]);
  });

  it("the worker explains the adaptive choice in provider.selected", async () => {
    const registry = new ProviderRegistry([provider("a", 10)]);
    const worker = new Worker(tasks, registry);
    const created = await tasks.create(live(), "explained", "operator");
    await worker.once();
    const events = (await tasks.events(created.id)) as {
      envelope: { type: string; payload: Record<string, unknown> };
    }[];
    const selected = events.find((e) => e.envelope.type === "provider.selected");
    expect(selected?.envelope.payload).toMatchObject({
      provider: "a",
      registryVersion: 2,
      routing: "adaptive-v1",
    });
    expect(
      (registry.list() as { reliability: { samples: number } }[])[0]?.reliability.samples,
    ).toBe(1);
  });
});

describe("budget configuration", () => {
  const env = (budgets: string) => ({
    ENABLE_OPENROUTER: "true",
    OPENROUTER_MODELS: "a/b:free",
    PROVIDER_BUDGETS_JSON: budgets,
  });
  const secrets = new EnvSecrets({ OPENROUTER_API_KEY: "openrouter-test-key" });

  it("applies per-provider daily budgets from PROVIDER_BUDGETS_JSON", async () => {
    const { registry } = await configuredProviders(env('{"or-b":{"callsPerDay":45}}'), secrets);
    expect(registry.list()[0]).toMatchObject({
      id: "or-b",
      budget: { callsPerDay: 45 },
      budgetExhausted: false,
    });
  });

  it("rejects empty or malformed budgets", async () => {
    await expect(configuredProviders(env('{"or-b":{}}'), secrets)).rejects.toThrow();
    await expect(configuredProviders(env('{"or-b":{"callsPerDay":0}}'), secrets)).rejects.toThrow();
    await expect(configuredProviders(env('{"OR B":{"callsPerDay":1}}'), secrets)).rejects.toThrow();
  });
});
