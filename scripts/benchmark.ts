import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { type Database, migrate, postgres } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { TaskService } from "../src/tasks.js";

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
