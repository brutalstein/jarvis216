import type { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecutionResult } from "../core/contracts.js";
import type { Database } from "../core/database.js";
import { serviceDispatcher, serviceUrl } from "../integrations/http.js";

type Due = {
  id: string;
  task_id: string;
  status: string;
  created_at: string | number;
  attempts: number;
  next_attempt_at: string | number;
  correlation_id: string;
  result: ExecutionResult | null;
};

// Pushes queued task-status events to the submitter's registered webhook (n8n), so it reacts to
// a settled task instead of polling. At least once: each event carries a stable eventId for the
// receiver to deduplicate by. The event repeats what the scoped status endpoint already returns
// to the same submitter, so it grants nothing new; only verified completions carry a result.
export class Outbox {
  #url: string;
  #running: Promise<number> | undefined;
  #again = false;
  constructor(
    private db: Database,
    private target: { url: string; token: string },
    private options: {
      maxAttempts?: number;
      timeoutMs?: number;
      now?: () => number;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.#url = serviceUrl(target.url);
  }

  // Single flight; a request arriving mid-run triggers one more pass.
  deliverDue(): Promise<number> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      let delivered = 0;
      do {
        this.#again = false;
        delivered += await this.#pass();
      } while (this.#again);
      return delivered;
    })().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  start(signal: AbortSignal, changes?: EventEmitter): void {
    const failed = () => process.stderr.write('{"level":"error","code":"OUTBOX_PASS_FAILED"}\n');
    const onChange = () => void this.deliverDue().catch(failed);
    changes?.on("change", onChange);
    signal.addEventListener("abort", () => changes?.off("change", onChange), { once: true });
    void (async () => {
      while (!signal.aborted) {
        await this.deliverDue().catch(failed);
        // Task changes trigger passes; this only picks up retries that came due.
        await delay(15_000, undefined, { signal }).catch(() => {});
      }
    })();
  }

  async #pass(): Promise<number> {
    const now = this.#now();
    const due = (
      await this.db.query<Due>(
        "SELECT d.id,d.task_id,d.status,d.created_at,d.attempts,d.next_attempt_at,t.correlation_id,t.result FROM deliveries d JOIN tasks t ON t.id=d.task_id WHERE d.delivered_at IS NULL AND d.failed_at IS NULL AND d.next_attempt_at<=$1 ORDER BY d.created_at,d.id LIMIT 20",
        [now],
      )
    ).rows;
    let delivered = 0;
    for (const event of due) {
      // Lease the row so a second pass or Core process never sends it concurrently.
      const leased = await this.db.query(
        "UPDATE deliveries SET next_attempt_at=$3 WHERE id=$1 AND next_attempt_at=$2 AND delivered_at IS NULL RETURNING id",
        [event.id, event.next_attempt_at, now + 60_000],
      );
      if (!leased.rows.length) continue;
      if (await this.#send(event)) {
        await this.db.query("UPDATE deliveries SET delivered_at=$2 WHERE id=$1", [
          event.id,
          this.#now(),
        ]);
        delivered++;
        continue;
      }
      const attempts = event.attempts + 1;
      const exhausted = attempts >= (this.options.maxAttempts ?? 12);
      // Exponential backoff with jitter: 2 s, 4 s ... capped at 5 minutes; then dead-lettered.
      const backoff =
        Math.min(300_000, 2000 * 2 ** (attempts - 1)) + Math.floor(Math.random() * 500);
      await this.db.query(
        "UPDATE deliveries SET attempts=$2, next_attempt_at=$3, failed_at=$4 WHERE id=$1",
        [event.id, attempts, this.#now() + backoff, exhausted ? this.#now() : null],
      );
    }
    return delivered;
  }

  async #send(event: Due): Promise<boolean> {
    const body = JSON.stringify({
      protocolVersion: 1,
      type: "task.status",
      eventId: event.id,
      taskId: event.task_id,
      correlationId: event.correlation_id,
      status: event.status,
      occurredAt: new Date(Number(event.created_at)).toISOString(),
      result:
        event.status === "COMPLETED" && event.result
          ? { text: event.result.text, source: event.result.source }
          : null,
    });
    try {
      const response = await (this.options.fetch ?? fetch)(this.#url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.target.token}`,
          "content-type": "application/json",
          "x-jarvis-idempotency-key": event.id,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
        dispatcher: serviceDispatcher,
      } as RequestInit);
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  #now(): number {
    return (this.options.now ?? Date.now)();
  }
}
