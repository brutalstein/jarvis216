import { CoreError, type TaskState, terminal } from "./contracts.js";
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
  // Woken by the task's committed transitions; the short poll is only a safety net.
  let dirty = false;
  let resume = () => {};
  const onChange = (change: TaskChange) => {
    if (change.id !== task.id) return;
    dirty = true;
    resume();
  };
  tasks.changes.on("change", onChange);
  const onAbort = () => {
    dirty = true;
    resume();
  };
  spec.signal?.addEventListener("abort", onAbort, { once: true });
  let current = task;
  try {
    wake();
    // The task deadline aborts the provider call itself; the grace covers Core's bookkeeping.
    while (!settled.has(current.status) && Date.now() < started + spec.deadlineMs + 2000) {
      if (spec.signal?.aborted) {
        await tasks.cancel(task.id);
        throw new CoreError("TURN_CANCELLED", 499);
      }
      if (!dirty)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, spec.pollMs ?? 250);
          resume = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      dirty = false;
      current = await tasks.get(task.id);
    }
  } finally {
    tasks.changes.off("change", onChange);
    spec.signal?.removeEventListener("abort", onAbort);
  }
  if (current.status !== "COMPLETED" || !current.result) {
    const late = Date.now() >= started + spec.deadlineMs;
    throw new CoreError(late ? "TURN_TIMEOUT" : "TURN_FAILED", late ? 504 : 502);
  }
  const provider =
    (await tasks.actions(task.id)).find((action) => action.status === "SUCCEEDED")?.target ?? null;
  return { text: current.result.text, provider, taskId: task.id };
}
