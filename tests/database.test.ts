import type { Pool } from "pg";
import { expect, it } from "vitest";
import { postgres } from "../src/database.js";

it("destroys a broken connection and keeps the original error when ROLLBACK fails", async () => {
  const released: unknown[] = [];
  const client = {
    query: async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("connection terminated");
      return { rows: [] };
    },
    release: (destroy?: unknown) => released.push(destroy),
  };
  const pool = { connect: async () => client, on: () => pool, end: async () => {} };
  const db = postgres("postgresql://unused", pool as unknown as Pool);
  await expect(
    db.transaction(async () => {
      throw new Error("statement failed");
    }),
  ).rejects.toThrow("statement failed");
  expect(released).toEqual([true]);
});
