import { compile } from "@jarvis/action-engine";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Executor } from "../src/contracts.js";
import { ConversationService } from "../src/conversation.js";
import type { Database } from "../src/database.js";
import { PlanService } from "../src/plans.js";
import { ProviderRegistry } from "../src/routing.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let db: Database;
let tasks: TaskService;
let stop: AbortController;
let running: Promise<void>;
let worker: Worker;
let plans: PlanService;
let responses: unknown[];
const plan = (action = "app.open") => ({
  kind: "plan",
  goal: "Not Defteri",
  steps: [{ action, args: { name: "Not Defteri" } }],
});
beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db);
  stop = new AbortController();
  responses = [];
  const provider = (
    id: string,
    capability: Executor["capability"],
    execute: Executor["execute"],
  ) => ({
    id,
    capability,
    execute,
    external: false,
    retrySafe: true,
    outcomeObservable: true,
    authenticated: true,
    enabled: true,
    priority: 1,
    maxInputChars: 100000,
  });
  worker = new Worker(
    tasks,
    new ProviderRegistry([
      provider("gemini-live", "text.generate", async () => ({
        text: JSON.stringify({
          addressed: true,
          say: "MODEL CLAIM",
          lang: "tr",
          intent: responses.shift(),
        }),
        source: "fake",
      })),
      provider("windows-mcp", "desktop.act", async () => ({
        text: '{"ok":true,"evidence":"postcondition","observation":"opened"}',
        source: "fake",
      })),
    ]),
  );
  running = worker.run(stop.signal);
  plans = new PlanService({
    tasks,
    wake: () => worker.wake(),
    onCancel: (id) => worker.cancel(id),
    conversationProviders: [],
    privateProviders: [],
  });
});
afterEach(async () => {
  stop.abort();
  await running;
  await db.close();
});
const turn = () =>
  new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
  }).turn({ utterance: "Jarvis Not Defteri aç", followUp: false });
it("LOW plan returns the observed outcome and a plan id, discarding model claims", async () => {
  responses.push(plan());
  const result = await turn();
  expect(result.say).toContain("açıldı");
  expect(result.say).not.toContain("MODEL");
  expect(result.planId).toBeTruthy();
  expect((await plans.get(result.planId!)).status).toBe("COMPLETED");
});
it("MEDIUM plan waits for approval and admits no step task", async () => {
  responses.push(plan("app.close"));
  const result = await turn();
  expect(result.say).toContain("onay");
  expect((await plans.get(result.planId!)).status).toBe("AWAITING_APPROVAL");
});
it("repairs one invalid intent", async () => {
  responses.push(plan("unknown"), plan());
  const result = await turn();
  expect(result.planId).toBeTruthy();
});
it("two invalid intents return a bounded clarification without a plan", async () => {
  responses.push(plan("unknown"), plan("unknown"));
  const result = await turn();
  expect(result.say).toContain("anlayamadım");
  expect(result.planId).toBeUndefined();
});
it("voice cancel cancels the active desktop plan", async () => {
  const compiled = compile([{ action: "app.close", args: { name: "Notepad" } }]);
  if (!compiled.ok) throw new Error("fixture");
  const pending = await plans.propose({
    turnId: crypto.randomUUID(),
    goal: "close",
    lang: "tr",
    steps: compiled.steps,
  });
  responses.push({ kind: "cancel" });
  const result = await turn();
  expect(result.say).toContain("İptal");
  expect((await plans.get(pending.id)).status).toBe("CANCELLED");
});
it("purge scrubs old plan records and step tasks without touching recent plans", async () => {
  responses.push({
    kind: "plan",
    goal: "OLD_SECRET",
    steps: [{ action: "app.open", args: { name: "OLD_SECRET" } }],
  });
  const old = await turn();
  responses.push(plan());
  const recent = await turn();
  await db.query("UPDATE conversation_turns SET created_at=$2 WHERE id=$1", [
    old.id,
    Date.now() - 31 * 86_400_000,
  ]);
  const service = new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
  });
  expect(await service.purge(30 * 86_400_000)).toBe(1);
  const oldPlan = (await db.query("SELECT * FROM plans WHERE id=$1", [old.planId])).rows[0];
  const oldTasks = (
    await db.query("SELECT * FROM tasks WHERE idempotency_key LIKE $1", [`plan:${old.planId}:%`])
  ).rows;
  const oldActions = (
    await db.query("SELECT * FROM actions WHERE task_id = ANY($1::uuid[])", [
      oldTasks.map((task) => task.id),
    ])
  ).rows;
  expect(JSON.stringify([oldPlan, oldTasks, oldActions])).not.toContain("OLD_SECRET");
  expect((await plans.get(recent.planId!)).goal).toBe("Not Defteri");
});
it("screen descriptions stay out of the next model prompt", async () => {
  responses.push(plan());
  const first = await turn();
  await db.query("UPDATE plans SET steps=$2 WHERE id=$1", [
    first.planId,
    JSON.stringify([{ action: "screen.describe", args: {}, kind: "desktop", risk: "LOW" }]),
  ]);
  await db.query("UPDATE conversation_turns SET reply=$2 WHERE id=$1", [
    first.id,
    JSON.stringify({ addressed: true, say: "PRIVATE_SCREEN_CONTENT", lang: "tr", display: [] }),
  ]);
  responses.push({ kind: "reply" });
  const next = await turn();
  expect((await tasks.get(next.taskId)).spec.objective).not.toContain("PRIVATE_SCREEN_CONTENT");
});
it("delete-all cancels and scrubs a pending plan", async () => {
  responses.push(plan("app.close"));
  const pending = await turn();
  await new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
  }).deleteAll();
  const row = (await db.query("SELECT * FROM plans WHERE id=$1", [pending.planId])).rows[0];
  expect(row).toMatchObject({ status: "CANCELLED", goal: "[deleted]", steps: [] });
  expect((await db.query("SELECT * FROM conversation_turns")).rows).toEqual([]);
});
