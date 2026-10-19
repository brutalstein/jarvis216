import { compile } from "@jarvis/action-engine";
import { Brain, type BrainStore } from "@jarvis/brain";
import { createIntegrationHub } from "@jarvis/integration-hub";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { type Provider, ProviderRegistry } from "../src/core/routing.js";
import { TaskService } from "../src/core/tasks.js";
import { Worker } from "../src/core/worker.js";
import { buildServer } from "../src/http/server.js";
import { ConversationService } from "../src/services/conversation.js";
import { PermissionService } from "../src/services/permissions.js";
import { PlanService } from "../src/services/plans/index.js";
import { memoryDatabase } from "./fixtures/pglite.js";

// Regression tests for faults found in the 2026-10-19 audit; each failed before its fix.
let db: Database;
let tasks: TaskService;
let stop: AbortController;
let running: Promise<void>;
let replies: unknown[];
const operator = "operator-fixture-32-characters-minimum";
const webhook = "webhook-fixture-32-characters-minimum";

const provider = (
  id: string,
  capability: Provider["capability"],
  answer: (task: Task) => string,
): Provider => ({
  id,
  capability,
  external: false,
  retrySafe: true,
  trustedForPrivate: true,
  ...(capability === "desktop.act" && { outcomeObservable: true }),
  enabled: true,
  authenticated: true,
  priority: 1,
  maxInputChars: 200_000,
  execute: async (task) => ({ text: answer(task), source: id }),
});
const model = () =>
  provider("gemini-live", "text.generate", () =>
    JSON.stringify({ addressed: true, say: "Tamam", lang: "tr", intent: replies.shift() }),
  );

beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 2, interactive: 1 });
  stop = new AbortController();
  replies = [];
  running = Promise.resolve();
});
afterEach(async () => {
  stop.abort();
  await running;
  await db.close();
  vi.restoreAllMocks();
});

function services(
  extra: Provider[] = [],
  options: { brain?: Brain; permissions?: PermissionService } = {},
) {
  const worker = new Worker(tasks, new ProviderRegistry([model(), ...extra]));
  running = worker.run(stop.signal);
  const plans = new PlanService({
    tasks,
    wake: () => worker.wake(),
    onCancel: (id) => worker.cancel(id),
    conversationProviders: ["gemini-live"],
    privateProviders: [],
    integrations: createIntegrationHub({ browserUrls: ["https://example.com/"] }),
    ...(options.permissions && { permissions: options.permissions }),
  });
  plans.start(stop.signal);
  const conversation = new ConversationService(tasks, {
    providers: ["gemini-live"],
    wake: () => worker.wake(),
    plans,
    deadlineMs: 5000,
    ...(options.brain && {
      brain: options.brain,
      settings: () => ({ learning: true, reflexes: true }),
    }),
  });
  return { plans, conversation, worker };
}

describe("a spoken turn survives what it does not need", () => {
  it("answers although the learning store fails", async () => {
    const failing: BrainStore = {
      loadExperiences: async () => [],
      saveExperience: async () => {
        throw new Error("disk full");
      },
      deleteExperiencesBefore: async () => {},
      deleteExperiences: async () => {},
      loadSkills: async () => [],
      saveSkill: async () => {},
      deleteSkill: async () => {},
      loadPreferences: async () => [],
      savePreference: async () => {},
      deletePreference: async () => {},
      clear: async () => {},
    };
    const brain = new Brain(failing);
    await brain.load();
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { conversation } = services(
      [
        provider("windows-mcp", "desktop.act", () =>
          JSON.stringify({ ok: true, evidence: "postcondition", observation: "ok" }),
        ),
      ],
      { brain },
    );
    replies.push({
      kind: "plan",
      goal: "Not Defteri aç",
      steps: [{ action: "app.open", args: { name: "Not Defteri" } }],
    });
    const turn = await conversation.turn({
      utterance: "Jarvis, Not Defteri'ni aç",
      followUp: false,
    });
    expect(turn.planId).toBeTruthy();
    expect(turn.say).toBe("Not Defteri açıldı, efendim.");
    expect(errors.mock.calls.some(([line]) => String(line).includes("BRAIN_LEARNING_FAILED"))).toBe(
      true,
    );
  });

  it("says it cannot do what this setup does not allow instead of failing the turn", async () => {
    const { conversation } = services();
    replies.push({
      kind: "plan",
      goal: "Sayfayı oku",
      steps: [
        {
          action: "browser.read",
          args: { url: "https://not-allowlisted.example/", expectedText: "x" },
        },
      ],
    });
    const turn = await conversation.turn({ utterance: "Jarvis, şu sayfayı oku", followUp: false });
    expect(turn.say).toBe("Bunu bu kurulumda yapamıyorum, efendim.");
    expect(turn.planId).toBeUndefined();
    const stored = await conversation.list(5);
    expect(stored[0]?.reply.say).toBe("Bunu bu kurulumda yapamıyorum, efendim.");
  });
});

describe("plans", () => {
  it("keeps a candidate pick open when the continued plan cannot start", async () => {
    const permissions = new PermissionService(db);
    await permissions.load();
    const { plans } = services(
      [
        provider("windows-mcp", "desktop.act", () =>
          JSON.stringify({
            ok: false,
            evidence: "observed-failure",
            observation: "two matches",
            candidates: ["Kaydet", "Kaydetme"],
          }),
        ),
      ],
      { permissions },
    );
    const compiled = compile([{ action: "ui.click", args: { target: "Kaydet" } }]);
    if (!compiled.ok) throw new Error("fixture");
    const view = await plans.propose({
      turnId: crypto.randomUUID(),
      goal: "Kaydet",
      lang: "tr",
      steps: compiled.steps,
    });
    await plans.approve(view.id, view.hash);
    await plans.waitSettled(view.id, 5000);
    await permissions.update({ actions: { "ui.click": { mode: "deny" } } }, "operator");
    await expect(plans.choose(view.id, 2)).rejects.toMatchObject({ code: "ACTION_DENIED" });
    await permissions.update({ actions: { "ui.click": { mode: "ask" } } }, "operator");
    const continued = await plans.choose(view.id, 2);
    expect(continued.steps[0]?.args.target).toBe("Kaydetme");
  });
});

describe("HTTP faults", () => {
  it("logs a server fault by route only and answers without detail", async () => {
    const broken = {
      ...tasks,
      db: { ...db, query: async () => Promise.reject(new Error("secret prompt text")) },
    } as unknown as TaskService;
    const app = buildServer(broken, new ProviderRegistry([]), {
      operatorToken: operator,
      webhookToken: webhook,
      onCancel: () => {},
    });
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/readyz",
        headers: { authorization: `Bearer ${operator}` },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "INTERNAL_ERROR" });
      const lines = errors.mock.calls.map(([line]) => String(line));
      expect(lines).toContainEqual(expect.stringContaining('"route":"/readyz"'));
      expect(lines.join("")).not.toContain("secret prompt text");
    } finally {
      await app.close();
    }
  });

  it("ends the live stream cleanly when restoring the cards fails", async () => {
    const { plans } = services();
    const app = buildServer(tasks, new ProviderRegistry([]), {
      operatorToken: operator,
      webhookToken: webhook,
      onCancel: () => {},
      plans,
    });
    await plans.propose({
      turnId: crypto.randomUUID(),
      goal: "Kapat",
      lang: "tr",
      steps: (() => {
        const compiled = compile([{ action: "app.close", args: { name: "Not Defteri" } }]);
        if (!compiled.ok) throw new Error("fixture");
        return compiled.steps;
      })(),
    });
    vi.spyOn(plans, "get").mockRejectedValue(new Error("database gone"));
    const errors = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/stream`, {
        headers: { authorization: `Bearer ${operator}` },
      });
      expect(response.status).toBe(200);
      // The body ends instead of hanging half-open.
      const text = await response.text();
      expect(text).toContain(": connected");
      expect(
        errors.mock.calls.some(([line]) => String(line).includes("STREAM_RESTORE_FAILED")),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("interrupted calls", () => {
  const spec = (provider: string) => ({
    objective: "Read",
    capability: "text.generate",
    providers: [provider],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "non-empty" },
  });
  async function executing(service: TaskService, provider: string, leaseMs = 10_000) {
    const task = await service.create(spec(provider), `t-${provider}-${leaseMs}`, "operator");
    const claimed = await service.claim("w", leaseMs);
    if (!claimed) throw new Error("claim");
    await db.query(
      "INSERT INTO actions(id,task_id,hash,target,risk,parameters,status) VALUES($1,$2,'h',$3,'LOW','{}','EXECUTING')",
      [crypto.randomUUID(), task.id, provider],
    );
    return task.id;
  }
  const status = async (id: string) =>
    (await db.query<{ status: string }>("SELECT status FROM actions WHERE task_id=$1", [id]))
      .rows[0]?.status;

  it("cancelling a retry-safe call is a clean cancel; an unsafe one still needs reconciling", async () => {
    const service = new TaskService(db, {
      concurrency: 4,
      retrySafe: (target) => target === "reader",
    });
    const safe = await executing(service, "reader");
    expect((await service.cancel(safe)).status).toBe("CANCELLED");
    expect(await status(safe)).toBe("FAILED");
    const unsafe = await executing(service, "agent");
    expect((await service.cancel(unsafe)).status).toBe("RECOVERY_REQUIRED");
    expect(await status(unsafe)).toBe("UNCERTAIN");
  });

  it("a lost lease on a retry-safe call queues it again instead of quarantining it", async () => {
    const service = new TaskService(db, {
      concurrency: 4,
      retrySafe: (target) => target === "reader",
    });
    const safe = await executing(service, "reader", 1);
    const unsafe = await executing(service, "agent", 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.recover();
    expect((await service.get(safe)).status).toBe("READY");
    expect((await service.get(unsafe)).status).toBe("RECOVERY_REQUIRED");
  });
});
