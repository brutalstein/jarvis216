import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { describe, expect, it } from "vitest";
import { configuredProviders } from "../src/app/config.js";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import { EnvSecrets } from "../src/core/security.js";
import { GeminiExecutor } from "../src/integrations/models.js";
import { conversationProviders } from "../src/services/conversation.js";

const task = {
  spec: TaskSpecSchema.parse({
    objective: "Jarvis, merhaba",
    capability: "text.generate",
    providers: ["gemini-live"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "non-empty" },
  }),
} as Task;

async function gemini(
  finishReason: string,
  seen: (config: unknown) => void = () => {},
  text = "{",
) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen(JSON.parse(Buffer.concat(chunks).toString()).generationConfig);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new GoogleGenAI({
    apiKey: "fixture-key-only",
    httpOptions: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      retryOptions: { attempts: 1 },
    },
  });
  const executor = new GeminiExecutor("fixture-key-only", "fixture-model", client, {
    id: "gemini-live",
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
  try {
    return await executor.execute(task, new AbortController().signal);
  } finally {
    server.close();
  }
}

describe("realtime Gemini provider", () => {
  it("asks for minimal thinking under its own id", async () => {
    let config: unknown;
    await gemini("STOP", (value) => {
      config = value;
    });
    expect(config).toMatchObject({ thinkingConfig: { thinkingLevel: "MINIMAL" } });
  });

  it("a truncated reply is retryable so the turn can fall back", async () => {
    const error = await gemini("MAX_TOKENS").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ kind: "invalid-response", retryable: true });
  });

  it("an empty reply is retryable so the turn can fall back", async () => {
    const error = await gemini("STOP", undefined, "  ").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid-response", retryable: true });
  });

  it("enabling Gemini also registers gemini-live, which leads the realtime order", async () => {
    const { registry } = await configuredProviders(
      { ENABLE_GEMINI: "true", GEMINI_MODEL: "m" },
      new EnvSecrets({ GEMINI_API_KEY: "gemini-test-key" }),
    );
    const ids = registry.list().map((p) => (p as { id: string }).id);
    expect(ids).toEqual(["gemini", "gemini-live", "guide"]);
    expect(registry.select({ spec: task.spec } as Task, []).configuration).toBe(
      "gemini-api:m:tools-none:thinking-minimal",
    );
    expect(conversationProviders([...ids, "or-a", "claude-code"])).toEqual([
      "gemini-live",
      "claude-code",
      "or-a",
    ]);
  });

  it("enabling Claude registers claude and a low-effort claude-live with a default model", async () => {
    const { registry } = await configuredProviders(
      { ENABLE_CLAUDE: "true", CLAUDE_MODEL: "" },
      new EnvSecrets({ ANTHROPIC_API_KEY: "anthropic-test-key" }),
    );
    const listed = registry.list() as { id: string }[];
    expect(listed.map((p) => p.id)).toEqual(["claude", "claude-live", "guide"]);
    const live = registry.select(
      { spec: { ...task.spec, providers: ["claude-live"] } } as Task,
      [],
    );
    expect(live.configuration).toBe(
      "claude-api:claude-opus-5-5:tools-none:effort-low:refusal-fallback",
    );
    expect(conversationProviders(listed.map((p) => p.id))).toEqual(["claude-live"]);
    await expect(
      configuredProviders(
        { ENABLE_CLAUDE: "true", CLAUDE_EFFORT: "extreme" },
        new EnvSecrets({ ANTHROPIC_API_KEY: "anthropic-test-key" }),
      ),
    ).rejects.toThrow();
    const opted = await configuredProviders(
      {
        ENABLE_CLAUDE: "true",
        CLAUDE_MODEL: "claude-sonnet-5-5",
        CLAUDE_EFFORT: "high",
        CLAUDE_REFUSAL_FALLBACK: "false",
      },
      new EnvSecrets({ ANTHROPIC_API_KEY: "anthropic-test-key" }),
    );
    expect(
      opted.registry.select({ spec: { ...task.spec, providers: ["claude"] } } as Task, [])
        .configuration,
    ).toBe("claude-api:claude-sonnet-5-5:tools-none:effort-high:single");
  });
});
