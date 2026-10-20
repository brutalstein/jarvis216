import { narrate } from "@jarvis/action-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, migrate } from "../../src/core/database.js";
import { ProviderFailure } from "../../src/core/routing.js";
import { boot, database, FakeModel, type Running, type Services, services } from "./harness.js";

const providerIds = ["gemini-live", "claude-live", "claude-code", "or-fixture", "nv-fixture"];
let db: Database;
let drop: (() => Promise<void>) | undefined;
let fakes: Services | undefined;
let running: Running | undefined;
let model: FakeModel;

beforeEach(async () => {
  ({ db, drop } = await database());
  fakes = await services();
  model = new FakeModel();
});
afterEach(async () => {
  await running?.stop();
  await fakes?.close();
  await drop?.();
  running = undefined;
  fakes = undefined;
  drop = undefined;
});

const env = () => ({
  ...fakes!.env,
  ENABLE_DESKTOP: "false",
  ENABLE_BROWSER: "false",
  ENABLE_OPENCLAW: "false",
  ENABLE_N8N: "false",
});

describe("conversation provider topology through Core", () => {
  it.each<{ name: string; overrides: Record<string, string>; error: RegExp }>([
    {
      name: "operator placeholder",
      overrides: { JARVIS_TOKEN: "REPLACE_OPERATOR_TOKEN_WITH_RANDOM_SECRET" },
      error: /bootstrap/,
    },
    {
      name: "ingress placeholder",
      overrides: { N8N_INGRESS_TOKEN: "REPLACE_N8N_TOKEN_WITH_DIFFERENT_RANDOM_SECRET" },
      error: /bootstrap/,
    },
    {
      name: "database placeholder",
      overrides: { DATABASE_URL: "postgresql://j:REPLACE_PASSWORD@127.0.0.1:5432/jarvis" },
      error: /bootstrap/,
    },
    {
      name: "non-local database",
      overrides: { DATABASE_URL: "postgresql://j:p@db.example/jarvis" },
      error: /must be this host/,
    },
    {
      name: "unverified OpenClaw policy",
      overrides: { ENABLE_OPENCLAW: "true", OPENCLAW_POLICY_VERIFIED: "false" },
      error: /true/,
    },
    {
      name: "unverified Codex isolation",
      overrides: { ENABLE_CODEX: "true", CODEX_ISOLATION_VERIFIED: "false" },
      error: /true/,
    },
    {
      name: "malformed workflow JSON",
      overrides: { ENABLE_N8N: "true", N8N_WORKFLOWS_JSON: "{" },
      error: /JSON/,
    },
    {
      name: "wrong workflow shape",
      overrides: { ENABLE_N8N: "true", N8N_WORKFLOWS_JSON: "[]" },
      error: /record/,
    },
    {
      name: "credential-bearing browser allowlist",
      overrides: {
        ENABLE_BROWSER: "true",
        BROWSER_ALLOWED_URLS: '["https://user:password@example.com/"]',
      },
      error: /INVALID_BROWSER_ALLOWLIST/,
    },
  ])("refuses startup with $name before creating work", async ({ overrides, error }) => {
    await migrate(db);
    await expect(boot(db, { ...env(), ...overrides }, model)).rejects.toThrow(error);
    expect((await db.query("SELECT id FROM tasks")).rows).toEqual([]);
    expect((await db.query("SELECT id FROM plans")).rows).toEqual([]);
    expect(fakes!.browser.calls).toEqual([]);
    expect(fakes!.openclaw.calls).toEqual([]);
    expect(fakes!.workflow.calls).toEqual([]);
  });

  it.each(
    [
      { action: "app.open", args: { name: "Not Defteri" } },
      { action: "news.brief", args: {} },
    ].flatMap((step) => [undefined, 0.1].map((confidence) => ({ step, confidence }))),
  )(
    "refuses unavailable $step.action even with confidence=$confidence",
    async ({ step, confidence }) => {
      model.turns.push({
        intent: {
          kind: "plan",
          goal: "Open Notepad",
          steps: [step],
          confidence,
        },
      });
      running = await boot(db, env(), model);
      const response = await running.api<{ say: string; planId?: string }>(
        "POST",
        "/v1/conversation/turns",
        { utterance: "Jarvis, not defterini aç" },
      );
      expect(response.status).toBe(200);
      expect(response.body.planId).toBeUndefined();
      expect(response.body.say).toBe(narrate({ type: "unavailable" }, "tr"));
      const prompt = model.prompts[0]!.prompt;
      for (const action of [
        "app.open",
        "screen.describe",
        "news.brief",
        "browser.read",
        "agent.delegate",
        "automation.invoke",
      ])
        expect(prompt, action).not.toContain(`${action}(`);
      expect(prompt).toContain("memory.save(");
      expect((await db.query("SELECT id FROM plans")).rows).toEqual([]);
      expect((await db.query("SELECT id FROM actions WHERE target='windows-mcp'")).rows).toEqual(
        [],
      );
    },
  );

  it.each(providerIds)("answers with %s alone and persists the actual execution", async (id) => {
    running = await boot(db, env(), model, [model.executor(id)]);
    const response = await running.api<{ taskId: string; provider: string; say: string }>(
      "POST",
      "/v1/conversation/turns",
      { utterance: "Jarvis, merhaba" },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ provider: id, say: "Buyurun, efendim." });
    expect(await running.core.tasks.get(response.body.taskId)).toMatchObject({
      status: "COMPLETED",
    });
    expect(await running.core.tasks.actions(response.body.taskId)).toEqual([
      expect.objectContaining({ target: id, status: "SUCCEEDED" }),
    ]);
    const events = await running.api<{ envelope: { type: string } }[]>(
      "GET",
      `/v1/tasks/${response.body.taskId}/events`,
    );
    expect(events.status).toBe(200);
    expect(events.body.map((e) => e.envelope.type)).toContain("verification.succeeded");
    const turns = await running.api<{ turns: { provider: string; taskId: string }[] }>(
      "GET",
      "/v1/conversation/turns",
    );
    expect(turns.body.turns).toHaveLength(1);
    expect(turns.body.turns[0]?.provider).toBe(id);
  });

  it("starts without a conversation provider and returns a bounded definite error", async () => {
    running = await boot(db, env(), model, []);
    const ready = await running.api<{ database: string; providers: { id: string }[] }>(
      "GET",
      "/readyz",
    );
    expect(ready.status).toBe(200);
    expect(ready.body.database).toBe("ready");
    expect(ready.body.providers.some((p) => providerIds.includes(p.id))).toBe(false);
    const response = await running.api("POST", "/v1/conversation/turns", {
      utterance: "Jarvis, merhaba",
    });
    expect(response).toEqual({ status: 503, body: { error: "NO_PROVIDER" } });
    expect((await db.query("SELECT id FROM tasks")).rows).toEqual([]);
    expect((await db.query("SELECT id FROM actions")).rows).toEqual([]);
    expect((await running.api("GET", "/healthz")).status).toBe(200);
  });

  it.each([
    { kind: "rate-limited", retryable: true, dispatched: true, fallback: true },
    { kind: "authentication-required", retryable: false, dispatched: false, fallback: true },
    { kind: "permanent", retryable: false, dispatched: true, fallback: true },
    { kind: "provider-unavailable", retryable: true, dispatched: false, fallback: true },
    { kind: "transient", retryable: true, dispatched: false, fallback: true },
    { kind: "invalid-response", retryable: true, dispatched: true, fallback: true },
    { kind: "policy-denied", retryable: false, dispatched: true, fallback: false },
  ] as const)("records $kind and respects fallback=$fallback", async (failure) => {
    running = await boot(db, env(), model, [
      {
        ...model.executor("gemini-live"),
        execute: async () => {
          throw new ProviderFailure(failure.kind, failure.retryable, failure.dispatched);
        },
      },
      model.executor("claude-code"),
    ]);
    const response = await running.api<{ provider?: string; error?: string }>(
      "POST",
      "/v1/conversation/turns",
      { utterance: "Jarvis, merhaba" },
    );
    expect(response.status).toBe(failure.fallback ? 200 : 502);
    if (failure.fallback) expect(response.body.provider).toBe("claude-code");
    else expect(response.body.error).toBe("TURN_FAILED");
    const [task] = (
      await db.query<{ id: string; status: string; calls: number }>(
        "SELECT id,status,calls FROM tasks WHERE idempotency_key LIKE 'conversation:%'",
      )
    ).rows;
    expect(task).toMatchObject({
      status: failure.fallback ? "COMPLETED" : "FAILED",
      calls: failure.fallback ? 2 : 1,
    });
    expect((await running.core.tasks.actions(task!.id)).map((a) => a.target).sort()).toEqual(
      failure.fallback ? ["claude-code", "gemini-live"] : ["gemini-live"],
    );
    const attempts = await db.query<{ provider: string; kind: string }>(
      "SELECT provider,kind FROM provider_observations WHERE provider='gemini-live'",
    );
    expect(attempts.rows).toEqual([{ provider: "gemini-live", kind: failure.kind }]);
  });

  it("restores a spent daily provider budget after a Core restart", async () => {
    const configured = {
      ...env(),
      PROVIDER_BUDGETS_JSON: JSON.stringify({ "gemini-live": { callsPerDay: 1 } }),
    };
    const executors = [model.executor("gemini-live"), model.executor("claude-code")];
    running = await boot(db, configured, model, executors);
    const first = await running.api<{ provider: string }>("POST", "/v1/conversation/turns", {
      utterance: "Jarvis, merhaba",
    });
    expect(first.body.provider).toBe("gemini-live");
    await running.stop();
    running = await boot(db, configured, model, executors);
    const second = await running.api<{ provider: string }>("POST", "/v1/conversation/turns", {
      utterance: "Jarvis, nasılsın",
    });
    expect(second.body.provider).toBe("claude-code");
    expect((await db.query("SELECT id FROM actions WHERE target='gemini-live'")).rows).toHaveLength(
      1,
    );
  });
});
