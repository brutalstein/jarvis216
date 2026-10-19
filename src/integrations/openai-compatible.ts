import { z } from "zod";
import type { ExecutionResult, Executor, Task } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";
import { jsonRequest, serviceUrl } from "./http.js";

// "vendor/model-name:free" -> "<prefix>-model-name", within the 40-character provider id limit.
export function providerId(prefix: "or" | "nv", model: string): string {
  const name = (model.split("/").pop() ?? model).split(":")[0] ?? model;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${prefix}-${slug}`.slice(0, 40).replace(/^-+|-+$/g, "");
}

const CompletionSchema = z.object({
  id: z.string().max(256).optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1),
  usage: z
    .object({ prompt_tokens: z.number().int().min(0), completion_tokens: z.number().int().min(0) })
    .nullish()
    .catch(undefined),
});

// OpenRouter and NVIDIA API catalog speak the OpenAI chat completions protocol.
export class OpenAICompatibleExecutor implements Executor {
  readonly id: string;
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = true;
  readonly outputTokenLimitEnforced = true;
  private base: string;
  constructor(
    private options: {
      id: string;
      base: string;
      key: string;
      model: string;
      timeoutMs?: number;
      extraBody?: Record<string, unknown>;
      // The endpoint honours response_format json_object (OpenRouter routes it per model).
      jsonMode?: boolean;
    },
  ) {
    this.id = options.id;
    this.base = serviceUrl(options.base);
  }
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    // Free endpoints often hang; a short per-call limit lets the task fall back in time.
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 8000);
    let body: unknown;
    try {
      body = await jsonRequest(
        `${this.base}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...this.options.extraBody,
            model: this.options.model,
            messages: [{ role: "user", content: task.spec.objective }],
            max_tokens: task.spec.budget.maxOutputTokens,
            ...(this.options.jsonMode && task.spec.responseFormat === "json"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
        },
        AbortSignal.any([signal, timeout]),
      );
    } catch (error) {
      if (error instanceof ProviderFailure || signal.aborted) throw error;
      throw new ProviderFailure(timeout.aborted ? "provider-unavailable" : "transient", true);
    }
    const parsed = CompletionSchema.safeParse(body);
    const text = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
    // Reasoning-only or truncated replies come back as 200 with no content: try the next model.
    if (!text?.trim()) throw new ProviderFailure("invalid-response", true);
    return {
      text,
      source: `${this.id}:${this.options.model}:model-output`,
      ...(parsed.data?.id ? { externalId: parsed.data.id } : {}),
      ...(parsed.data?.usage && {
        usage: {
          inputTokens: parsed.data.usage.prompt_tokens,
          outputTokens: parsed.data.usage.completion_tokens,
        },
      }),
    };
  }
}
