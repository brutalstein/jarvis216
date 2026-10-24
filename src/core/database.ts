import { Pool, type PoolClient, type QueryResult } from "pg";

export interface Sql {
  query<T extends object = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  // A write whose result nobody reads: it may travel with the next statement or the COMMIT.
  defer?(text: string, params?: readonly Scalar[]): void;
}
export type Scalar = string | number | boolean | null;
// Inside a transaction, a write that can wait for the next statement; elsewhere it runs now.
export async function write(tx: Sql, text: string, params?: readonly Scalar[]): Promise<void> {
  if (tx.defer) tx.defer(text, params);
  else await tx.query(text, params);
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(
  url: string,
  pool = new Pool({
    connectionString: url,
    // Transactions are short, so a dozen connections serve every worker and route; it also stays
    // under a hosted session pooler's per-database limit (Supabase: 15).
    max: 12,
    // A remote database pays a TLS and auth handshake per new connection: keep them open.
    idleTimeoutMillis: 0,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
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
      // BEGIN and deferred writes wait here and travel in one simple-protocol message with the
      // next statement or the COMMIT (manual pipelining): against a remote database a
      // transaction costs one round trip per read, not one per statement.
      const pending = ["BEGIN"];
      let open = false;
      const literal = (value: unknown): string => {
        if (value === null || value === undefined) return "NULL";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number" || typeof value === "bigint" || typeof value === "string")
          return client.escapeLiteral(String(value));
        throw new TypeError("DEFERRED_PARAMETER_NOT_SCALAR");
      };
      const inline = (sql: string, params?: readonly unknown[]) =>
        params?.length ? sql.replace(/\$(\d+)/g, (_, n: string) => literal(params[+n - 1])) : sql;
      const scalar = (params?: readonly unknown[]) =>
        (params ?? []).every(
          (p) => p === null || ["string", "number", "boolean"].includes(typeof p),
        );
      const batch = async (statements: string[]): Promise<QueryResult> => {
        if (statements[0] === "BEGIN") open = true;
        const results = (await client.query(statements.join(";"))) as unknown as
          | QueryResult
          | QueryResult[];
        return (Array.isArray(results) ? results[results.length - 1] : results) as QueryResult;
      };
      const tx: Sql = {
        async query(sql, params) {
          if (!pending.length) return client.query(sql, params ? [...params] : undefined);
          if (scalar(params)) return batch(pending.splice(0).concat(inline(sql, params)));
          await batch(pending.splice(0));
          return client.query(sql, params ? [...params] : undefined);
        },
        defer(sql, params) {
          pending.push(inline(sql, params));
        },
      };
      try {
        const value = await fn(tx);
        if (open || pending.length > 1) await batch(pending.splice(0).concat("COMMIT"));
        return value;
      } catch (error) {
        // A failed ROLLBACK means the session is unusable; the server already aborted the
        // transaction. Destroy the client and surface the original error.
        if (open)
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
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=2")).rows.length)
      return;
    const ddl = `
      CREATE TABLE conversation_turns (
        id uuid PRIMARY KEY, created_at bigint NOT NULL, utterance text NOT NULL,
        follow_up boolean NOT NULL, task_id uuid NOT NULL REFERENCES tasks(id),
        reply jsonb NOT NULL, provider text
      );
      CREATE INDEX conversation_recency ON conversation_turns(created_at);
      INSERT INTO schema_migrations VALUES (2);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=3")).rows.length)
      return;
    const ddl = `
      CREATE TABLE plans (
        id uuid PRIMARY KEY, turn_id uuid, goal text NOT NULL, lang text NOT NULL,
        kind text NOT NULL, steps jsonb NOT NULL, hash text NOT NULL, status text NOT NULL,
        task_ids jsonb NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL,
        approved_at bigint, narrated boolean NOT NULL DEFAULT false,
        continued boolean NOT NULL DEFAULT false, replanned boolean NOT NULL DEFAULT false,
        outcome jsonb
      );
      CREATE INDEX plan_status ON plans(status,created_at);
      INSERT INTO schema_migrations VALUES (3);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=4")).rows.length)
      return;
    // Measured provider outcomes for adaptive routing, durable circuits and usage budgets.
    const ddl = `
      CREATE TABLE provider_observations (
        id bigserial PRIMARY KEY, provider text NOT NULL, capability text NOT NULL,
        outcome text NOT NULL CHECK(outcome IN ('success','failure','neutral')),
        kind text NOT NULL, duration_ms integer NOT NULL CHECK(duration_ms>=0),
        input_tokens integer CHECK(input_tokens>=0), output_tokens integer CHECK(output_tokens>=0),
        observed_at bigint NOT NULL
      );
      CREATE INDEX provider_recency ON provider_observations(provider,observed_at);
      CREATE INDEX observation_retention ON provider_observations(observed_at);
      INSERT INTO schema_migrations VALUES (4);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=5")).rows.length)
      return;
    // Spoken stop and candidate choices are answered without a model task.
    await tx.query("ALTER TABLE conversation_turns ALTER COLUMN task_id DROP NOT NULL");
    await tx.query("INSERT INTO schema_migrations VALUES (5)");
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=6")).rows.length)
      return;
    // Operator-approved long-term memory: its own data class, kept until the operator forgets it.
    const ddl = `
      CREATE TABLE memories (
        id uuid PRIMARY KEY, note text NOT NULL, normalized text NOT NULL UNIQUE,
        created_at bigint NOT NULL
      );
      CREATE INDEX memory_recency ON memories(created_at);
      INSERT INTO schema_migrations VALUES (6);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=7")).rows.length)
      return;
    // Transactional outbox: a status change and its notification commit together.
    const ddl = `
      CREATE TABLE deliveries (
        id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), status text NOT NULL,
        created_at bigint NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
        next_attempt_at bigint NOT NULL, delivered_at bigint, failed_at bigint
      );
      CREATE INDEX delivery_due ON deliveries(next_attempt_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
      INSERT INTO schema_migrations VALUES (7);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=8")).rows.length)
      return;
    // Operator permissions per catalog action, operator settings, and their audit trail.
    const ddl = `
      CREATE TABLE permissions (
        action text PRIMARY KEY, mode text NOT NULL CHECK(mode IN ('ask','allow','deny')),
        expires_at bigint, updated_at bigint NOT NULL
      );
      CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at bigint NOT NULL);
      CREATE TABLE permission_audit (
        id bigserial PRIMARY KEY, at bigint NOT NULL, actor text NOT NULL, change jsonb NOT NULL
      );
      INSERT INTO schema_migrations VALUES (8);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=9")).rows.length)
      return;
    // The learning brain: episodic experiences, procedural skills and learned choices.
    const ddl = `
      CREATE TABLE brain_experiences (
        id uuid PRIMARY KEY, at bigint NOT NULL, data jsonb NOT NULL
      );
      CREATE INDEX brain_experience_recency ON brain_experiences(at);
      CREATE TABLE brain_skills (id uuid PRIMARY KEY, data jsonb NOT NULL, updated_at bigint NOT NULL);
      CREATE TABLE brain_preferences (key text PRIMARY KEY, data jsonb NOT NULL);
      INSERT INTO schema_migrations VALUES (9);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=10")).rows.length)
      return;
    // Measured step and finisher durations: how long work takes on this computer (ETAs).
    const ddl = `
      CREATE TABLE step_durations (
        id bigserial PRIMARY KEY, key text NOT NULL, ms integer NOT NULL CHECK(ms>=0), at bigint NOT NULL
      );
      CREATE INDEX step_duration_recency ON step_durations(key, at);
      INSERT INTO schema_migrations VALUES (10);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=11")).rows.length)
      return;
    // Every spoken turn reads recent plans (working memory, pending choice) and a turn's plan.
    const ddl = `
      CREATE INDEX plan_recency ON plans(created_at);
      CREATE INDEX plan_turn ON plans(turn_id);
      INSERT INTO schema_migrations VALUES (11);
    `;
    for (const statement of ddl.split(";").filter((sql) => sql.trim())) await tx.query(statement);
  });
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(216216)");
    if ((await tx.query("SELECT version FROM schema_migrations WHERE version=12")).rows.length)
      return;
    await tx.query("ALTER TABLE tasks DROP CONSTRAINT tasks_status_check");
    await tx.query(`ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN (
      'CREATED','VALIDATING','PLANNING','READY','RUNNING','WAITING_FOR_APPROVAL',
      'WAITING_FOR_DEPENDENCY','VERIFYING','COMPLETED','FAILED','CANCELLED','BLOCKED',
      'RECOVERY_REQUIRED','SKIPPED'))`);
    await tx.query("INSERT INTO schema_migrations VALUES (12)");
  });
}
