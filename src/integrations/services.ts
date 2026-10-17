import { z } from "zod";
import {
  BrowserInputSchema,
  CoreError,
  type ExecutionResult,
  type Executor,
  ResultSchema,
  type Task,
  WorkflowInputSchema,
} from "../contracts.js";
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
export class OpenClawExecutor implements Executor {
  readonly id = "openclaw";
  readonly capability = "text.generate";
  readonly external = true;
  // Runtime tool restrictions must be verified by deployment. Even disconnect is uncertain.
  readonly retrySafe = false;
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
            user: task.id,
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
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const input = BrowserInputSchema.parse(task.spec.input);
    return ResultSchema.parse(
      await jsonRequest(
        `${this.base}/v1/extract`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            "x-correlation-id": task.correlation_id,
          },
          body: JSON.stringify({
            ...input,
            taskId: task.id,
            timeoutMs: Math.min(task.spec.budget.maxDurationMs, 60_000),
          }),
        },
        signal,
      ),
    );
  }
}

export class N8nClient {
  private base: string;
  constructor(
    base: string,
    private apiKey: string,
  ) {
    this.base = serviceUrl(base);
  }
  workflows(signal: AbortSignal): Promise<unknown> {
    return this.get("workflows?limit=50", signal);
  }
  execution(id: string, signal: AbortSignal): Promise<unknown> {
    if (!/^\d{1,30}$/.test(id)) throw new CoreError("INVALID_EXECUTION_ID", 400);
    return this.get(`executions/${id}?includeData=false`, signal);
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
  constructor(
    private workflows: Readonly<Record<string, { url: string; token: string; version: string }>>,
  ) {
    for (const workflow of Object.values(workflows)) serviceUrl(workflow.url);
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const input = WorkflowInputSchema.parse(task.spec.input);
    const workflow = this.workflows[input.workflow];
    if (!workflow) throw new CoreError("WORKFLOW_NOT_REGISTERED", 403);
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
