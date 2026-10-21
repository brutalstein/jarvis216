import { compile } from "@jarvis/action-engine";
import { afterEach, expect, it } from "vitest";
import { ConfigSchema } from "../src/app/config.js";
import { type Core, createCore } from "../src/app/core.js";
import type { Database } from "../src/core/database.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let core: Core | undefined;
let db: Database | undefined;
afterEach(async () => {
  await core?.stop();
  await db?.close();
});

it("validates backward-only conditional references instead of silently dropping them", () => {
  const first = { action: "file.read", args: { path: "fixture.txt" } };
  const conditional = {
    action: "file.create",
    args: { path: "result.txt", content: "ok" },
    when: { step: 1, contains: "MATCH" },
  };
  expect(compile([first, conditional])).toMatchObject({ ok: true, steps: [first, conditional] });
  expect(compile([conditional]).ok).toBe(false);
  expect(compile([first, { ...conditional, when: { step: 2, contains: "MATCH" } }]).ok).toBe(false);
});

it("evaluates persisted conditions before dispatch and reports skipped branches explicitly", async () => {
  db = await memoryDatabase();
  const calls: string[] = [];
  const env = {
    DATABASE_URL: "postgresql://fixture@127.0.0.1/test",
    JARVIS_TOKEN: "operator-".repeat(8),
    N8N_INGRESS_TOKEN: "webhook-".repeat(8),
  };
  core = await createCore(ConfigSchema.parse(env), {
    db,
    env,
    executors: [
      {
        id: "windows-mcp",
        capability: "desktop.act",
        external: false,
        retrySafe: false,
        outcomeObservable: true,
        execute: async (task) => {
          calls.push(String(task.spec.input.action));
          return {
            text: JSON.stringify({ ok: true, evidence: "postcondition", observation: "MATCH" }),
            source: "fixture:observed",
          };
        },
      },
    ],
  });
  await core.permissions.preset("autonomous", "operator");
  await core.start({ host: "127.0.0.1", port: 0 });
  const compiled = compile([
    { action: "file.read", args: { path: "fixture.txt" } },
    {
      action: "file.create",
      args: { path: "result.txt", content: "ok" },
      when: { step: 1, contains: "MATCH" },
    },
    {
      action: "file.delete",
      args: { path: "result.txt" },
      when: { step: 1, contains: "MATCH", not: true },
    },
    { action: "file.write", args: { path: "result.txt", content: "must not run" } },
  ]);
  if (!compiled.ok) throw Error("Invalid fixture");
  const plan = await core.plans.propose({
    turnId: crypto.randomUUID(),
    goal: "Conditional fixture",
    lang: "en",
    steps: compiled.steps,
  });
  const done = await core.plans.waitSettled(plan.id, 5000);
  expect(done.status).toBe("COMPLETED");
  expect(done.steps.map((step) => step.status)).toEqual([
    "COMPLETED",
    "COMPLETED",
    "SKIPPED",
    "SKIPPED",
  ]);
  expect(calls).toEqual(["file.read", "file.create"]);
  expect(done.say).toContain("2");
  expect(done.say).toContain("skipped");
  const persisted = (
    await db.query<{ spec: { condition?: unknown } }>(
      "SELECT spec FROM tasks WHERE spec->>'planId'=$1 ORDER BY idempotency_key",
      [plan.id],
    )
  ).rows;
  expect(persisted[1]?.spec.condition).toMatchObject({ contains: "MATCH" });
  expect(
    (
      await db.query(
        "SELECT id FROM actions WHERE task_id IN (SELECT id FROM tasks WHERE status='SKIPPED')",
      )
    ).rows,
  ).toEqual([]);
});
