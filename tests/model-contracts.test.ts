import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import { ClaudeExecutor, GeminiExecutor } from "../src/integrations/models.js";

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}
function task(provider: string): Task {
  return {
    id: "cdad17bd-0bf0-4609-bddb-e5c2f6285015",
    correlation_id: "df115bb0-e318-437a-9913-89fb752eb441",
    principal: "operator",
    status: "RUNNING",
    fence: 1,
    owner: "w",
    lease_until: Date.now() + 10_000,
    calls: 0,
    attempt: 1,
    result: null,
    created_at: Date.now(),
    spec: TaskSpecSchema.parse({
      objective: "Return verified",
      capability: "text.generate",
      providers: [provider],
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "contains", value: "verified" },
    }),
  };
}
it("Claude official SDK sends text-only bounded Messages requests", async () => {
  const server = createServer(async (req, res) => {
    expect(req.url).toBe("/v1/messages");
    expect(req.headers["x-api-key"]).toBe("fixture-key-only");
    const payload = await body(req);
    expect(payload.max_tokens).toBe(1024);
    expect(payload.tools).toBeUndefined();
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "fixture-model",
        content: [{ type: "text", text: "verified" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const client = new Anthropic({
      apiKey: "fixture-key-only",
      baseURL: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
    });
    expect(
      (
        await new ClaudeExecutor("fixture-key-only", "fixture-model", client).execute(
          task("claude"),
          new AbortController().signal,
        )
      ).text,
    ).toBe("verified");
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("Gemini official SDK sends bounded text-only generation requests", async () => {
  const server = createServer(async (req, res) => {
    expect(req.url).toContain("/models/fixture-model:generateContent");
    const payload = await body(req);
    expect(payload.tools).toBeUndefined();
    expect(payload.generationConfig).toMatchObject({ maxOutputTokens: 1024 });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        candidates: [
          { content: { role: "model", parts: [{ text: "verified" }] }, finishReason: "STOP" },
        ],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const client = new GoogleGenAI({
      apiKey: "fixture-key-only",
      httpOptions: { baseUrl: `http://127.0.0.1:${address.port}`, retryOptions: { attempts: 1 } },
    });
    expect(
      (
        await new GeminiExecutor("fixture-key-only", "fixture-model", client).execute(
          task("gemini"),
          new AbortController().signal,
        )
      ).text,
    ).toBe("verified");
  } finally {
    server.close();
    await once(server, "close");
  }
});

// One fixture Messages endpoint per test: records requests, answers with `message`.
async function claudeFixture(message: Record<string, unknown>) {
  const seen: { url: string; beta: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    seen.push({
      url: req.url ?? "",
      beta: String(req.headers["anthropic-beta"] ?? ""),
      body: await body(req),
    });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "fixture-model",
        content: [{ type: "text", text: "verified" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 1 },
        ...message,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const client = new Anthropic({
    apiKey: "fixture-key-only",
    baseURL: `http://127.0.0.1:${address.port}`,
    maxRetries: 0,
  });
  return {
    seen,
    client,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
async function claudeFailure(stopReason: string) {
  const fixture = await claudeFixture({ stop_reason: stopReason });
  try {
    await new ClaudeExecutor("k", "fixture-model", fixture.client).execute(
      task("claude"),
      new AbortController().signal,
    );
    throw new Error("expected failure");
  } catch (error) {
    if (!(error instanceof ProviderFailure)) throw error;
    return { kind: error.kind, retryable: error.retryable };
  } finally {
    await fixture.close();
  }
}

describe("Claude adapter", () => {
  it("sends effort and server-side refusal fallback, and records the model that served", async () => {
    const fixture = await claudeFixture({ model: "claude-opus-4-8" });
    try {
      const result = await new ClaudeExecutor("k", "claude-opus-5-5", fixture.client, {
        id: "claude-live",
        effort: "low",
        refusalFallback: true,
      }).execute(task("claude-live"), new AbortController().signal);
      expect(result.source).toBe("claude:claude-opus-4-8:model-output");
    } finally {
      await fixture.close();
    }
    const [request] = fixture.seen;
    expect(request?.url).toContain("/v1/messages");
    expect(request?.beta).toContain("server-side-fallback-2026-07-01");
    expect(request?.body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      output_config: { effort: "low" },
    });
    expect(request?.body.tools).toBeUndefined();
  });

  it("never sends refusal fallbacks to models that do not accept them", async () => {
    const fixture = await claudeFixture({});
    try {
      await new ClaudeExecutor("k", "claude-haiku-5-5", fixture.client, {
        refusalFallback: true,
      }).execute(task("claude"), new AbortController().signal);
    } finally {
      await fixture.close();
    }
    expect(fixture.seen[0]?.beta).toBe("");
    expect(fixture.seen[0]?.body).not.toHaveProperty("fallbacks");
    expect(fixture.seen[0]?.body).not.toHaveProperty("output_config");
  });

  it("marks the prompt's stable prefix as a cache breakpoint and counts cached input", async () => {
    const fixture = await claudeFixture({
      usage: {
        input_tokens: 40,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 900,
      },
    });
    const cached = task("claude-live");
    cached.spec = { ...cached.spec, objective: "STABLE PART\n\nturn part", cachePrefix: 13 };
    try {
      const result = await new ClaudeExecutor("k", "claude-opus-5-5", fixture.client).execute(
        cached,
        new AbortController().signal,
      );
      expect(result.usage).toEqual({ inputTokens: 940, outputTokens: 5 });
      // Without a prefix the prompt stays one plain string.
      await new ClaudeExecutor("k", "claude-opus-5-5", fixture.client).execute(
        task("claude"),
        new AbortController().signal,
      );
    } finally {
      await fixture.close();
    }
    expect(fixture.seen[0]?.body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "STABLE PART\n\n", cache_control: { type: "ephemeral" } },
          { type: "text", text: "turn part" },
        ],
      },
    ]);
    expect(fixture.seen[1]?.body.messages).toEqual([{ role: "user", content: "Return verified" }]);
  });

  it("maps stop reasons: truncation may fall back, a refusal is final", async () => {
    expect(await claudeFailure("max_tokens")).toEqual({
      kind: "invalid-response",
      retryable: true,
    });
    expect(await claudeFailure("model_context_window_exceeded")).toEqual({
      kind: "invalid-response",
      retryable: true,
    });
    expect(await claudeFailure("refusal")).toEqual({ kind: "policy-denied", retryable: false });
    expect(await claudeFailure("pause_turn")).toEqual({
      kind: "invalid-response",
      retryable: false,
    });
  });
});

it("Gemini uses its JSON mime type only for JSON tasks", async () => {
  const configs: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    configs.push((await body(req)).generationConfig as Record<string, unknown>);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        candidates: [
          { content: { role: "model", parts: [{ text: '{"say":"x"}' }] }, finishReason: "STOP" },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const client = new GoogleGenAI({
      apiKey: "fixture-key-only",
      httpOptions: { baseUrl: `http://127.0.0.1:${address.port}`, retryOptions: { attempts: 1 } },
    });
    const executor = new GeminiExecutor("fixture-key-only", "fixture-model", client);
    const plain = task("gemini");
    await executor.execute(
      { ...plain, spec: { ...plain.spec, responseFormat: "json" } },
      new AbortController().signal,
    );
    await executor.execute(plain, new AbortController().signal);
  } finally {
    server.close();
    await once(server, "close");
  }
  expect(configs[0]?.responseMimeType).toBe("application/json");
  expect(configs[1]).not.toHaveProperty("responseMimeType");
});
