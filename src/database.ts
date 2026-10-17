import { Pool, type PoolClient } from "pg";

export interface Sql {
  query<T extends object = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(
  url: string,
  pool = new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10_000,
  }),
): Database {
  pool.on("error", () => {
    process.stderr.write('{"level":"error","code":"DATABASE_POOL_ERROR"}\n');
  });
  const wrap = (client: Pool | PoolClient): Sql => ({
    query: (sql, params) => client.query(sql, params ? [...params] : undefined),
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        const value = await fn(wrap(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        // A failed ROLLBACK means the session is unusable; the server already aborted the
        // transaction. Destroy the client and surface the original error.
        await client.query("ROLLBACK").catch(() => {
          broken = true;
        });
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}

// Append migrations; never rewrite a migration after a deployed release.
export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    await tx.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)");
    // Table lock also serializes first-time migration across Core processes.
    await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=1")).rows.length)
      return;
    const ddl = `
      CREATE TABLE scheduler_lock (id integer PRIMARY KEY CHECK(id=1));
      INSERT INTO scheduler_lock VALUES (1);
      CREATE TABLE tasks (
        id uuid PRIMARY KEY, correlation_id uuid NOT NULL, principal text NOT NULL,
        idempotency_key text NOT NULL, request_hash text NOT NULL, spec jsonb NOT NULL,
        status text NOT NULL CHECK(status IN ('CREATED','VALIDATING','PLANNING','READY','RUNNING','WAITING_FOR_APPROVAL','WAITING_FOR_DEPENDENCY','VERIFYING','COMPLETED','FAILED','CANCELLED','BLOCKED','RECOVERY_REQUIRED')),
        owner text, fence integer NOT NULL DEFAULT 0, lease_until bigint,
        calls integer NOT NULL DEFAULT 0 CHECK(calls>=0), attempt integer NOT NULL DEFAULT 0,
        result jsonb, created_at bigint NOT NULL, not_before bigint NOT NULL DEFAULT 0,
        UNIQUE(principal,idempotency_key)
      );
      CREATE INDEX task_queue ON tasks(status,created_at);
      CREATE TABLE dependencies (
        task_id uuid REFERENCES tasks(id), dependency_id uuid REFERENCES tasks(id),
        PRIMARY KEY(task_id,dependency_id), CHECK(task_id<>dependency_id)
      );
      CREATE TABLE actions (
        id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), hash text NOT NULL,
        target text NOT NULL, risk text NOT NULL, parameters jsonb NOT NULL,
        status text NOT NULL, result jsonb, UNIQUE(task_id,hash)
      );
      CREATE TABLE approvals (
        action_id uuid PRIMARY KEY REFERENCES actions(id), hash text NOT NULL,
        approver text NOT NULL, expires_at bigint NOT NULL, consumed_at bigint
      );
      CREATE TABLE events (
        sequence bigserial PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id),
        envelope jsonb NOT NULL
      );
      CREATE INDEX task_events ON events(task_id,sequence);
      CREATE TABLE task_context (
        id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), source text NOT NULL,
        content text NOT NULL, content_hash text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL
      );
      CREATE INDEX context_retention ON task_context(expires_at);
      INSERT INTO schema_migrations VALUES (1);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
}
