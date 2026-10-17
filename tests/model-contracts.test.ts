import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/contracts.js";
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
