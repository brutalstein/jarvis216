import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { type Database, migrate } from "../src/database.js";
import { TaskService } from "../src/tasks.js";

it("persists an intent across database restart and requires reconciliation instead of replay", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-restart-"));
  const connect = (): Database => {
    const pg = new PGlite(directory);
    return {
      query: (s, p) => pg.query(s, p as unknown[]),
      transaction: (fn) =>
        pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
      close: () => pg.close(),
    };
  };
  let db = connect();
  try {
    await migrate(db);
    let tasks = new TaskService(db);
    const task = await tasks.create(
      {
        objective: "Return verified",
        capability: "text.generate",
        providers: ["fixture"],
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: "verified" },
      },
      "restart-intent",
      "operator",
    );
    await tasks.claim("dead-process", 10_000);
    await db.query(
      "INSERT INTO actions(id,task_id,hash,target,risk,parameters,status) VALUES($1,$2,'restart-hash','fixture','LOW','{}','EXECUTING')",
      ["2e5c4d4d-706a-4b1f-a254-2d1c918b8889", task.id],
    );
    await db.query("UPDATE tasks SET lease_until=0 WHERE id=$1", [task.id]);
    await db.close();
    db = connect();
    await migrate(db);
    tasks = new TaskService(db);
    await tasks.recover();
    expect((await tasks.get(task.id)).status).toBe("RECOVERY_REQUIRED");
    expect((await tasks.actions(task.id))[0]?.status).toBe("UNCERTAIN");
    expect(await tasks.claim("replacement", 10_000)).toBeNull();
  } finally {
    await db.close();
    if (path.dirname(directory) === os.tmpdir())
      await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
