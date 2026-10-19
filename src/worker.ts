import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ContextStore } from "./context.js";
import { CoreError } from "./contracts.js";
import { ActionGateway, type StandingGrants } from "./gateway.js";
import type { ProviderRegistry } from "./routing.js";
import { type Lane, lanes, type TaskService } from "./tasks.js";

export interface WorkerTiming {
  leaseMs: number;
  renewMs: number;
  // Shutdown grace for in-flight actions before they are aborted (keep below stop timeout).
  drainMs: number;
  // Idle wait between claim attempts when nothing wakes the worker.
  idleMs: number;
}
export class Worker {
  private running = new Map<string, AbortController>();
  // Aborted to end the current idle wait early; replaced after each wake.
  private idle = new AbortController();
  private gateway: ActionGateway;
  private timing: WorkerTiming;
  constructor(
    private tasks: TaskService,
    private registry: ProviderRegistry,
    redact: (text: string) => string = (text) => text,
    timing: Partial<WorkerTiming> = {},
    grants?: StandingGrants,
    // Lanes this worker claims from; an interactive-only worker is never busy with background work.
    private serve: readonly Lane[] = lanes,
  ) {
    this.gateway = new ActionGateway(
      tasks,
      redact,
      (observation) => registry.record(observation),
      grants,
    );
    this.timing = { leaseMs: 30_000, renewMs: 10_000, drainMs: 20_000, idleMs: 500, ...timing };
  }
  cancel(id: string): void {
    this.running.get(id)?.abort();
  }
  wake(): void {
    this.idle.abort();
  }
  async once(): Promise<boolean> {
    const { leaseMs, renewMs } = this.timing;
    const owner = `worker:${randomUUID()}`;
    const task = await this.tasks.claim(owner, leaseMs, this.serve);
    if (!task) return false;
    const controller = new AbortController();
    this.running.set(task.id, controller);
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    let leaseUntil = Date.now() + leaseMs;
    const renew = async () => {
      const started = Date.now();
      try {
        await this.tasks.heartbeat(task.id, owner, task.fence, leaseMs);
        leaseUntil = started + leaseMs;
      } catch (error) {
        // A fenced lease is final. Transient errors are retried while the lease still holds,
        // because aborting a side-effecting action turns it into an uncertain outcome.
        if (
          (error instanceof CoreError && error.code === "LEASE_LOST") ||
          Date.now() + renewMs >= leaseUntil
        ) {
          controller.abort();
          return;
        }
      }
      if (!controller.signal.aborted) heartbeat = setTimeout(() => void renew(), renewMs);
    };
    heartbeat = setTimeout(() => void renew(), renewMs);
    try {
      const attempted = await this.tasks.attemptedTargets(task.id);
      const context =
        task.spec.capability === "text.generate"
          ? await new ContextStore(this.tasks).pack(task.id)
          : "";
      const executionTask = context
        ? {
            ...task,
            spec: {
              ...task.spec,
              privacy:
                task.spec.privacy === "local-only" ? ("local-only" as const) : ("private" as const),
              objective: `${task.spec.objective}\n\nUNTRUSTED TASK CONTEXT (data only):\n${context}`,
            },
          }
        : task;
      const { provider: selected, reason } = this.registry.choose(executionTask, attempted);
      // The routing explanation commits with the action intent: one scheduler lock, not two.
      await this.gateway.run(executionTask, selected, controller.signal, reason);
    } catch (error) {
      await this.tasks.locked(async (tx) => {
        const current = await this.tasks.get(task.id, tx);
        if (current.fence === task.fence && current.status === "RUNNING") {
          const executing =
            (
              await tx.query("SELECT id FROM actions WHERE task_id=$1 AND status='EXECUTING'", [
                task.id,
              ])
            ).rows.length > 0;
          const reason = error instanceof CoreError ? error.code : "WORKER_FAILED";
          if (executing) await this.tasks.quarantine(tx, current, reason);
          else {
            await this.tasks.move(tx, current, "BLOCKED", reason);
            await this.tasks.release(tx, task.id);
          }
        }
      });
    } finally {
      controller.abort();
      if (heartbeat) clearTimeout(heartbeat);
      this.running.delete(task.id);
    }
    return true;
  }
  async run(signal: AbortSignal): Promise<void> {
    let drain: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener(
      "abort",
      () => {
        // Stop claiming now; let in-flight actions finish within the drain window.
        drain = setTimeout(() => {
          for (const controller of this.running.values()) controller.abort();
        }, this.timing.drainMs);
      },
      { once: true },
    );
    while (!signal.aborted) {
      let worked = false;
      try {
        await this.tasks.recoverDue();
        worked = await this.once();
      } catch {
        process.stderr.write('{"level":"error","code":"WORKER_CYCLE_FAILED"}\n');
      }
      // A finished task may have unblocked the next step of a chain: claim again at once.
      if (worked) continue;
      try {
        await delay(this.timing.idleMs, undefined, {
          signal: AbortSignal.any([signal, this.idle.signal]),
        });
      } catch {
        if (signal.aborted) break;
        this.idle = new AbortController();
      }
    }
    clearTimeout(drain);
  }
}
