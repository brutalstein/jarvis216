import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Executor, type Risk, TaskSpecSchema } from "../src/contracts.js";
import type { Database } from "../src/database.js";
import { ActionGateway } from "../src/gateway.js";
import { TaskService } from "../src/tasks.js";
import { memoryDatabase } from "./fixtures/pglite.js";

type Step = { action: string; args: Record<string, string>; risk: Risk };
const close: Step = { action: "app.close", args: { name: "Not Defteri" }, risk: "MEDIUM" };
const type: Step = { action: "ui.type", args: { text: "merhaba" }, risk: "MEDIUM" };

function desktopSpec(step: Step, planId?: string) {
  return {
    objective: "Not Defteri'ni kapat",
    capability: "desktop.act",
    input: { action: step.action, args: step.args },
    providers: ["windows-mcp"],
    risk: step.risk,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "contains", value: '"ok":true' },
    ...(planId ? { planId } : {}),
  };
}

function desktop(text = '{"ok":true}', outcomeObservable = true): Executor {
  return {
    id: "windows-mcp",
    capability: "desktop.act",
    external: false,
    retrySafe: false,
    ...(outcomeObservable ? { outcomeObservable } : {}),
    execute: async () => ({ text, source: "windows-mcp" }),
  };
}

let db: Database;
let tasks: TaskService;
let gateway: ActionGateway;
beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 2 });
  gateway = new ActionGateway(tasks);
});
afterEach(async () => {
  await db.close();
});

// Creates one task per step, bound to a plan row whose task_ids may be reordered by the caller.
async function plan(
  steps: Step[],
  options: { approvedAt?: number | null; status?: string; order?: (ids: string[]) => string[] },
) {
  const id = randomUUID();
  const ids: string[] = [];
  for (const [index, step] of steps.entries())
    ids.push((await tasks.create(desktopSpec(step, id), `${id}-${index}`, "operator")).id);
  await db.query(
    "INSERT INTO plans(id,turn_id,goal,lang,kind,steps,hash,status,task_ids,created_at,expires_at,approved_at) VALUES($1,$2,$3,'tr','desktop',$4,'h',$5,$6,$7,$8,$9)",
    [
      id,
      randomUUID(),
      "Not Defteri'ni kapat",
      JSON.stringify(steps),
      options.status ?? "RUNNING",
      JSON.stringify(options.order ? options.order(ids) : ids),
      Date.now(),
      Date.now() + 120_000,
      options.approvedAt ?? null,
    ],
  );
  return { id, ids };
}

async function runNext(executor = desktop()) {
  const claim = await tasks.claim("worker", 10_000);
  expect(claim).not.toBeNull();
  return gateway.run(claim!, executor, new AbortController().signal);
}

async function eventTypes(taskId: string) {
  return ((await tasks.events(taskId)) as { envelope: { type: string; payload: object } }[]).map(
    (event) => event.envelope,
  );
}

describe("desktop and info capabilities", () => {
  it("accept { action, args } input and reject anything else", () => {
    expect(TaskSpecSchema.safeParse(desktopSpec(close)).success).toBe(true);
    expect(
      TaskSpecSchema.safeParse({ ...desktopSpec(close), capability: "info.fetch" }).success,
    ).toBe(true);
    expect(
      TaskSpecSchema.safeParse({ ...desktopSpec(close), input: { url: "https://x.example" } })
        .success,
    ).toBe(false);
    expect(
      TaskSpecSchema.safeParse({
        ...desktopSpec(close),
        input: { action: "a".repeat(41), args: {} },
      }).success,
    ).toBe(false);
  });
});

describe("plan-bound MEDIUM approval", () => {
  it("holds a MEDIUM step of an unapproved plan for approval", async () => {
    const { ids } = await plan([close], { status: "AWAITING_APPROVAL" });
    expect(await runNext()).toBe("WAITING_FOR_APPROVAL");
    expect((await eventTypes(ids[0]!)).map((event) => event.type)).toContain("approval.requested");
  });

  it("holds a MEDIUM action outside any plan until its own exact approval", async () => {
    const task = await tasks.create(desktopSpec(close), "lone", "operator");
    expect(await runNext()).toBe("WAITING_FOR_APPROVAL");
    const [action] = await tasks.actions(task.id);
    await tasks.approve(action!.id, "operator", Date.now() + 30_000);
    expect(await runNext()).toBe("COMPLETED");
  });

  it("runs a MEDIUM step of an approved plan and records the plan approval", async () => {
    const { id, ids } = await plan([close], { approvedAt: Date.now() });
    expect(await runNext()).toBe("COMPLETED");
    const granted = (await eventTypes(ids[0]!)).find((event) => event.type === "approval.granted");
    expect(granted?.payload).toEqual({ planId: id, approver: "operator", via: "plan" });
  });

  it("holds a step when the plan approval is older than two minutes", async () => {
    await plan([close], { approvedAt: Date.now() - 120_001 });
    expect(await runNext()).toBe("WAITING_FOR_APPROVAL");
  });

  it("holds a step whose compiled step does not match its input", async () => {
    await plan([close, type], { approvedAt: Date.now(), order: (ids) => [...ids].reverse() });
    expect(await runNext()).toBe("WAITING_FOR_APPROVAL");
  });

  it("holds a step of an approved plan that is no longer running", async () => {
    await plan([close], { approvedAt: Date.now(), status: "CANCELLED" });
    expect(await runNext()).toBe("WAITING_FOR_APPROVAL");
  });

  it("runs LOW actions without any approval", async () => {
    await tasks.create(desktopSpec({ ...close, risk: "LOW" }), "low", "operator");
    expect(await runNext()).toBe("COMPLETED");
  });

  it("never lets a plan approve a HIGH action", async () => {
    await plan([{ ...close, risk: "HIGH" }], { approvedAt: Date.now() });
    expect(await runNext()).toBe("WAITING_FOR_APPROVAL");
  });
});

describe("observable outcomes", () => {
  it("fails an observed unmet postcondition instead of quarantining it", async () => {
    const task = await tasks.create(desktopSpec({ ...close, risk: "LOW" }), "seen", "operator");
    expect(await runNext(desktop('{"ok":false}'))).toBe("FAILED");
    expect((await tasks.actions(task.id))[0]?.status).toBe("FAILED");
  });

  it("still quarantines an unverified result from a non-observable executor", async () => {
    const task = await tasks.create(desktopSpec({ ...close, risk: "LOW" }), "blind", "operator");
    expect(await runNext(desktop('{"ok":false}', false))).toBe("RECOVERY_REQUIRED");
    expect((await tasks.actions(task.id))[0]?.status).toBe("UNCERTAIN");
  });
});

describe("createIn", () => {
  it("rolls back with the outer transaction", async () => {
    await expect(
      tasks.locked(async (tx) => {
        await tasks.createIn(tx, desktopSpec(close), "outer", "operator");
        throw new Error("outer aborted");
      }),
    ).rejects.toThrow("outer aborted");
    expect(await tasks.list({ limit: 10 })).toEqual([]);
  });
});
