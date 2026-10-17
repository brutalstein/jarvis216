import { randomUUID } from "node:crypto";
import { ContextEntrySchema, fingerprint, invariant, type Task } from "./contracts.js";
import type { Sql } from "./database.js";
import type { TaskService } from "./tasks.js";

export async function insertContext(
  tx: Sql,
  task: Task,
  raw: unknown,
  redact: (text: string) => string,
): Promise<void> {
  const entry = ContextEntrySchema.parse(raw);
  invariant(
    entry.expiresAt > Date.now() && entry.expiresAt <= Date.now() + 7 * 86400_000,
    "INVALID_CONTEXT_RETENTION",
    400,
  );
  const count = (
    await tx.query<{ count: string }>("SELECT count(*) FROM task_context WHERE task_id=$1", [
      task.id,
    ])
  ).rows[0];
  invariant(Number(count?.count) < 32, "CONTEXT_LIMIT");
  const text = redact(entry.text);
  await tx.query(
    "INSERT INTO task_context(id,task_id,source,content,content_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      task.id,
      redact(entry.source),
      text,
      fingerprint(text),
      Date.now(),
      entry.expiresAt,
    ],
  );
}

export class ContextStore {
  constructor(
    private tasks: TaskService,
    private redact: (text: string) => string = (text) => text,
  ) {}
  async put(id: string, raw: unknown): Promise<void> {
    await this.tasks.locked(async (tx) => {
      const task = await this.tasks.get(id, tx);
      invariant(
        task.attempt === 0 && ["READY", "WAITING_FOR_DEPENDENCY"].includes(task.status),
        "CONTEXT_FROZEN",
      );
      await insertContext(tx, task, raw, this.redact);
      await this.tasks.event(tx, task, "context.added", {
        provenance: "operator-supplied untrusted content",
      });
    });
  }
  async pack(id: string, maxChars = 8000): Promise<string> {
    invariant(
      Number.isInteger(maxChars) && maxChars >= 100 && maxChars <= 16_000,
      "INVALID_CONTEXT_BUDGET",
      400,
    );
    const entries = (
      await this.tasks.db.query<{ source: string; content: string; content_hash: string }>(
        "SELECT source,content,content_hash FROM task_context WHERE task_id=$1 AND expires_at>$2 ORDER BY created_at,id LIMIT 32",
        [id, Date.now()],
      )
    ).rows;
    let pack = "";
    for (const entry of entries) {
      const header = `[source:${entry.source} sha256:${entry.content_hash.slice(0, 12)}]\n`;
      if (pack.length + header.length + 14 >= maxChars) break;
      const remaining = maxChars - pack.length - header.length - 14;
      const content = entry.content.slice(0, remaining);
      pack += `${header}${content}${content.length < entry.content.length ? "[TRUNCATED]" : ""}\n`;
    }
    return pack;
  }
  async prune(): Promise<void> {
    await this.tasks.db.query("DELETE FROM task_context WHERE expires_at<=$1", [Date.now()]);
  }
}
