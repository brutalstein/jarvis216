import { once } from "node:events";
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { GoogleGenAI } from "@google/genai";
import { expect, it } from "vitest";
import type { Executor } from "../src/core/contracts.js";
import { type Database, migrate } from "../src/core/database.js";
import { ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { buildServer } from "../src/http/server.js";
import { ClaudeExecutor, GeminiExecutor } from "../src/integrations/models.js";
import { OpenClawExecutor } from "../src/integrations/services.js";

it("local contract E2E: n8n-scoped ingress, OpenClaw request, operator approval and result consumption", async () => {
  let calls = 0;
  const fixture = createServer((req, res) => {
    expect(req.url).toBe("/v1/responses");
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "resp_contract_e2e",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "JARVIS_OK" }],
          },
        ],
      }),
    );
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const pg = new PGlite();
  const db: Database = {
    query: (s, p) => pg.query(s, p as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  await migrate(db);
  const tasks = new TaskService(db);
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("address");
  const executor = new OpenClawExecutor(
    `http://127.0.0.1:${address.port}`,
    "fixture-token",
    "jarvis-reader",
  );
  const registry = new ProviderRegistry([
    {
      id: executor.id,
      capability: executor.capability,
      external: true,
      retrySafe: false,
      enabled: true,
      authenticated: true,
      priority: 1,
      maxInputChars: 20_000,
      execute: executor.execute.bind(executor),
    },
  ]);
  const worker = new Worker(tasks, registry);
  const operatorToken = "operator-fixture-32-characters-minimum";
  const webhookToken = "webhook-fixture-32-characters-minimum";
  const app = buildServer(tasks, registry, {
    operatorToken,
    webhookToken,
    onCancel: (id) => worker.cancel(id),
  });
  try {
    const request = {
      method: "POST" as const,
      url: "/v1/hooks/n8n",
      headers: { authorization: `Bearer ${webhookToken}` },
      payload: {
        eventId: "e2e-event",
        sentAt: new Date().toISOString(),
        objective: "Return exactly JARVIS_OK",
        verificationText: "JARVIS_OK",
      },
    };
    const accepted = await app.inject(request);
    expect(accepted.statusCode).toBe(202);
    const id: string = accepted.json().id;
    await worker.once();
    expect((await tasks.get(id)).status).toBe("WAITING_FOR_APPROVAL");
    expect(calls).toBe(0);
    const [action] = await tasks.actions(id);
    if (!action) throw new Error("No proposed action");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/actions/${action.id}/approve`,
          headers: { authorization: `Bearer ${webhookToken}` },
          payload: { expiresAt: new Date(Date.now() + 30_000).toISOString() },
        })
      ).statusCode,
    ).toBe(401);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/actions/${action.id}/approve`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { expiresAt: new Date(Date.now() + 30_000).toISOString() },
    });
    expect(approved.statusCode).toBe(204);
    await worker.once();
    const consumed = await app.inject({
      url: `/v1/hooks/n8n/tasks/${id}`,
      headers: { authorization: `Bearer ${webhookToken}` },
    });
    expect(consumed.json()).toMatchObject({
      status: "COMPLETED",
      result: { text: "JARVIS_OK", externalId: "resp_contract_e2e" },
    });
    expect((await app.inject(request)).json().id).toBe(id);
    expect(calls).toBe(1);
    const metrics = await app.inject({
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(Number(metrics.json().usage.reserved_calls)).toBe(1);
  } finally {
    await app.close();
    await db.close();
    fixture.close();
    await once(fixture, "close");
  }
});

it("local contract E2E: user task, deterministic routing, provider outage, permitted fallback, verified completion", async () => {
  const hits: string[] = [];
  const fixture = createServer(async (req, res) => {
    for await (const _ of req);
    hits.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/messages") {
      res.statusCode = 529;
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }));
      return;
    }
    res.end(
      JSON.stringify({
        candidates: [
          { content: { role: "model", parts: [{ text: "verified plan" }] }, finishReason: "STOP" },
        ],
      }),
    );
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const pg = new PGlite();
  const db: Database = {
    query: (s, p) => pg.query(s, p as unknown[]),
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p as unknown[]) })),
    close: () => pg.close(),
  };
  try {
    const address = fixture.address();
    if (!address || typeof address === "string") throw new Error("address");
    const base = `http://127.0.0.1:${address.port}`;
    await migrate(db);
    const tasks = new TaskService(db);
    const provider = (executor: Executor, priority: number) => ({
      id: executor.id,
      capability: executor.capability,
      external: executor.external,
      retrySafe: executor.retrySafe,
      enabled: true,
      authenticated: true,
      priority,
      maxInputChars: 20_000,
      execute: executor.execute.bind(executor),
    });
    const registry = new ProviderRegistry([
      provider(
        new GeminiExecutor(
          "fixture-key",
          "fixture-model",
          new GoogleGenAI({
            apiKey: "fixture-key",
            httpOptions: { baseUrl: base, retryOptions: { attempts: 1 } },
          }),
        ),
        20,
      ),
      provider(
        new ClaudeExecutor(
          "fixture-key",
          "fixture-model",
          new Anthropic({ apiKey: "fixture-key", baseURL: base, maxRetries: 0 }),
        ),
        10,
      ),
    ]);
    const worker = new Worker(tasks, registry);
    const task = await tasks.create(
      {
        objective: "Propose a plan",
        capability: "text.generate",
        providers: ["claude", "gemini"],
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: "verified" },
      },
      "fallback-e2e",
      "operator",
    );
    await worker.once();
    expect((await tasks.get(task.id)).status).toBe("READY");
    await db.query("UPDATE tasks SET not_before=0 WHERE id=$1", [task.id]);
    await worker.once();
    const final = await tasks.get(task.id);
    expect(final).toMatchObject({ status: "COMPLETED", calls: 2 });
    expect(final.result?.source).toBe("gemini:fixture-model:model-output");
    expect(hits).toEqual(["/v1/messages", expect.stringContaining(":generateContent")]);
    const events = (await tasks.events(task.id)) as {
      envelope: { type: string; payload: Record<string, unknown> };
    }[];
    expect(
      events
        .filter((e) => e.envelope.type === "provider.selected")
        .map((e) => e.envelope.payload.provider),
    ).toEqual(["claude", "gemini"]);
    expect(
      events.find((e) => e.envelope.type === "execution.failed")?.envelope.payload,
    ).toMatchObject({
      kind: "provider-unavailable",
      retryEligible: true,
    });
    expect((await tasks.actions(task.id)).map((a) => a.status).sort()).toEqual([
      "FAILED",
      "SUCCEEDED",
    ]);
  } finally {
    await db.close();
    fixture.close();
    await once(fixture, "close");
  }
});
