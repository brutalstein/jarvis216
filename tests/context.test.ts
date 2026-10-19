import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { ContextStore } from "../src/core/context.js";
import { type Database, migrate } from "../src/core/database.js";
import { TaskService } from "../src/core/tasks.js";

it("compacts only the owning task's bounded, unexpired, redacted context with provenance", async () => {
  const pg = new PGlite();
  const db: Database = {
    query: (s, p) => pg.query(s, p as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  try {
    await migrate(db);
    const tasks = new TaskService(db);
    const input = {
      objective: "analyze",
      capability: "text.generate",
      providers: ["test"],
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "contains", value: "verified" },
    };
    const a = await tasks.create(input, "ctx-a", "operator");
    const b = await tasks.create(input, "ctx-b", "operator");
    const context = new ContextStore(tasks, (text) => text.replaceAll("private-key", "[REDACTED]"));
    await context.put(a.id, {
      source: "operator:note",
      text: "private-key needs verification",
      expiresAt: Date.now() + 60_000,
    });
    await context.put(b.id, {
      source: "operator:other",
      text: "unrelated private context",
      expiresAt: Date.now() + 60_000,
    });
    const packed = await context.pack(a.id, 120);
    expect(packed).not.toContain("private-key");
    expect(packed).not.toContain("unrelated");
    expect(packed).toContain("operator:note");
    expect(packed.length).toBeLessThanOrEqual(120);
    await tasks.claim("w", 10_000);
    await expect(
      context.put(a.id, {
        source: "operator:mutation",
        text: "changed",
        expiresAt: Date.now() + 60_000,
      }),
    ).rejects.toThrow("CONTEXT_FROZEN");
    await db.query("UPDATE task_context SET expires_at=0");
    await context.prune();
    expect(await context.pack(a.id, 120)).toBe("");
  } finally {
    await db.close();
  }
});
