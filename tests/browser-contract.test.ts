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
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received = JSON.parse(Buffer.concat(chunks).toString());
    headers = req.headers;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(contract.response));
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
  } finally {
    server.close();
    await once(server, "close");
  }
});
