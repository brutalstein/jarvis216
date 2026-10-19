import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/contracts.js";
import { BrowserExecutor } from "../src/integrations/services.js";

// Shared with workers/browser/test_worker.py: both sides must accept the same wire shapes.
const contract = JSON.parse(
  await readFile(new URL("./fixtures/browser-extract.json", import.meta.url), "utf8"),
);

it("sends the exact request shape the Python worker accepts and parses its response", async () => {
  let received: Record<string, unknown> = {};
  let headers: Record<string, unknown> = {};
  let large = false;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received = JSON.parse(Buffer.concat(chunks).toString());
    headers = req.headers;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        large
          ? { ...contract.response, text: `${contract.request.expectedText}${"x".repeat(120_000)}` }
          : contract.response,
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const { url, expectedText, taskId } = contract.request;
    const task: Task = {
      id: taskId,
      correlation_id: "8d0c7c39-8f1e-4a0c-9d55-61a3c0f1a6b4",
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
        objective: "Read the public page",
        capability: "browser.extract",
        input: { url, expectedText },
        providers: ["browser-use"],
        budget: { maxDurationMs: contract.request.timeoutMs },
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: expectedText },
      }),
    };
    const result = await new BrowserExecutor(
      `http://127.0.0.1:${address.port}`,
      "worker-token-with-at-least-32-chars",
    ).execute(task, new AbortController().signal);
    expect(received).toEqual(contract.request);
    expect(headers.authorization).toBe("Bearer worker-token-with-at-least-32-chars");
    expect(result).toEqual(contract.response);
    large = true;
    const bounded = await new BrowserExecutor(
      `http://127.0.0.1:${address.port}`,
      "worker-token-with-at-least-32-chars",
    ).execute(task, new AbortController().signal);
    expect(bounded.text).toHaveLength(64_000);
    expect(bounded.text).toContain(expectedText);
  } finally {
    server.close();
    await once(server, "close");
  }
});

it("streams which page the worker is reading, then the result; errors stay in-band", async () => {
  let fail = false;
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    expect(req.headers.accept).toContain("application/x-ndjson");
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
    line({ progress: { index: 1, total: 2, host: "www.reuters.com", state: "reading" } });
    line({ progress: { index: 1, total: 2, host: "www.reuters.com", state: "read" } });
    line({ progress: { index: 2, total: 2, host: "bbc.com", state: "reading", extra: "x" } });
    line({ progress: { index: 9, host: "bad" } });
    if (fail) line({ error: "REQUEST_OR_VERIFICATION_FAILED", status: 400 });
    else
      line({
        result: {
          text: "Reuters\n\n---\n\nBBC",
          source: "browser-use:dom-readback",
          externalId: "e",
        },
      });
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const pages = [
      { url: "https://www.reuters.com/", expectedText: "Reuters" },
      { url: "https://bbc.com/", expectedText: "BBC" },
    ];
    const task = {
      id: "0b8a3c0e-55a4-4e44-9a46-0f9a3d0ad1f1",
      correlation_id: "8d0c7c39-8f1e-4a0c-9d55-61a3c0f1a6b4",
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
        objective: "Read 2 pages",
        capability: "browser.extract",
        input: { pages },
        providers: ["browser-use"],
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "contains", value: "Reuters" },
      }),
    } satisfies Task;
    const seen: unknown[] = [];
    const executor = new BrowserExecutor(
      `http://127.0.0.1:${address.port}`,
      "worker-token-with-at-least-32-chars",
    );
    const result = await executor.execute(task, new AbortController().signal, (update) =>
      seen.push(update),
    );
    expect(result.text).toContain("BBC");
    expect(seen).toEqual([
      { stage: "opening", detail: "reuters.com", index: 1, total: 2 },
      { stage: "reading", detail: "reuters.com", index: 1, total: 2 },
      { stage: "read", detail: "reuters.com", index: 1, total: 2 },
      { stage: "reading", detail: "bbc.com", index: 2, total: 2 },
    ]);
    fail = true;
    await expect(executor.execute(task, new AbortController().signal)).rejects.toMatchObject({
      kind: "permanent",
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});
