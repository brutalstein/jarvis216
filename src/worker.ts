import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { CoreError } from "./contracts.js";
import { ActionGateway } from "./gateway.js";
import type { ProviderRegistry } from "./routing.js";
import type { TaskService } from "./tasks.js";

export class Worker {
  private running = new Map<string, AbortController>();
  private gateway: ActionGateway;
  constructor(
    private tasks: TaskService,
    private registry: ProviderRegistry,
    redact: (text: string) => string = (text) => text,
  ) {
    this.gateway = new ActionGateway(tasks, redact);
  }
  cancel(id: string): void {
    this.running.get(id)?.abort();
  }
  async once(): Promise<boolean> {
    const leaseMs = 30_000;
    const owner = `worker:${randomUUID()}`;
    const task = await this.tasks.claim(owner, leaseMs);
    if (!task) return false;
    const controller = new AbortController();
    this.running.set(task.id, controller);
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    const renew = async () => {
      try {
        await this.tasks.heartbeat(task.id, owner, task.fence, leaseMs);
        if (!controller.signal.aborted) heartbeat = setTimeout(() => void renew(), 10_000);
      } catch {
        controller.abort();
      }
    };
    heartbeat = setTimeout(() => void renew(), 10_000);
    try {
      const attempted = (await this.tasks.actions(task.id))
        .filter((a) => a.status !== "AWAITING_APPROVAL")
        .map((a) => a.target);
      const selected = this.registry.select(task, attempted);
      await this.tasks.locked(async (tx) => {
        this.tasks.assertLease(await this.tasks.get(task.id, tx), task.owner, task.fence);
        await this.tasks.event(tx, task, "provider.selected", {
          provider: selected.id,
          registryVersion: this.registry.version,
          reason: "capability, auth, privacy, context, allowlist and priority matched",
        });
      });
      await this.gateway.run(task, selected, controller.signal);
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
          await this.tasks.move(
            tx,
            current,
            executing ? "RECOVERY_REQUIRED" : "BLOCKED",
            error instanceof CoreError ? error.code : "WORKER_FAILED",
          );
          await this.tasks.release(tx, task.id);
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
    signal.addEventListener(
      "abort",
      () => {
        for (const controller of this.running.values()) controller.abort();
      },
      { once: true },
    );
    while (!signal.aborted) {
      try {
        await this.tasks.recover();
        await this.once();
      } catch {
        process.stderr.write('{"level":"error","code":"WORKER_CYCLE_FAILED"}\n');
      }
      try {
        await delay(500, undefined, { signal });
      } catch {
        break;
      }
    }
  }
}
