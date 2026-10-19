import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  BrowserInputSchema,
  CoreError,
  type ExecutionResult,
  type Executor,
  type Progress,
  ResultSchema,
  type Task,
  WorkflowInputSchema,
} from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";
import { jsonRequest, serviceUrl } from "./http.js";

const OpenResponse = z.object({
  id: z.string(),
  status: z.literal("completed"),
  output: z
    .array(
      z.object({
        type: z.literal("message"),
        role: z.literal("assistant"),
        content: z.array(z.object({ type: z.literal("output_text"), text: z.string() })),
      }),
    )
    .min(1),
});

/** Bounded readiness check; never treats a reachable Gateway as policy-verified. */
export async function probeOpenClaw(
  base: string,
  token: string,
  signal: AbortSignal,
): Promise<"ready" | "unavailable"> {
  const url = `${serviceUrl(base)}/`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal,
      redirect: "error",
    });
    await response.body?.cancel();
    return response.status < 500 ? "ready" : "unavailable";
  } catch (error) {
    if (signal.aborted) throw error;
    return "unavailable";
  }
}

/** Stable Gateway session key: plan-scoped when present so chained delegates share a session. */
export function openClawUserKey(task: Task): string {
  return task.spec.planId ? `plan:${task.spec.planId}` : task.id;
}

export class OpenClawExecutor implements Executor {
  readonly id = "openclaw";
  readonly capability = "text.generate";
  readonly external = true;
  // Runtime tool restrictions must be verified by deployment. Even disconnect is uncertain.
  readonly retrySafe = false;
  // An agent runtime may act, not just answer: every run needs exact operator approval.
  readonly riskFloor = "HIGH" as const;
  private base: string;
  constructor(
    base: string,
    private token: string,
    private agent: string,
  ) {
    this.base = serviceUrl(base);
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const response = OpenResponse.parse(
      await jsonRequest(
        `${this.base}/v1/responses`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            "x-openclaw-agent-id": this.agent,
          },
          body: JSON.stringify({
            model: "openclaw",
            input: task.spec.objective,
            user: openClawUserKey(task),
            stream: false,
            max_output_tokens: task.spec.budget.maxOutputTokens,
            tools: [],
            tool_choice: "none",
          }),
        },
        signal,
      ),
    );
    return {
      text: response.output.flatMap((item) => item.content.map((part) => part.text)).join("\n"),
      source: "openclaw:output-contract",
      externalId: response.id,
    };
  }
}

function browserPages(input: z.infer<typeof BrowserInputSchema>): {
  url: string;
  expectedText: string;
}[] {
  return "pages" in input ? input.pages : [input];
}

export class BrowserExecutor implements Executor {
  readonly id = "browser-use";
  readonly capability = "browser.extract";
  readonly external = true;
  readonly retrySafe = false;
  private base: string;
  constructor(
    base: string,
    private token: string,
  ) {
    this.base = serviceUrl(base);
  }
  async execute(
    task: Task,
    signal: AbortSignal,
    progress?: (update: Progress) => void,
  ): Promise<ExecutionResult> {
    const input = BrowserInputSchema.parse(task.spec.input);
    const pages = browserPages(input);
    const [first] = pages;
    if (!first) throw new ProviderFailure("invalid-response", false, false);
    const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
    progress?.({ stage: "opening", detail: host(first.url), index: 1, total: pages.length });
    const body =
      pages.length === 1
        ? {
            url: first.url,
            expectedText: first.expectedText,
            taskId: task.id,
            timeoutMs: Math.min(task.spec.budget.maxDurationMs, 60_000),
          }
        : {
            pages,
            taskId: task.id,
            timeoutMs: Math.min(task.spec.budget.maxDurationMs, 60_000),
          };
    const response = await jsonRequest(
      `${this.base}/v1/extract`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          // The worker streams which page it is on; an older worker just answers JSON.
          accept: "application/x-ndjson, application/json",
          "x-correlation-id": task.correlation_id,
        },
        body: JSON.stringify(body),
      },
      signal,
      (raw) => {
        const step = z
          .object({
            index: z.number().int().min(1).max(4),
            total: z.number().int().min(1).max(4),
            host: z.string().max(253),
            state: z.enum(["reading", "read"]),
          })
          .safeParse(raw);
        if (step.success)
          progress?.({
            stage: step.data.state,
            detail: step.data.host.replace(/^www\./, ""),
            index: step.data.index,
            total: step.data.total,
          });
      },
    );
    const output = z.object({ text: z.string() }).passthrough().parse(response);
    return ResultSchema.parse({ ...output, text: output.text.slice(0, 64_000) });
  }
}

const WorkflowListSchema = z.object({
  data: z.array(z.unknown()).default([]),
  nextCursor: z.string().nullable().optional(),
});

export class N8nClient {
  private base: string;
  constructor(
    base: string,
    private apiKey: string,
  ) {
    this.base = serviceUrl(base);
  }
  /** Bounded multi-page discovery (at most 5 × 50). */
  async workflows(signal: AbortSignal): Promise<unknown[]> {
    const collected: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const query = cursor
        ? `workflows?limit=50&cursor=${encodeURIComponent(cursor)}`
        : "workflows?limit=50";
      const parsed = WorkflowListSchema.parse(await this.get(query, signal));
      collected.push(...parsed.data);
      if (!parsed.nextCursor) break;
      cursor = parsed.nextCursor;
    }
    return collected;
  }
  execution(id: string, signal: AbortSignal): Promise<unknown> {
    if (!/^\d{1,30}$/.test(id)) throw new CoreError("INVALID_EXECUTION_ID", 400);
    return this.get(`executions/${id}?includeData=false`, signal);
  }
  /** Bounded outbound status poll; never starts or stops workflows. */
  async waitExecution(
    id: string,
    options: { intervalMs?: number; maxAttempts?: number; signal: AbortSignal },
  ): Promise<unknown> {
    const intervalMs = options.intervalMs ?? 2000;
    const maxAttempts = options.maxAttempts ?? 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const execution = (await this.execution(id, options.signal)) as {
        finished?: boolean;
        status?: string;
      };
      if (
        execution.finished ||
        ["success", "error", "crashed", "canceled"].includes(execution.status ?? "")
      )
        return execution;
      await delay(intervalMs, undefined, { signal: options.signal });
    }
    throw new CoreError("N8N_EXECUTION_TIMEOUT", 504);
  }
  stop(): Promise<never> {
    return Promise.reject(new CoreError("UNSUPPORTED_N8N_PUBLIC_API_STOP"));
  }
  private get(path: string, signal: AbortSignal): Promise<unknown> {
    return jsonRequest(
      `${this.base}/api/v1/${path}`,
      { headers: { "X-N8N-API-KEY": this.apiKey } },
      signal,
    );
  }
}

export class WorkflowExecutor implements Executor {
  readonly id = "n8n";
  readonly capability = "workflow.invoke";
  readonly external = true;
  readonly retrySafe = false;
  // External automation side effects: always exact per-action approval.
  readonly riskFloor = "HIGH" as const;
  constructor(
    private workflows: Readonly<Record<string, { url: string; token: string; version: string }>>,
  ) {
    for (const workflow of Object.values(workflows)) serviceUrl(workflow.url);
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const input = WorkflowInputSchema.parse(task.spec.input);
    // Own-property lookup: "__proto__"/"constructor" must not resolve to Object internals.
    const workflow = Object.hasOwn(this.workflows, input.workflow)
      ? this.workflows[input.workflow]
      : undefined;
    if (!workflow) throw new ProviderFailure("policy-denied", false, false);
    // Registered workflow MUST implement deduplication by taskId; Core itself never retries.
    return ResultSchema.parse(
      await jsonRequest(
        workflow.url,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${workflow.token}`,
            "content-type": "application/json",
            "x-jarvis-idempotency-key": task.id,
          },
          body: JSON.stringify({
            protocolVersion: 1,
            taskId: task.id,
            correlationId: task.correlation_id,
            workflowVersion: workflow.version,
            payload: input.payload,
          }),
        },
        signal,
      ),
    );
  }
}
