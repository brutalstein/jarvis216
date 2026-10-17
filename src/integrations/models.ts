import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { Codex, type CodexOptions } from "@openai/codex-sdk";
import type { ExecutionResult, Executor, Task } from "../contracts.js";
import { ProviderFailure } from "../routing.js";
import { networkCode, neverDispatched } from "./http.js";

async function classify<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const status =
      typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (status === 429) throw new ProviderFailure("rate-limited", true);
    if (status === 401 || status === 403)
      throw new ProviderFailure("authentication-required", false);
    if (status >= 500) throw new ProviderFailure("provider-unavailable", true);
    if (error instanceof Anthropic.APIConnectionError || networkCode(error))
      throw new ProviderFailure("transient", true, !neverDispatched(error));
    throw new ProviderFailure("permanent", false);
  }
}
export class ClaudeExecutor implements Executor {
  readonly id = "claude";
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = true;
  private client: Anthropic;
  constructor(
    key: string,
    private model: string,
    client?: Anthropic,
  ) {
    this.client =
      client ??
      new Anthropic({
        apiKey: key,
        baseURL: "https://api.anthropic.com",
        maxRetries: 0,
        timeout: 60_000,
      });
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const result = await classify(() =>
      this.client.messages.create(
        {
          model: this.model,
          messages: [{ role: "user", content: task.spec.objective }],
          max_tokens: task.spec.budget.maxOutputTokens,
        },
        { signal },
      ),
    );
    if (result.stop_reason !== "end_turn") throw new ProviderFailure("invalid-response", false);
    return {
      text: result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      source: `claude:${this.model}:model-output`,
      externalId: result.id,
    };
  }
}
export class GeminiExecutor implements Executor {
  readonly id = "gemini";
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = true;
  private client: GoogleGenAI;
  constructor(
    key: string,
    private model: string,
    client?: GoogleGenAI,
  ) {
    this.client =
      client ??
      new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          baseUrl: "https://generativelanguage.googleapis.com",
          retryOptions: { attempts: 1 },
        },
      });
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const result = await classify(() =>
      this.client.models.generateContent({
        model: this.model,
        contents: task.spec.objective,
        config: { maxOutputTokens: task.spec.budget.maxOutputTokens, abortSignal: signal },
      }),
    );
    if (result.candidates?.[0]?.finishReason !== "STOP")
      throw new ProviderFailure("invalid-response", false);
    return { text: result.text ?? "", source: `gemini:${this.model}:model-output` };
  }
}

export type CodexAuth = { kind: "api-key"; key: string } | { kind: "chatgpt" };
export function codexOptions(auth: CodexAuth, codexHome: string): CodexOptions {
  return {
    ...(auth.kind === "api-key" ? { apiKey: auth.key } : {}),
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      CODEX_HOME: codexHome,
      ...(auth.kind === "api-key" ? { OPENAI_API_KEY: auth.key } : {}),
    },
  };
}

// Read-only sandbox is not a host-read boundary on native Windows. Use an isolated
// CODEX_HOME, explicit operator attestation and per-run HIGH approval.
export class CodexExecutor implements Executor {
  readonly outputTokenLimitEnforced = false;
  readonly id = "codex";
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = false;
  readonly riskFloor = "HIGH" as const;
  private client: Codex;
  constructor(
    auth: CodexAuth,
    private model: string,
    private workspace: string,
    codexHome: string,
  ) {
    this.client = new Codex(codexOptions(auth, codexHome));
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const thread = this.client.startThread({
      model: this.model,
      workingDirectory: this.workspace,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    });
    const result = await thread.run(task.spec.objective, { signal });
    return {
      text: result.finalResponse,
      source: `codex:${this.model}:model-output`,
      ...(thread.id ? { externalId: thread.id } : {}),
    };
  }
}
