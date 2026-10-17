import { PGlite } from "@electric-sql/pglite";
import { type Database, migrate, type Sql } from "../../src/database.js";

// In-memory PostgreSQL with Core's migrations applied.
export async function memoryDatabase(): Promise<Database> {
  const pg = new PGlite();
  const query: Sql["query"] = async (text, params) => pg.query(text, params as unknown[]);
  const db: Database = {
    query,
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}
