import {
  compile,
  type Evidence,
  fetchNews,
  type Kind,
  type NewsContext,
  runStep,
  type ToolPort,
} from "@jarvis/action-engine";
import type { ExecutionResult, Executor, Task } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";

function step(task: Task, kind: Kind) {
  const compiled = compile([task.spec.input]);
  const action = compiled.ok ? compiled.steps[0] : undefined;
  if (
    !action ||
    task.spec.capability !== (kind === "desktop" ? "desktop.act" : "info.fetch") ||
    action.kind !== kind ||
    (action.risk === "MEDIUM" && task.spec.risk === "LOW")
  )
    throw new ProviderFailure("policy-denied", false, false);
  return action;
}

export class DesktopExecutor implements Executor {
  readonly id = "windows-mcp";
  readonly capability = "desktop.act";
  readonly external = false;
  readonly retrySafe = false;
  readonly outcomeObservable = true;
  constructor(
    private tools: ToolPort,
    private roots: string[],
    // The brain's learned pick among on-screen candidates (exact situation only).
    private prefer?: (target: string, candidates: string[]) => string | undefined,
  ) {}
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const action = step(task, "desktop");
    try {
      const evidence = await runStep(action, {
        tools: this.tools,
        roots: this.roots,
        signal,
        ...(this.prefer && { prefer: this.prefer }),
      });
      return { text: JSON.stringify(evidence), source: `windows-mcp:${evidence.evidence}` };
    } catch (error) {
      if (error instanceof Error && error.message === "MCP_CHANNEL_LOST")
        throw new ProviderFailure("transient", false, true);
      throw error;
    }
  }
}

export class NewsExecutor implements Executor {
  readonly id = "news";
  readonly capability = "info.fetch";
  readonly external = true;
  readonly retrySafe = true;
  readonly outcomeObservable = true;
  constructor(
    private feeds: string[],
    private options: { fetch?: typeof fetch; lookup?: NewsContext["lookup"] } = {},
  ) {}
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const action = step(task, "info");
    signal.throwIfAborted();
    const items = await fetchNews(action.args, {
      feeds: this.feeds,
      fetch: this.options.fetch ?? globalThis.fetch,
      lookup: this.options.lookup,
      signal,
    });
    signal.throwIfAborted();
    const evidence: Evidence = {
      ok: items.length > 0,
      evidence: items.length ? "postcondition" : "observed-failure",
      observation: `${items.length} news items`,
      panel: {
        type: "news",
        title: typeof action.args.topic === "string" ? action.args.topic : "Haberler",
        items,
      },
    };
    return { text: JSON.stringify(evidence), source: `news:${evidence.evidence}` };
  }
}
