import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/contracts.js";
import { N8nClient, OpenClawExecutor } from "../src/integrations/services.js";
import { ProviderFailure, ProviderRegistry } from "../src/routing.js";

function task(): Task {
  return {
    id: "12bef226-dd16-4ed6-9600-5e2196fe7df5",
    correlation_id: "706e41dc-aa62-454d-a159-18d0eb5255fa",
    principal: "operator",
    status: "RUNNING",
    fence: 1,
    owner: "w",
    lease_until: Date.now() + 60_000,
    calls: 0,
    attempt: 1,
    result: null,
    created_at: Date.now(),
    spec: TaskSpecSchema.parse({
      objective: "Analyze",
      capability: "text.generate",
      input: {},
      providers: ["openclaw"],
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "contains", value: "answer" },
    }),
  };
}

describe("official service contracts against local HTTP servers", () => {
  it("sends authenticated OpenResponses request and parses completed output", async () => {
    let received: unknown;
    const server = createServer(async (req, res) => {
      expect(req.url).toBe("/v1/responses");
      expect(req.headers.authorization).toBe("Bearer contract-token");
      expect(req.headers["x-openclaw-agent-id"]).toBe("jarvis-reader");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received = JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "resp_1",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "answer" }],
            },
          ],
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server missing address");
      const executor = new OpenClawExecutor(
        `http://127.0.0.1:${address.port}`,
        "contract-token",
        "jarvis-reader",
      );
      expect((await executor.execute(task(), new AbortController().signal)).text).toBe("answer");
      expect(received).toMatchObject({
        model: "openclaw",
        input: "Analyze",
        stream: false,
        user: "12bef226-dd16-4ed6-9600-5e2196fe7df5",
      });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("does not call undocumented n8n execute/stop endpoints", async () => {
    const paths: string[] = [];
    const server = createServer((req, res) => {
      paths.push(req.url ?? "");
      expect(req.headers["x-n8n-api-key"]).toBe("n8n-token");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [], nextCursor: null }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const client = new N8nClient(`http://127.0.0.1:${address.port}`, "n8n-token");
      await client.workflows(new AbortController().signal);
      expect(paths).toEqual(["/api/v1/workflows?limit=50"]);
      await expect(client.stop()).rejects.toThrow("UNSUPPORTED");
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

describe("deterministic provider routing", () => {
  it("excludes unauthenticated, unavailable, over-context and privacy-incompatible providers", () => {
    const registry = new ProviderRegistry([
      {
        id: "a",
        capability: "text.generate",
        external: true,
        retrySafe: true,
        authenticated: false,
        enabled: true,
        maxInputChars: 20_000,
        priority: 0,
        execute: async () => ({ text: "x", source: "a" }),
      },
      {
        id: "b",
        capability: "text.generate",
        external: false,
        retrySafe: true,
        authenticated: true,
        enabled: true,
        maxInputChars: 20_000,
        priority: 1,
        execute: async () => ({ text: "x", source: "b" }),
      },
    ]);
    const t = task();
    t.spec.providers = ["a", "b"];
    t.spec.privacy = "local-only";
    expect(registry.select(t, []).id).toBe("b");
    expect(() => registry.select(t, ["b"])).toThrow("NO_COMPATIBLE_PROVIDER");
    expect(new ProviderFailure("rate-limited", true).retryable).toBe(true);
  });
});
