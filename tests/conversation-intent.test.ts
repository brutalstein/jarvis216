import { compile } from "@jarvis/action-engine";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Executor } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { ConversationService } from "../src/services/conversation.js";
import { PlanService } from "../src/services/plans/index.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let db: Database;
let tasks: TaskService;
let stop: AbortController;
let running: Promise<void>;
let worker: Worker;
let plans: PlanService;
let responses: unknown[];
let desktopResults: string[];
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
  desktopResults = [];
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
        text:
          desktopResults.shift() ?? '{"ok":true,"evidence":"postcondition","observation":"opened"}',
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
const turn = (utterance = "Jarvis Not Defteri aç") =>
  new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
  }).turn({ utterance, followUp: false });
const modelTasks = async () =>
  Number(
    (
      await db.query<{ count: string }>(
        "SELECT count(*) FROM tasks WHERE idempotency_key LIKE 'conversation:%'",
      )
    ).rows[0]?.count,
  );
async function pendingApproval() {
  const compiled = compile([{ action: "app.close", args: { name: "Notepad" } }]);
  if (!compiled.ok) throw new Error("fixture");
  return plans.propose({
    turnId: crypto.randomUUID(),
    goal: "close",
    lang: "tr",
    steps: compiled.steps,
  });
}
// An approved click that stopped on two matching elements.
async function choosing() {
  const compiled = compile([{ action: "ui.click", args: { target: "Kaydet" } }]);
  if (!compiled.ok) throw new Error("fixture");
  desktopResults.push(
    JSON.stringify({
      ok: false,
      evidence: "observed-failure",
      observation: "two matches",
      candidates: ["Kaydet", "Kaydetme"],
    }),
  );
  const proposed = await plans.propose({
    turnId: crypto.randomUUID(),
    goal: "Kaydet",
    lang: "tr",
    steps: compiled.steps,
  });
  await plans.approve(proposed.id, proposed.hash);
  const failed = await plans.waitSettled(proposed.id, 5000);
  expect(failed.status).toBe("FAILED");
  return failed;
}
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
it("a spoken stop cancels the active plan at once, without a model call", async () => {
  const pending = await pendingApproval();
  const result = await turn("Jarvis, dur!");
  expect(result).toMatchObject({ taskId: null, provider: null, planId: pending.id, lang: "tr" });
  expect(result.say).toContain("İptal");
  expect((await plans.get(pending.id)).status).toBe("CANCELLED");
  expect(await modelTasks()).toBe(0);
  const [kept] = await new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
  }).list(5);
  expect(kept?.utterance).toBe("Jarvis, dur!");
});
it("a spoken stop with nothing to stop goes to the model", async () => {
  responses.push({ kind: "cancel" });
  const result = await turn("stop");
  expect(result.taskId).toBeTruthy();
  expect(await modelTasks()).toBe(1);
});
it("a spoken ordinal picks one of the on-screen candidates", async () => {
  const failed = await choosing();
  const result = await turn("Jarvis, ikincisi");
  expect(result).toMatchObject({ taskId: null, provider: null, lang: "tr" });
  expect(result.planId).toBeTruthy();
  expect(result.planId).not.toBe(failed.id);
  const chosen = await plans.waitSettled(result.planId!, 5000);
  expect(chosen.steps[0]?.args.target).toBe("Kaydetme");
  expect(chosen.status).toBe("COMPLETED");
  expect(await modelTasks()).toBe(0);
  // The choice is spent: saying it again is ordinary speech for the model.
  responses.push(undefined);
  expect((await turn("ikincisi")).taskId).toBeTruthy();
});
it("an out-of-range ordinal goes to the model", async () => {
  await choosing();
  responses.push(undefined);
  expect((await turn("beşincisi")).taskId).toBeTruthy();
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
  expect((await tasks.get(next.taskId!)).spec.objective).not.toContain("PRIVATE_SCREEN_CONTENT");
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
