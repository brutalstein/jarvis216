import { type CompiledStep, compile } from "@jarvis/action-engine";
import { IntegrationHub } from "@jarvis/integration-hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Executor, Task } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { buildServer } from "../src/http/server.js";
import { ConversationService } from "../src/services/conversation.js";
import { PermissionService } from "../src/services/permissions.js";
import { PlanService } from "../src/services/plans/index.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let db: Database;
let permissions: PermissionService;
beforeEach(async () => {
  db = await memoryDatabase();
  permissions = new PermissionService(db);
  await permissions.load();
});
afterEach(async () => {
  await db.close();
});

const steps = (action: string, args: Record<string, unknown>): CompiledStep[] => {
  const compiled = compile([{ action, args }]);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  return compiled.steps;
};

describe("permission service", () => {
  it("starts guarded: LOW runs, MEDIUM and HIGH ask, unknown actions are denied", () => {
    expect(permissions.mode("app.open")).toBe("allow");
    expect(permissions.mode("app.close")).toBe("ask");
    expect(permissions.mode("agent.delegate")).toBe("ask");
    expect(permissions.mode("shell.run")).toBe("deny");
    expect(permissions.view()).toMatchObject({ preset: "guarded", version: 0 });
  });

  it("applies, audits and survives a reload", async () => {
    const view = await permissions.update({
      actions: { "app.close": { mode: "allow" }, "web.open": { mode: "deny" } },
      settings: { reflexes: false },
    });
    expect(view.preset).toBe("custom");
    expect(view.version).toBe(1);
    const reloaded = new PermissionService(db);
    await reloaded.load();
    expect(reloaded.mode("app.close")).toBe("allow");
    expect(reloaded.denies("web.open")).toBe(true);
    expect(reloaded.settings()).toEqual({ learning: true, reflexes: false });
    expect([...reloaded.denied()]).toEqual(["web.open"]);
    const [entry] = await reloaded.audit();
    expect(entry).toMatchObject({ actor: "operator", change: { settings: { reflexes: false } } });
  });

  it("lets an allow expire back to the default", async () => {
    let now = Date.now();
    const timed = new PermissionService(db, { now: () => now });
    await timed.update({ actions: { "ui.click": { mode: "allow", expiresInMs: 3_600_000 } } });
    expect(timed.mode("ui.click")).toBe("allow");
    expect(timed.view().actions.find((a) => a.id === "ui.click")?.expiresAt).toBe(now + 3_600_000);
    now += 3_600_001;
    expect(timed.mode("ui.click")).toBe("ask");
    expect(timed.view().actions.find((a) => a.id === "ui.click")?.expiresAt).toBeNull();
  });

  it("rejects unknown actions and expiries on anything but allow", async () => {
    await expect(
      permissions.update({ actions: { "shell.run": { mode: "allow" } } }),
    ).rejects.toThrow("UNKNOWN_ACTION");
    await expect(
      permissions.update({ actions: { "app.close": { mode: "ask", expiresInMs: 60_000 } } }),
    ).rejects.toThrow("EXPIRY_NEEDS_ALLOW");
    await expect(
      permissions.update({ actions: { "app.close": { mode: "always" } } }),
    ).rejects.toThrow();
  });

  it("presets set every action and are recognised", async () => {
    expect((await permissions.preset("trusted")).preset).toBe("trusted");
    expect(permissions.mode("file.move")).toBe("allow");
    expect(permissions.mode("automation.invoke")).toBe("ask");
    expect((await permissions.preset("autonomous")).preset).toBe("autonomous");
    expect(permissions.mode("agent.delegate")).toBe("allow");
    expect((await permissions.preset("guarded")).preset).toBe("guarded");
  });

  it("a preset can grant its extra allows for a limited time", async () => {
    let now = Date.now();
    const timed = new PermissionService(db, { now: () => now });
    await timed.preset("autonomous", "operator", 3_600_000);
    expect(timed.mode("agent.delegate")).toBe("allow");
    // Defaults that already allow do not expire.
    expect(timed.view().actions.find((a) => a.id === "app.open")?.expiresAt).toBeNull();
    now += 3_600_001;
    expect(timed.mode("agent.delegate")).toBe("ask");
    expect(timed.mode("app.open")).toBe("allow");
  });
});

describe("permissions in plans and the gateway", () => {
  let tasks: TaskService;
  let stop: AbortController;
  let running: Promise<void>;
  let plans: PlanService;
  const executed: string[] = [];
  const provider = (id: string, capability: Executor["capability"], text: string) => ({
    id,
    capability,
    external: capability === "text.generate",
    retrySafe: capability === "text.generate",
    ...(capability === "text.generate" ? { trustedForPrivate: true } : { outcomeObservable: true }),
    enabled: true,
    authenticated: true,
    priority: 1,
    maxInputChars: 100_000,
    execute: async (task: Task) => {
      executed.push(task.spec.capability);
      return { text, source: id };
    },
  });
  const start = (hub?: IntegrationHub) => {
    tasks = new TaskService(db, { concurrency: 2 });
    const worker = new Worker(
      tasks,
      new ProviderRegistry([
        provider(
          "windows-mcp",
          "desktop.act",
          '{"ok":true,"evidence":"postcondition","observation":"done"}',
        ),
        provider("openclaw", "text.generate", "delegated result"),
      ]),
      undefined,
      {},
      permissions,
    );
    stop = new AbortController();
    running = worker.run(stop.signal);
    plans = new PlanService({
      tasks,
      wake: () => worker.wake(),
      onCancel: (id) => worker.cancel(id),
      conversationProviders: [],
      privateProviders: [],
      ...(hub && { integrations: hub }),
      permissions,
    });
    plans.start(stop.signal);
  };
  afterEach(async () => {
    stop?.abort();
    await running;
    executed.length = 0;
  });
  const propose = (planned: CompiledStep[]) =>
    plans.propose({ turnId: crypto.randomUUID(), goal: "İş", lang: "tr", steps: planned });
  const events = async (planId: string) =>
    (
      await db.query<{ envelope: { type: string; payload: Record<string, unknown> } }>(
        "SELECT e.envelope FROM events e JOIN tasks t ON t.id=e.task_id WHERE t.spec->>'planId'=$1 ORDER BY e.sequence",
        [planId],
      )
    ).rows.map((row) => row.envelope);

  it("an allowed MEDIUM action runs from voice without a tap, recorded as a standing grant", async () => {
    await permissions.update({ actions: { "app.close": { mode: "allow" } } });
    start();
    const view = await propose(steps("app.close", { name: "Not Defteri" }));
    expect(view.needsApproval).toBe(false);
    expect((await plans.waitSettled(view.id, 5000)).status).toBe("COMPLETED");
    const granted = (await events(view.id)).find((e) => e.type === "approval.granted");
    expect(granted?.payload).toMatchObject({
      via: "standing-grant",
      action: "app.close",
      grantVersion: 1,
    });
  });

  it("an asked LOW action waits for the tap; a denied one is refused before any task", async () => {
    await permissions.update({
      actions: { "app.open": { mode: "ask" }, "web.open": { mode: "deny" } },
    });
    start();
    const asked = await propose(steps("app.open", { name: "Spotify" }));
    expect(asked).toMatchObject({ needsApproval: true, status: "AWAITING_APPROVAL" });
    await expect(propose(steps("web.open", { url: "https://example.com/" }))).rejects.toMatchObject(
      {
        code: "ACTION_DENIED",
        httpStatus: 403,
      },
    );
    expect(plans.deniedActions()).toEqual(["web.open"]);
  });

  it("an allowed HIGH integration runs without its separate exact approval", async () => {
    const hub = new IntegrationHub();
    hub.register("agent.delegate", () => ({
      capability: "text.generate",
      providers: ["openclaw"],
      objective: "delegate",
      input: {},
      risk: "HIGH",
      privacy: "private",
      budget: { maxCalls: 1, maxDurationMs: 60_000, maxOutputTokens: 1024 },
      verification: { kind: "non-empty" },
    }));
    await permissions.update({ actions: { "agent.delegate": { mode: "allow" } } });
    start(hub);
    const view = await propose(steps("agent.delegate", { instruction: "özetle" }));
    expect(view.needsApproval).toBe(false);
    const done = await plans.waitSettled(view.id, 5000);
    expect(done.status).toBe("COMPLETED");
    expect(executed).toEqual(["text.generate"]);
  });

  it("an allowed typed tool runs when its compiled arguments add schema defaults", async () => {
    const hub = new IntegrationHub();
    hub.register("github.repositories", () => ({
      capability: "tool.execute",
      providers: ["github-cli"],
      objective: "Execute github.repositories and verify its postcondition",
      input: { action: "github.repositories", args: { limit: 10 } },
      risk: "LOW",
      privacy: "private",
      budget: { maxCalls: 1, maxDurationMs: 60_000, maxOutputTokens: 2000 },
      verification: { kind: "postcondition" },
    }));
    await permissions.update({ actions: { "github.repositories": { mode: "allow" } } });
    tasks = new TaskService(db, { concurrency: 2 });
    const worker = new Worker(
      tasks,
      new ProviderRegistry([
        {
          ...provider(
            "github-cli",
            "tool.execute",
            '{"ok":true,"evidence":"postcondition","observation":"3 repositories"}',
          ),
          external: true,
          execute: async (task: Task) => {
            executed.push(task.spec.capability);
            return {
              text: "3 repositories",
              source: "github-cli",
              outcome: { status: "completed" as const, verified: true },
            };
          },
        },
      ]),
      undefined,
      {},
      permissions,
    );
    stop = new AbortController();
    running = worker.run(stop.signal);
    plans = new PlanService({
      tasks,
      wake: () => worker.wake(),
      onCancel: (id) => worker.cancel(id),
      conversationProviders: [],
      privateProviders: [],
      integrations: hub,
      permissions,
    });
    plans.start(stop.signal);
    const view = await propose(steps("github.repositories", {}));
    expect(view.needsApproval).toBe(false);
    expect((await plans.waitSettled(view.id, 5000)).status).toBe("COMPLETED");
    expect(executed).toEqual(["tool.execute"]);
  });

  it("turning an action off after admission stops it before execution", async () => {
    await permissions.update({ actions: { "app.close": { mode: "allow" } } });
    tasks = new TaskService(db, { concurrency: 2 });
    const worker = new Worker(
      tasks,
      new ProviderRegistry([
        provider(
          "windows-mcp",
          "desktop.act",
          '{"ok":true,"evidence":"postcondition","observation":"done"}',
        ),
      ]),
      undefined,
      {},
      permissions,
    );
    plans = new PlanService({
      tasks,
      wake: () => {},
      onCancel: () => {},
      conversationProviders: [],
      privateProviders: [],
      permissions,
    });
    const view = await propose(steps("app.close", { name: "Not Defteri" }));
    expect(view.status).toBe("RUNNING");
    // Deny lands between admission and execution: the gateway re-checks at run time.
    await permissions.update({ actions: { "app.close": { mode: "deny" } } });
    await worker.once();
    expect(executed).toEqual([]);
    const [task] = (
      await db.query<{ status: string }>("SELECT status FROM tasks WHERE spec->>'planId'=$1", [
        view.id,
      ])
    ).rows;
    expect(task?.status).toBe("BLOCKED");
    expect((await plans.waitSettled(view.id, 2000)).status).toBe("FAILED");
  });
});

describe("permissions in conversation and the API", () => {
  it("a model proposal of a turned-off action is answered, not planned", async () => {
    await permissions.update({ actions: { "web.open": { mode: "deny" } } });
    const tasks = new TaskService(db);
    const worker = new Worker(
      tasks,
      new ProviderRegistry([
        {
          id: "gemini-live",
          capability: "text.generate",
          external: false,
          retrySafe: true,
          enabled: true,
          authenticated: true,
          priority: 1,
          maxInputChars: 100_000,
          execute: async () => ({
            text: JSON.stringify({
              addressed: true,
              say: "Açıyorum",
              lang: "tr",
              intent: {
                kind: "plan",
                goal: "Siteyi aç",
                steps: [{ action: "web.open", args: { url: "https://example.com/" } }],
              },
            }),
            source: "fake",
          }),
        },
      ]),
    );
    const stop = new AbortController();
    const running = worker.run(stop.signal);
    const plans = new PlanService({
      tasks,
      wake: () => worker.wake(),
      onCancel: () => {},
      conversationProviders: [],
      privateProviders: [],
      permissions,
    });
    try {
      const result = await new ConversationService(tasks, {
        providers: ["gemini-live"],
        wake: () => worker.wake(),
        plans,
      }).turn({ utterance: "Jarvis, example.com'u aç", followUp: false });
      expect(result.say).toBe("Bu işlem ayarlarda kapalı, efendim.");
      expect(result.planId).toBeUndefined();
      const prompt = (
        await db.query<{ objective: string }>(
          "SELECT spec->>'objective' AS objective FROM tasks LIMIT 1",
        )
      ).rows[0]?.objective;
      expect(prompt).toContain("Turned off by the operator in Settings");
      expect(prompt).not.toContain("web.open(url");
    } finally {
      stop.abort();
      await running;
    }
  });

  it("exposes the view, changes, presets and audit to the operator only", async () => {
    const operator = "operator-fixture-32-characters-minimum";
    const app = buildServer(new TaskService(db), new ProviderRegistry([]), {
      operatorToken: operator,
      webhookToken: "webhook-fixture-32-characters-minimum",
      onCancel: () => {},
      permissions,
    });
    const headers = { authorization: `Bearer ${operator}` };
    try {
      expect((await app.inject({ method: "GET", url: "/v1/permissions" })).statusCode).toBe(401);
      const view = (await app.inject({ method: "GET", url: "/v1/permissions", headers })).json();
      expect(view.actions.length).toBeGreaterThan(20);
      const changed = await app.inject({
        method: "PUT",
        url: "/v1/permissions",
        headers,
        payload: { actions: { "file.move": { mode: "allow", expiresInMs: 3_600_000 } } },
      });
      expect(changed.statusCode).toBe(200);
      expect(changed.json().actions.find((a: { id: string }) => a.id === "file.move").mode).toBe(
        "allow",
      );
      const bad = await app.inject({
        method: "PUT",
        url: "/v1/permissions",
        headers,
        payload: { actions: { "shell.run": { mode: "allow" } } },
      });
      expect(bad.statusCode).toBe(400);
      const preset = await app.inject({
        method: "POST",
        url: "/v1/permissions/preset",
        headers,
        payload: { preset: "autonomous" },
      });
      expect(preset.json().preset).toBe("autonomous");
      const audit = (
        await app.inject({ method: "GET", url: "/v1/permissions/audit", headers })
      ).json();
      expect(audit.entries[0].actor).toBe("operator:preset:autonomous");
    } finally {
      await app.close();
    }
  });
});
