import { setTimeout as delay } from "node:timers/promises";
import { CoreError, type TaskState, terminal } from "./contracts.js";
import type { TaskService } from "./tasks.js";

export type TextSpec = {
  prompt: string;
  providers: string[];
  privacy: "personal" | "private";
  deadlineMs: number;
  maxOutputTokens: number;
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
  const started = Date.now();
  const task = await tasks.create(
    {
      objective: spec.prompt,
      capability: "text.generate",
      providers: spec.providers,
      providerOrder: "listed",
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
  wake();
  // The task deadline aborts the provider call itself; the grace covers Core's bookkeeping.
  let current = task;
  while (!settled.has(current.status) && Date.now() < started + spec.deadlineMs + 2000) {
    await delay(50);
    current = await tasks.get(task.id);
  }
  if (current.status !== "COMPLETED" || !current.result) {
    const late = Date.now() >= started + spec.deadlineMs;
    throw new CoreError(late ? "TURN_TIMEOUT" : "TURN_FAILED", late ? 504 : 502);
  }
  const provider =
    (await tasks.actions(task.id)).find((action) => action.status === "SUCCEEDED")?.target ?? null;
  return { text: current.result.text, provider, taskId: task.id };
}
