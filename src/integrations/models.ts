import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { Codex } from "@openai/codex-sdk";
import type { ExecutionResult, Executor, Task } from "../contracts.js";
import { ProviderFailure } from "../routing.js";

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
  ) {
    this.client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 60_000 });
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
  ) {
    this.client = new GoogleGenAI({ apiKey: key, httpOptions: { retryOptions: { attempts: 1 } } });
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

// Opt-in only inside an operator-provisioned container/VM. Read-only sandbox alone is
// insufficient to prevent host data reads. Never point this at the operator's CODEX_HOME.
export class CodexExecutor implements Executor {
  readonly id = "codex";
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = false;
  private client: Codex;
  constructor(
    key: string,
    private model: string,
    private workspace: string,
    codexHome: string,
  ) {
    this.client = new Codex({
      apiKey: key,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        CODEX_HOME: codexHome,
        OPENAI_API_KEY: key,
      },
    });
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
