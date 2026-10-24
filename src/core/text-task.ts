import { CoreError, type Task, type TaskState, terminal } from "./contracts.js";
import type { Lane, TaskChange, TaskService } from "./tasks.js";

export type TextSpec = {
  prompt: string;
  providers: string[];
  privacy: "personal" | "private";
  deadlineMs: number;
  maxOutputTokens: number;
  // The reply must be one JSON object (conversation intents, replans).
  json?: boolean;
  // Safety-net poll while waiting for the task's change event.
  pollMs?: number;
  // interactive: the operator is waiting to hear it (claimed ahead of background work).
  lane?: Lane;
  // Characters at the start of the prompt that repeat across requests (prompt caching).
  cachePrefix?: number;
  signal?: AbortSignal;
};

// States where waiting longer cannot produce a reply.
const settled = new Set<TaskState>([
  ...terminal,
  "BLOCKED",
  "RECOVERY_REQUIRED",
  "WAITING_FOR_APPROVAL",
]);

// One text.generate task, waited for until it settles; the key makes a rerun return the same task.
export async function runText(
  tasks: TaskService,
  wake: () => void,
  spec: TextSpec,
  key: string,
): Promise<{ text: string; provider: string | null; taskId: string }> {
  spec.signal?.throwIfAborted();
  const started = Date.now();
  const task = await tasks.create(
    {
      objective: spec.prompt,
      capability: "text.generate",
      providers: spec.providers,
      providerOrder: "listed",
      ...(spec.json && { responseFormat: "json" as const }),
      ...(spec.lane && { lane: spec.lane }),
      ...(spec.cachePrefix && { cachePrefix: spec.cachePrefix }),
      privacy: spec.privacy,
      budget: {
        maxCalls: spec.providers.length,
        maxDurationMs: spec.deadlineMs,
        maxOutputTokens: spec.maxOutputTokens,
      },
      deadline: new Date(started + spec.deadlineMs).toISOString(),
      verification: { kind: "non-empty" },
    },
    key,
    "operator",
  );
  // Woken by the task's committed transitions; the short poll is only a safety net. A change
  // carries the new state, so only a settled task is read back: with its provider, in one query.
  const read = async () => {
    const row = (
      await tasks.db.query<Task & { provider: string | null }>(
        "SELECT t.*, (SELECT target FROM actions a WHERE a.task_id=t.id AND a.status='SUCCEEDED' ORDER BY a.id LIMIT 1) AS provider FROM tasks t WHERE t.id=$1",
        [task.id],
      )
    ).rows[0];
    if (!row) throw new CoreError("TASK_NOT_FOUND", 404);
    return row;
  };
  let current: Task & { provider?: string | null } = task;
  let dirty = false;
  let resume = () => {};
  const onChange = (change: TaskChange) => {
    if (change.id !== task.id) return;
    current = { ...current, status: change.status };
    if (!settled.has(change.status)) return;
    dirty = true;
    resume();
  };
  tasks.changes.on("change", onChange);
  const onAbort = () => {
    dirty = true;
    resume();
  };
  spec.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    wake();
    // The task deadline aborts the provider call itself; the grace covers Core's bookkeeping.
    while (!settled.has(current.status) && Date.now() < started + spec.deadlineMs + 2000) {
      if (spec.signal?.aborted) {
        await tasks.cancel(task.id);
        throw new CoreError("TURN_CANCELLED", 499);
      }
      if (!dirty && !settled.has(current.status))
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, spec.pollMs ?? 2000);
          resume = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      if (spec.signal?.aborted) continue;
      dirty = false;
      current = await read();
    }
  } finally {
    tasks.changes.off("change", onChange);
    spec.signal?.removeEventListener("abort", onAbort);
  }
  if (!("provider" in current)) current = await read();
  if (current.status !== "COMPLETED" || !current.result) {
    const late = Date.now() >= started + spec.deadlineMs;
    throw new CoreError(late ? "TURN_TIMEOUT" : "TURN_FAILED", late ? 504 : 502);
  }
  return { text: current.result.text, provider: current.provider ?? null, taskId: task.id };
}
