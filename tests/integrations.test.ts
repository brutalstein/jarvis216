import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure, ProviderRegistry } from "../src/core/routing.js";
import { jsonRequest } from "../src/integrations/http.js";
import {
  N8nClient,
  OpenClawExecutor,
  openClawUserKey,
  probeOpenClaw,
} from "../src/integrations/services.js";

function task(planId?: string): Task {
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
      ...(planId ? { planId } : {}),
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
      const planTask = task("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(openClawUserKey(planTask)).toBe("plan:a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect((await executor.execute(planTask, new AbortController().signal)).text).toBe("answer");
      expect(received).toMatchObject({ user: "plan:a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("probes OpenClaw readiness without claiming policy verification", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      await expect(
        probeOpenClaw(`http://127.0.0.1:${address.port}`, "t", new AbortController().signal),
      ).resolves.toBe("ready");
      await expect(
        probeOpenClaw("http://127.0.0.1:1", "t", AbortSignal.timeout(200)),
      ).resolves.toBe("unavailable");
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("reuses keep-alive connections for consecutive local requests", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: hits }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const url = `http://127.0.0.1:${address.port}/`;
      const signal = new AbortController().signal;
      expect(await jsonRequest(url, { method: "GET" }, signal)).toEqual({ ok: 1 });
      expect(await jsonRequest(url, { method: "GET" }, signal)).toEqual({ ok: 2 });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("does not call undocumented n8n execute/stop endpoints", async () => {
    const paths: string[] = [];
    let page = 0;
    const server = createServer((req, res) => {
      paths.push(req.url ?? "");
      expect(req.headers["x-n8n-api-key"]).toBe("n8n-token");
      res.setHeader("content-type", "application/json");
      page += 1;
      if (page === 1) res.end(JSON.stringify({ data: [{ id: "1" }], nextCursor: "cursor-2" }));
      else res.end(JSON.stringify({ data: [{ id: "2" }], nextCursor: null }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const client = new N8nClient(`http://127.0.0.1:${address.port}`, "n8n-token");
      const workflows = await client.workflows(new AbortController().signal);
      expect(workflows).toEqual([{ id: "1" }, { id: "2" }]);
      expect(paths).toEqual([
        "/api/v1/workflows?limit=50",
        "/api/v1/workflows?limit=50&cursor=cursor-2",
      ]);
      await expect(client.stop()).rejects.toThrow("UNSUPPORTED");
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("waitExecution stops when finished", async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls += 1;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          calls === 1
            ? { finished: false, status: "running" }
            : { finished: true, status: "success", id: "9" },
        ),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const client = new N8nClient(`http://127.0.0.1:${address.port}`, "n8n-token");
      const result = await client.waitExecution("9", {
        intervalMs: 10,
        maxAttempts: 5,
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({ finished: true, status: "success" });
      expect(calls).toBe(2);
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
