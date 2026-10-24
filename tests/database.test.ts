import type { Pool } from "pg";
import { expect, it } from "vitest";
import { postgres } from "../src/core/database.js";

it("destroys a broken connection and keeps the original error when ROLLBACK fails", async () => {
  const released: unknown[] = [];
  const client = {
    query: async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("connection terminated");
      return { rows: [] };
    },
    escapeLiteral: (value: string) => `'${value}'`,
    release: (destroy?: unknown) => released.push(destroy),
  };
  const pool = { connect: async () => client, on: () => pool, end: async () => {} };
  const db = postgres("postgresql://unused", pool as unknown as Pool);
  await expect(
    db.transaction(async (tx) => {
      await tx.query("SELECT 1");
      throw new Error("statement failed");
    }),
  ).rejects.toThrow("statement failed");
  expect(released).toEqual([true]);
});

// A fake connection that records each message sent to the server.
function recording() {
  const sent: { sql: string; params?: unknown[] }[] = [];
  const released: unknown[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      sent.push(params ? { sql, params } : { sql });
      const count = sql.split(";").length;
      const result = (i: number) => ({ rows: [{ i }] });
      return count > 1 ? Array.from({ length: count }, (_, i) => result(i)) : result(0);
    },
    escapeLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
    release: (destroy?: unknown) => released.push(destroy),
  };
  const pool = { connect: async () => client, on: () => pool, end: async () => {} };
  return { db: postgres("postgresql://unused", pool as unknown as Pool), sent, released };
}

it("sends BEGIN, deferred writes and the next read as one message", async () => {
  const { db, sent } = recording();
  const rows = await db.transaction(async (tx) => {
    tx.defer?.("UPDATE t SET a=$1 WHERE id=$2", ["it's", 7]);
    const read = await tx.query("SELECT $1::boolean, $2", [true, null]);
    tx.defer?.("DELETE FROM t");
    return read.rows;
  });
  expect(sent).toEqual([
    { sql: "BEGIN;UPDATE t SET a='it''s' WHERE id='7';SELECT true::boolean, NULL" },
    { sql: "DELETE FROM t;COMMIT" },
  ]);
  // The read's own result, not BEGIN's.
  expect(rows).toEqual([{ i: 2 }]);
});

it("flushes before a read whose parameters cannot be inlined", async () => {
  const { db, sent } = recording();
  const when = new Date(0);
  await db.transaction(async (tx) => {
    tx.defer?.("UPDATE t SET a=1");
    await tx.query("SELECT $1", [when]);
  });
  expect(sent).toEqual([
    { sql: "BEGIN;UPDATE t SET a=1" },
    { sql: "SELECT $1", params: [when] },
    { sql: "COMMIT" },
  ]);
});

it("skips BEGIN, COMMIT and ROLLBACK when nothing reached the server", async () => {
  const { db, sent, released } = recording();
  await expect(db.transaction(async () => 1)).resolves.toBe(1);
  await expect(
    db.transaction(async () => {
      throw new Error("before any statement");
    }),
  ).rejects.toThrow("before any statement");
  expect(sent).toEqual([]);
  expect(released).toEqual([false, false]);
});
