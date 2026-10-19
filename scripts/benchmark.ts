import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { type Database, migrate, postgres } from "../src/core/database.js";
import { ActionGateway } from "../src/core/gateway.js";
import { type Provider, ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { ConversationService } from "../src/services/conversation.js";
import { Durations } from "../src/services/eta.js";
import { PlanService } from "../src/services/plans/index.js";

// Default: in-memory PGlite. BENCHMARK_DATABASE_URL: a local disposable PostgreSQL; the run
// uses a fresh schema and drops it afterwards.
const url = process.env.BENCHMARK_DATABASE_URL;
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
  throw new Error("Benchmarks require a local disposable database");
const schema = `jarvis_bench_${randomUUID().replaceAll("-", "")}`;
let admin: Database | undefined;
let db: Database;
if (url) {
  admin = postgres(url);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(url);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  db = postgres(scoped.toString());
} else {
  const pg = new PGlite();
  db = {
    query: (s, p) => pg.query(s, p as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
}
const spec = (dependencies: string[] = []) => ({
  objective: "Return verified",
  capability: "text.generate" as const,
  providers: ["benchmark"],
  deadline: new Date(Date.now() + 600_000).toISOString(),
  verification: { kind: "contains" as const, value: "verified" },
  dependencies,
});
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
try {
  await migrate(db);
  const tasks = new TaskService(db);
  const gateway = new ActionGateway(tasks);
  const lifecycle: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await tasks.create(spec(), `bench-${i}`, "benchmark");
    const task = await tasks.claim("benchmark", 10_000);
    if (!task) throw new Error("Benchmark claim failed");
    await gateway.run(
      task,
      {
        id: "benchmark",
        capability: "text.generate",
        external: false,
        retrySafe: true,
        execute: async () => ({ text: "verified", source: "benchmark-fixture" }),
      },
      new AbortController().signal,
    );
    lifecycle.push(performance.now() - start);
  }
  // Scheduler cost with a backlog that cannot run (dependency never completes).
  const blocker = await tasks.create(spec(), "blocker", "benchmark");
  await db.query("UPDATE tasks SET status='WAITING_FOR_APPROVAL' WHERE id=$1", [blocker.id]);
  for (let i = 0; i < 500; i++) await tasks.create(spec([blocker.id]), `backlog-${i}`, "operator");
  const claims: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await tasks.claim("benchmark", 10_000);
    claims.push(performance.now() - start);
  }
  // A spoken turn end to end through Core (instant model fixture): admission, an interactive
  // worker, gateway, verification, conversation record. Then the same while a background
  // step holds the general worker, as when JARVIS researches while the operator talks.
  const provider = (id: string, capability: Provider["capability"], run: () => Promise<string>) =>
    ({
      id,
      capability,
      external: false,
      retrySafe: true,
      trustedForPrivate: true,
      enabled: true,
      authenticated: true,
      priority: 1,
      maxInputChars: 200_000,
      execute: async () => ({ text: await run(), source: id }),
    }) satisfies Provider;
  let release = () => {};
  const busy = new Promise<void>((resolve) => {
    release = resolve;
  });
  const registry = new ProviderRegistry([
    provider("gemini-live", "text.generate", async () =>
      JSON.stringify({
        addressed: true,
        say: "Buradayım, efendim.",
        lang: "tr",
        intent: { kind: "reply" },
      }),
    ),
    provider("browser-use", "browser.extract", async () => {
      await busy;
      return "page";
    }),
  ]);
  const live = new TaskService(db, { concurrency: 1, interactive: 2 });
  const stop = new AbortController();
  const workers = [
    new Worker(live, registry),
    new Worker(live, registry, undefined, {}, undefined, ["interactive"]),
  ];
  const wake = () => {
    for (const worker of workers) worker.wake();
  };
  const running = workers.map((worker) => worker.run(stop.signal));
  const plans = new PlanService({
    tasks: live,
    wake,
    onCancel: () => {},
    conversationProviders: ["gemini-live"],
    privateProviders: [],
    durations: new Durations(),
  });
  plans.start(stop.signal);
  const conversation = new ConversationService(live, { providers: ["gemini-live"], wake, plans });
  const turns = async () => {
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      await conversation.turn({ utterance: "Jarvis, orada mısın?", followUp: false });
      samples.push(performance.now() - start);
    }
    return {
      samples: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
    };
  };
  const idleTurns = await turns();
  await live.create(
    {
      objective: "Read a page",
      capability: "browser.extract",
      input: { url: "https://example.com/", expectedText: "Example" },
      providers: ["browser-use"],
      deadline: new Date(Date.now() + 600_000).toISOString(),
      verification: { kind: "non-empty" },
    },
    "background-read",
    "operator",
  );
  wake();
  const busyTurns = await turns();
  release();
  stop.abort();
  await Promise.all(running);
  process.stdout.write(
    `${JSON.stringify({
      database: url ? "PostgreSQL (local, isolated schema)" : "PGlite in-memory",
      executor: "deterministic fixture; no network",
      lifecycleMs: {
        samples: lifecycle.length,
        p50: percentile(lifecycle, 0.5),
        p95: percentile(lifecycle, 0.95),
      },
      claimWith500BlockedMs: {
        samples: claims.length,
        p50: percentile(claims, 0.5),
        p95: percentile(claims, 0.95),
      },
      spokenTurnMs: idleTurns,
      spokenTurnWhileWorkingMs: busyTurns,
      rssMiB: process.memoryUsage().rss / 1024 ** 2,
      node: process.version,
    })}\n`,
  );
} finally {
  await db.close();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
}
