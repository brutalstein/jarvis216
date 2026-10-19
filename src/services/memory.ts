import { randomUUID } from "node:crypto";
import { compile, type Evidence, normalize, secretNote } from "@jarvis/action-engine";
import type { ExecutionResult, Executor, Task } from "../core/contracts.js";
import type { Database } from "../core/database.js";
import { ProviderFailure } from "../core/routing.js";

export type Memory = { id: string; note: string; createdAt: number };
export const maxMemories = 200;
// The prompt carries the newest notes only, within this many characters.
const promptChars = 3000;

const seen = (observation: string): Evidence => ({
  ok: true,
  evidence: "postcondition",
  observation,
});
const failed = (observation: string): Evidence => ({
  ok: false,
  evidence: "observed-failure",
  observation,
});
const refused = (observation: string): Evidence => ({
  ok: false,
  evidence: "refused",
  observation,
});

// Long-term memory the operator approved note by note (directive §12: its own data class, not
// conversation history). Notes reach conversation providers as personal context, so a note that
// holds a credential is never stored.
export class MemoryStore {
  constructor(private db: Database) {}

  async list(limit = maxMemories): Promise<Memory[]> {
    const rows = (
      await this.db.query<{ id: string; note: string; created_at: string | number }>(
        "SELECT id,note,created_at FROM memories ORDER BY created_at DESC,id LIMIT $1",
        [limit],
      )
    ).rows;
    return rows.map((row) => ({ id: row.id, note: row.note, createdAt: Number(row.created_at) }));
  }

  // Newest first, bounded, for the conversation prompt.
  async promptNotes(): Promise<string[]> {
    const notes: string[] = [];
    let size = 0;
    for (const { note } of await this.list(50)) {
      if (size + note.length > promptChars) break;
      notes.push(note);
      size += note.length;
    }
    return notes;
  }

  async save(note: string): Promise<Evidence> {
    const text = note.replace(/\s+/g, " ").trim();
    if (secretNote(text)) return refused("notes never hold passwords, keys or card numbers");
    const normalized = normalize(text);
    return this.db.transaction(async (tx) => {
      const existing = await tx.query("SELECT id FROM memories WHERE normalized=$1", [normalized]);
      if (existing.rows.length) return seen("already remembered");
      const count = (await tx.query<{ count: string }>("SELECT count(*) FROM memories")).rows[0];
      if (Number(count?.count) >= maxMemories) return failed("memory is full; forget something");
      await tx.query("INSERT INTO memories(id,note,normalized,created_at) VALUES($1,$2,$3,$4)", [
        randomUUID(),
        text,
        normalized,
        Date.now(),
      ]);
      const stored = await tx.query("SELECT id FROM memories WHERE normalized=$1", [normalized]);
      return stored.rows.length ? seen("remembered") : failed("the note was not stored");
    });
  }

  // Forgets every note containing all the topic's words (three letters or more).
  async forget(about: string): Promise<Evidence> {
    const words = normalize(about)
      .split(" ")
      .filter((word) => word.length >= 3);
    if (!words.length) return failed("say what to forget");
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.query<{ id: string; normalized: string }>("SELECT id,normalized FROM memories")
      ).rows;
      const matching = rows.filter((row) => words.every((word) => row.normalized.includes(word)));
      if (!matching.length) return failed("no note matches");
      await tx.query("DELETE FROM memories WHERE id = ANY($1::uuid[])", [
        matching.map((row) => row.id),
      ]);
      return seen(`${matching.length} notes forgotten`);
    });
  }

  async delete(id: string): Promise<boolean> {
    return (
      (await this.db.query("DELETE FROM memories WHERE id=$1 RETURNING id", [id])).rows.length > 0
    );
  }

  async deleteAll(): Promise<void> {
    await this.db.query("DELETE FROM memories");
  }
}

export class MemoryExecutor implements Executor {
  readonly id = "memory";
  readonly capability = "memory.write";
  readonly external = false;
  // A local write that Core reads back: an unmet result is observed, never uncertain.
  readonly retrySafe = false;
  readonly outcomeObservable = true;
  constructor(private store: MemoryStore) {}
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const compiled = compile([task.spec.input]);
    const step = compiled.ok ? compiled.steps[0] : undefined;
    if (
      step?.kind !== "memory" ||
      task.spec.capability !== "memory.write" ||
      (step.risk === "MEDIUM" && task.spec.risk === "LOW")
    )
      throw new ProviderFailure("policy-denied", false, false);
    signal.throwIfAborted();
    const text = (key: string) => (typeof step.args[key] === "string" ? step.args[key] : "");
    const evidence =
      step.action === "memory.save"
        ? await this.store.save(text("note"))
        : await this.store.forget(text("about"));
    return { text: JSON.stringify(evidence), source: `memory:${evidence.evidence}` };
  }
}
