import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { type Database, migrate } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { TaskService } from "../src/tasks.js";

const pg = new PGlite();
const db: Database = {
  query: (s, p) => pg.query(s, p as unknown[]),
  transaction: (fn) => pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
  close: () => pg.close(),
};
try {
  await migrate(db);
  const tasks = new TaskService(db);
  const gateway = new ActionGateway(tasks);
  const timings: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await tasks.create(
      {
        objective: "Return verified",
        capability: "text.generate",
        providers: ["benchmark"],
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: "verified" },
      },
      `bench-${i}`,
      "benchmark",
    );
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
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify({ samples: timings.length, medianMs: timings[50], p95Ms: timings[95], rssMiB: process.memoryUsage().rss / 1024 ** 2, database: "PGlite in-memory", executor: "deterministic fixture; no network", node: process.version })}\n`,
  );
} finally {
  await db.close();
}
