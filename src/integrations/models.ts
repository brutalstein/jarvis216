import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type ThinkingLevel } from "@google/genai";
import { Codex, type CodexOptions, type RunResult, type Thread } from "@openai/codex-sdk";
import type { ExecutionResult, Executor, Task } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";
import { networkCode, neverDispatched } from "./http.js";

export async function classify<T>(fn: () => Promise<T>): Promise<T> {
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
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";
// Models that accept server-side refusal fallbacks ("default" routes by refusal category).
const refusalFallbackModels = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
export const supportsRefusalFallback = (model: string) => refusalFallbackModels.has(model);

export class ClaudeExecutor implements Executor {
  readonly id: string;
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = true;
  readonly outputTokenLimitEnforced = true;
  private client: Anthropic;
  constructor(
    key: string,
    private model: string,
    client?: Anthropic,
    // Realtime turns use their own id at low effort, so thinking cannot eat the reply budget.
    private options: { id?: string; effort?: ClaudeEffort; refusalFallback?: boolean } = {},
  ) {
    this.id = options.id ?? "claude";
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
    const { objective, cachePrefix } = task.spec;
    // The prompt's stable leading part is a cache breakpoint; only the turn part is new.
    const content: string | Anthropic.TextBlockParam[] =
      cachePrefix && cachePrefix < objective.length
        ? [
            {
              type: "text",
              text: objective.slice(0, cachePrefix),
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: objective.slice(cachePrefix) },
          ]
        : objective;
    const params = {
      model: this.model,
      messages: [{ role: "user" as const, content }],
      max_tokens: task.spec.budget.maxOutputTokens,
      ...(this.options.effort ? { output_config: { effort: this.options.effort } } : {}),
    };
    // A declined request is re-run on Anthropic's fallback model inside the same call; the
    // served model is recorded in the source, so the record never hides the switch.
    const result = await classify<Anthropic.Message | Anthropic.Beta.BetaMessage>(() =>
      this.options.refusalFallback && supportsRefusalFallback(this.model)
        ? this.client.beta.messages.create(
            { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
            { signal },
          )
        : this.client.messages.create(params, { signal }),
    );
    switch (result.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        break;
      // Truncated: another provider with room may still answer.
      case "max_tokens":
      case "model_context_window_exceeded":
        throw new ProviderFailure("invalid-response", true);
      // A safety decline is final: shopping it to other providers would launder it.
      case "refusal":
        throw new ProviderFailure("policy-denied", false);
      default:
        throw new ProviderFailure("invalid-response", false);
    }
    const blocks: readonly { type: string; text?: unknown }[] = result.content;
    const text = blocks
      .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("\n");
    if (!text.trim()) throw new ProviderFailure("invalid-response", true);
    return {
      text,
      source: `claude:${result.model}:model-output`,
      externalId: result.id,
      usage: {
        // Cached and cache-writing input still counts toward the operator's token budget.
        inputTokens:
          result.usage.input_tokens +
          (result.usage.cache_creation_input_tokens ?? 0) +
          (result.usage.cache_read_input_tokens ?? 0),
        outputTokens: result.usage.output_tokens,
      },
    };
  }
}
export class GeminiExecutor implements Executor {
  readonly id: string;
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = true;
  private client: GoogleGenAI;
  constructor(
    key: string,
    private model: string,
    client?: GoogleGenAI,
    // Realtime turns use their own id with minimal thinking, so thinking cannot eat the budget.
    private options: { id?: string; thinkingLevel?: ThinkingLevel } = {},
  ) {
    this.id = options.id ?? "gemini";
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
        config: {
          maxOutputTokens: task.spec.budget.maxOutputTokens,
          abortSignal: signal,
          ...(task.spec.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
          ...(this.options.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel } }
            : {}),
        },
      }),
    );
    // A truncated or blocked reply says nothing about other providers: allow fallback.
    if (result.candidates?.[0]?.finishReason !== "STOP" || !result.text?.trim())
      throw new ProviderFailure("invalid-response", true);
    const usage = result.usageMetadata;
    return {
      text: result.text ?? "",
      source: `gemini:${this.model}:model-output`,
      ...(usage?.promptTokenCount !== undefined && {
        usage: {
          inputTokens: usage.promptTokenCount,
          // Thinking tokens are billed output too.
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
      }),
    };
  }
}

// Optional semantic recall for the brain (BRAIN_EMBEDDINGS=gemini). Utterances already reach
// Gemini under personal consent; this sends the same text for an embedding.
export function geminiEmbedder(
  key: string,
  model: string,
  client?: GoogleGenAI,
): (texts: string[], signal: AbortSignal) => Promise<number[][]> {
  const ai =
    client ??
    new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        baseUrl: "https://generativelanguage.googleapis.com",
        retryOptions: { attempts: 1 },
      },
    });
  return async (texts, signal) => {
    const response = await ai.models.embedContent({
      model,
      contents: texts,
      config: { abortSignal: signal, taskType: "SEMANTIC_SIMILARITY", outputDimensionality: 256 },
    });
    return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
  };
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

const conversationalItems = new Set(["agent_message", "reasoning", "todo_list", "error"]);
async function conversationTurn(
  thread: Thread,
  task: Task,
  signal: AbortSignal,
): Promise<RunResult> {
  const abort = new AbortController();
  const result: RunResult = { items: [], finalResponse: "", usage: null };
  try {
    const { events } = await thread.runStreamed(task.spec.objective, {
      signal: AbortSignal.any([signal, abort.signal]),
    });
    for await (const event of events) {
      if (event.type === "error" || event.type === "turn.failed")
        throw new ProviderFailure("invalid-response", false);
      if (
        event.type === "item.started" ||
        event.type === "item.completed" ||
        event.type === "item.updated"
      ) {
        if (!conversationalItems.has(event.item.type))
          throw new ProviderFailure("invalid-response", false);
        if (event.type === "item.completed") {
          result.items.push(event.item);
          if (event.item.type === "agent_message") result.finalResponse = event.item.text;
          if (event.item.type === "error")
            console.info(
              JSON.stringify({
                event: "codex.runtime_notice",
                taskId: task.id,
                kind: /reconnect|retry|stream|connection/i.test(event.item.message)
                  ? "connection-retry"
                  : /401|403|auth/i.test(event.item.message)
                    ? "authentication"
                    : "runtime-notice",
              }),
            );
        }
      }
      if (event.type === "turn.completed") result.usage = event.usage;
    }
    return result;
  } finally {
    abort.abort();
  }
}

// Read-only sandbox is not a host-read boundary on native Windows. Use an isolated
// CODEX_HOME, explicit operator attestation and per-run HIGH approval.
export class CodexExecutor implements Executor {
  readonly outputTokenLimitEnforced = false;
  readonly id: string;
  readonly capability = "text.generate";
  readonly external = true;
  // The conversation profile runs with every tool disabled, so a rerun has nothing to repeat.
  readonly retrySafe: boolean;
  readonly riskFloor: "LOW" | "HIGH";
  private client: Codex;
  constructor(
    auth: CodexAuth,
    private model: string,
    private workspace: string,
    codexHome: string,
    private options: { conversation?: boolean } = {},
  ) {
    this.id = options.conversation ? "codex-live" : "codex";
    this.riskFloor = options.conversation ? "LOW" : "HIGH";
    this.retrySafe = options.conversation === true;
    const base = codexOptions(auth, codexHome);
    this.client = new Codex({
      ...base,
      ...(options.conversation && {
        config: {
          features: {
            shell_tool: false,
            unified_exec: false,
            apps: false,
            plugins: false,
            remote_plugin: false,
            hooks: false,
            multi_agent: false,
            multi_agent_v2: false,
            browser_use: false,
            browser_use_external: false,
            computer_use: false,
            code_mode: false,
            code_mode_host: false,
            image_generation: false,
            view_image: false,
            skill_search: false,
            skill_mcp_dependency_install: false,
          },
          mcp_servers: {},
          project_doc_max_bytes: 0,
          skills: { bundled: { enabled: false }, include_instructions: false },
        },
        // Empty tables otherwise disappear when the SDK flattens config.
        configOverrides: ["mcp_servers={}", "plugins={}"],
      }),
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
      ...(this.options.conversation && { modelReasoningEffort: "low" as const }),
    });
    const result = this.options.conversation
      ? await conversationTurn(thread, task, signal)
      : await thread.run(task.spec.objective, { signal });
    console.info(
      JSON.stringify({
        event: "codex.turn",
        taskId: task.id,
        provider: this.id,
        itemTypes: result.items.map((item) => item.type),
        usage: result.usage,
      }),
    );
    if (
      !result.finalResponse.trim() ||
      (this.options.conversation &&
        result.items.some((item) => !conversationalItems.has(item.type)))
    )
      throw new ProviderFailure("invalid-response", false);
    return {
      text: result.finalResponse,
      source: `codex:${this.model}:model-output`,
      ...(thread.id ? { externalId: thread.id } : {}),
      ...(result.usage && {
        usage: {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        },
      }),
    };
  }
}
