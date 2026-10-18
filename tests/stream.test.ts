import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { compile } from "@jarvis/action-engine";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../src/database.js";
import { PlanService } from "../src/plans.js";
import { ProviderRegistry } from "../src/routing.js";
import { buildServer } from "../src/server.js";
import { TaskService } from "../src/tasks.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const token = "operator-fixture-32-characters-minimum";
const headers = { authorization: `Bearer ${token}` };
let db: Database;
let plans: PlanService;
let app: ReturnType<typeof buildServer>;
beforeEach(async () => {
  db = await memoryDatabase();
  const tasks = new TaskService(db);
  plans = new PlanService({
    tasks,
    wake() {},
    onCancel() {},
    conversationProviders: [],
    privateProviders: [],
  });
  app = buildServer(tasks, new ProviderRegistry([]), {
    operatorToken: token,
    webhookToken: "webhook-fixture-32-characters-minimum",
    onCancel() {},
    plans,
  });
});
afterEach(async () => {
  await app.close();
  await db.close();
});
const propose = async () => {
  const compiled = compile([{ action: "app.close", args: { name: "Notepad" } }]);
  if (!compiled.ok) throw new Error("fixture");
  return plans.propose({ turnId: randomUUID(), goal: "close", lang: "en", steps: compiled.steps });
};
it("plan endpoints authenticate and bind approval to the exact hash", async () => {
  const plan = await propose();
  const url = `/v1/plans/${plan.id}`;
  expect((await app.inject({ url })).statusCode).toBe(401);
  expect((await app.inject({ url, headers })).json().status).toBe("AWAITING_APPROVAL");
  expect(
    (
      await app.inject({
        url: `${url}/approve`,
        method: "POST",
        headers,
        payload: { hash: "wrong" },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        url: `${url}/approve`,
        method: "POST",
        headers,
        payload: { hash: plan.hash },
      })
    ).statusCode,
  ).toBe(204);
  expect((await app.inject({ url: `${url}/cancel`, method: "POST", headers })).statusCode).toBe(
    204,
  );
});
it("stream authenticates before opening", async () => {
  expect((await app.inject({ url: "/v1/stream" })).statusCode).toBe(401);
});
it("stream delivers plans and heartbeat and detaches listeners when disconnected", async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  const stop = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/stream`, {
    headers,
    signal: stop.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  try {
    const plan = await propose();
    let text = "";
    while (!text.includes(": ping")) {
      const part = await reader.read();
      if (part.done) break;
      text += new TextDecoder().decode(part.value);
    }
    expect(text).toContain("event: plan");
    expect(text).toContain(plan.id);
    expect(text).toContain(": ping");
    expect(plans.listenerCount("plan")).toBe(1);
  } finally {
    await reader.cancel();
    stop.abort();
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(plans.listenerCount("plan")).toBe(0);
});
it("stream keeps one frame larger than the backlog cap and stays open", async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  const stop = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/stream`, {
    headers,
    signal: stop.signal,
  });
  const reader = response.body!.getReader();
  try {
    // A news view with eight 200 KB thumbnails is about 2 MB of base64.
    plans.emit("announce", { text: "x".repeat(1_500_000), lang: "en" });
    plans.emit("announce", { text: "after", lang: "en" });
    let text = "";
    while (!text.includes('"after"')) {
      const part = await reader.read();
      if (part.done) break;
      text += new TextDecoder().decode(part.value);
    }
    expect(text).toContain('"after"');
  } finally {
    await reader.cancel();
    stop.abort();
  }
});
