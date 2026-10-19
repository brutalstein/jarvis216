import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrate, postgres } from "../src/core/database.js";
import { TaskService } from "../src/core/tasks.js";

it.skipIf(process.env.JARVIS_LIVE_POSTGRES_TEST !== "true" || !process.env.TEST_DATABASE_URL)(
  "real PostgreSQL: concurrent bootstrap, separate workers and reconnect",
  async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL required");
    if (!["127.0.0.1", "localhost", "[::1]", "postgres"].includes(new URL(url).hostname))
      throw new Error("Live database tests require an explicit local disposable database");
    const admin = postgres(url);
    const schema = `jarvis_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    const a = postgres(scoped.toString());
    const b = postgres(scoped.toString());
    try {
      await Promise.all([migrate(a), migrate(b)]);
      const first = new TaskService(a);
      const second = new TaskService(b);
      const task = await first.create(
        {
          objective: "Return verified",
          capability: "text.generate",
          providers: ["fixture"],
          deadline: new Date(Date.now() + 60_000).toISOString(),
          verification: { kind: "contains", value: "verified" },
        },
        "postgres-claim",
        "operator",
      );
      const claims = await Promise.all([first.claim("a", 10_000), second.claim("b", 10_000)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await second.get(task.id)).status).toBe("RUNNING");
      // Server-side connection loss: the pool must discard dead clients and reconnect.
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
      );
      // One failed query on a stale idle client is acceptable; the next must reconnect.
      const recovered = await first.get(task.id).catch(() => first.get(task.id));
      expect(recovered.status).toBe("RUNNING");
      await expect(first.recover()).resolves.toBeUndefined();
    } finally {
      await a.close();
      await b.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    }
  },
);
