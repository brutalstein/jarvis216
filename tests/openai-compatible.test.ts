import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { configuredProviders } from "../src/app/config.js";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import { EnvSecrets } from "../src/core/security.js";
import { OpenAICompatibleExecutor, providerId } from "../src/integrations/openai-compatible.js";

const task = {
  spec: TaskSpecSchema.parse({
    objective: "Jarvis, merhaba",
    capability: "text.generate",
    providers: ["or-x"],
    budget: { maxOutputTokens: 300 },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "non-empty" },
  }),
} as Task;

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    handler(req, res, Buffer.concat(chunks).toString());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}
const reply = (status: number, body: unknown) => (_: unknown, res: ServerResponse) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};
const completion = (content: string | null) => ({
  id: "r1",
  choices: [{ message: { content }, finish_reason: "stop" }],
});
async function failure(handler: Parameters<typeof serve>[0], timeoutMs?: number) {
  const server = await serve(handler);
  try {
    await new OpenAICompatibleExecutor({
      id: "or-x",
      base: server.base,
      key: "k",
      model: "m",
      ...(timeoutMs ? { timeoutMs } : {}),
    }).execute(task, new AbortController().signal);
    throw new Error("expected failure");
  } catch (error) {
    if (!(error instanceof ProviderFailure)) throw error;
    return { kind: error.kind, retryable: error.retryable };
  } finally {
    server.close();
  }
}

describe("OpenAI-compatible free-model executor", () => {
  it("providerId slugs", () => {
    expect(providerId("or", "dots-studio/dots-3-note-preview:free")).toBe("or-dots-3-note-preview");
    expect(providerId("nv", "openai/gpt-oss-20b")).toBe("nv-gpt-oss-20b");
    const long = providerId("or", "vendor/a-really-long-model-name-that-keeps-going-on:free");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(long.endsWith("-")).toBe(false);
  });

  it("posts an authenticated chat completion and returns the content", async () => {
    const server = await serve((req, res, body) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/chat/completions");
      expect(req.headers.authorization).toBe("Bearer k");
      const sent = JSON.parse(body);
      expect(sent.model).toBe("vendor/model");
      expect(sent.messages[0].content).toBe("Jarvis, merhaba");
      expect(sent.max_tokens).toBe(300);
      expect(sent.reasoning).toEqual({ effort: "low", exclude: true });
      reply(200, completion("Merhaba"))(req, res);
    });
    try {
      const result = await new OpenAICompatibleExecutor({
        id: "or-x",
        base: server.base,
        key: "k",
        model: "vendor/model",
        extraBody: { reasoning: { effort: "low", exclude: true } },
      }).execute(task, new AbortController().signal);
      expect(result).toEqual({
        text: "Merhaba",
        source: "or-x:vendor/model:model-output",
        externalId: "r1",
      });
    } finally {
      server.close();
    }
  });

  it("classifies failures", async () => {
    expect(await failure(reply(429, {}))).toEqual({ kind: "rate-limited", retryable: true });
    expect(await failure(reply(404, {}))).toEqual({ kind: "permanent", retryable: false });
    expect(await failure(reply(503, {}))).toEqual({
      kind: "provider-unavailable",
      retryable: true,
    });
    expect(await failure(reply(200, completion("")))).toEqual({
      kind: "invalid-response",
      retryable: true,
    });
    expect(await failure(reply(200, completion(null)))).toEqual({
      kind: "invalid-response",
      retryable: true,
    });
    expect(await failure(() => {}, 100)).toEqual({
      kind: "provider-unavailable",
      retryable: true,
    });
  });

  it("configuration registers one provider per model", async () => {
    const { registry } = await configuredProviders(
      { ENABLE_OPENROUTER: "true", OPENROUTER_MODELS: "a/b:free, c/d:free" },
      new EnvSecrets({ OPENROUTER_API_KEY: "openrouter-test-key" }),
    );
    expect(registry.list().map((p) => (p as { id: string }).id)).toEqual(["or-b", "or-d"]);
    await expect(
      configuredProviders(
        { ENABLE_NVIDIA: "true", NVIDIA_MODELS: "openai/gpt-oss-20b" },
        new EnvSecrets({}),
      ),
    ).rejects.toThrow();
  });
});

describe("JSON response mode", () => {
  const jsonTask = { spec: { ...task.spec, responseFormat: "json" } } as Task;
  it("asks a json-capable endpoint for one JSON object only when the task wants JSON", async () => {
    const bodies: Record<string, unknown>[] = [];
    const server = await serve((req, res, body) => {
      bodies.push(JSON.parse(body));
      reply(200, completion('{"say":"tamam"}'))(req, res);
    });
    try {
      const executor = (jsonMode: boolean) =>
        new OpenAICompatibleExecutor({
          id: "or-x",
          base: server.base,
          key: "k",
          model: "m",
          jsonMode,
        });
      await executor(true).execute(jsonTask, new AbortController().signal);
      await executor(true).execute(task, new AbortController().signal);
      await executor(false).execute(jsonTask, new AbortController().signal);
    } finally {
      server.close();
    }
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
    expect(bodies[1]).not.toHaveProperty("response_format");
    expect(bodies[2]).not.toHaveProperty("response_format");
  });
});
