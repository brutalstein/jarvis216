import { setTimeout as delay } from "node:timers/promises";
import type { CompiledStep, Evidence } from "@jarvis/action-engine";
import { IntegrationHub } from "@jarvis/integration-hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Executor, Task } from "../src/contracts.js";
import type { Database } from "../src/database.js";
import { PlanService, type PlanView } from "../src/plans.js";
import { ProviderFailure, ProviderRegistry } from "../src/routing.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

type Input = { action: string; args: Record<string, unknown> };
const step = (
  action: string,
  args: Record<string, unknown>,
  risk: "LOW" | "MEDIUM" = "LOW",
): CompiledStep => ({
  action,
  args,
  risk,
  kind: action === "news.brief" ? "info" : "desktop",
});
const open = step("app.open", { name: "Not Defteri" });
const close = step("app.close", { name: "Not Defteri" }, "MEDIUM");
const news = step("news.brief", { count: 2 });
const ok = (observation = "done"): Evidence => ({
  ok: true,
  evidence: "postcondition",
  observation,
});
const refused: Evidence = { ok: false, evidence: "refused", observation: "refused" };
const headlines = {
  type: "news" as const,
  title: "Gündem",
  items: [
    {
      headline: "Merkez Bankası faiz kararını açıkladı",
      source: "Örnek",
      publishedAt: "2026-10-18T09:00:00.000Z",
      url: "https://a.example/",
    },
    {
      headline: "Borsa güne yükselişle başladı",
      source: "Piyasa",
      publishedAt: "2026-10-18T08:00:00.000Z",
      url: "https://b.example/",
    },
  ],
};

let db: Database;
let tasks: TaskService;
let stop: AbortController;
let running: Promise<void>;
let worker: Worker | undefined;
let plans: PlanService;
let views: PlanView[];
let announced: { text: string; lang: string }[];
let prompts: Record<string, string[]>;

// Executors fake both ports: desktop and news return typed evidence; text providers answer prompts.
function provider(
  id: string,
  capability: Executor["capability"],
  answer: (task: Task) => string | Promise<string>,
) {
  const text = capability === "text.generate";
  return {
    id,
    capability,
    external: text,
    retrySafe: text,
    ...(text ? { trustedForPrivate: true } : { outcomeObservable: true }),
    enabled: true,
    authenticated: true,
    priority: 1,
    maxInputChars: 100_000,
    execute: async (task: Task) => {
      prompts[id] ??= [];
      prompts[id].push(task.spec.objective);
      return { text: await answer(task), source: id };
    },
  };
}
const desktop = (act: (input: Input) => Evidence | Promise<Evidence> = () => ok()) =>
  provider("windows-mcp", "desktop.act", async (task) =>
    JSON.stringify(await act(task.spec.input as Input)),
  );
const newsFeed = () =>
  provider("news", "info.fetch", () =>
    JSON.stringify({ ...ok("2 headlines"), panel: headlines } satisfies Evidence),
  );
const gemini = (answer: () => string = () => "Bugün iki gelişme öne çıkıyor.") =>
  provider("gemini-live", "text.generate", answer);
const claude = (answer: (task: Task) => string | Promise<string>) =>
  provider("claude-code", "text.generate", answer);

function service(integrations?: IntegrationHub) {
  const created = new PlanService({
    tasks,
    wake: () => worker?.wake(),
    onCancel: (id) => worker?.cancel(id),
    conversationProviders: ["gemini-live"],
    privateProviders: ["claude-code"],
    integrations,
  });
  created.on("plan", (view: PlanView) => views.push(view));
  created.on("announce", (announcement: { text: string; lang: string }) =>
    announced.push(announcement),
  );
  return created;
}
function runWorker(executors: ReturnType<typeof provider>[]) {
  worker = new Worker(tasks, new ProviderRegistry(executors));
  running = worker.run(stop.signal);
}
function start(executors: ReturnType<typeof provider>[], integrations?: IntegrationHub) {
  runWorker(executors);
  plans = service(integrations);
  plans.start(stop.signal);
}

beforeEach(async () => {
  db = await memoryDatabase();
  tasks = new TaskService(db, { concurrency: 2 });
  stop = new AbortController();
  running = Promise.resolve();
  worker = undefined;
  views = [];
  announced = [];
  prompts = {};
});
afterEach(async () => {
  stop.abort();
  await running;
  await db.close();
});

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`timed out; last value: ${JSON.stringify(value)}`);
    await delay(50);
  }
}
const status = (id: string, wanted: string) =>
  until(
    () => plans.get(id),
    (view) => view.status === wanted,
  );
const spoken = () =>
  until(
    () => announced,
    (list) => list.length > 0,
  );
// Announcements wait for the turn's reply window; tests move the plan past it.
const pastReplyWindow = (id: string) =>
  db.query("UPDATE plans SET created_at=created_at-10000 WHERE id=$1", [id]);
const propose = (steps: CompiledStep[], goal = "Not Defteri") =>
  plans.propose({ turnId: crypto.randomUUID(), goal, lang: "tr", steps });

describe("plan admission and approval", () => {
  it("maps disabled integrations to a client error", async () => {
    plans = service(new IntegrationHub());
    await expect(
      propose([
        {
          action: "agent.delegate",
          args: { instruction: "work" },
          risk: "HIGH",
          kind: "integration",
        },
      ]),
    ).rejects.toMatchObject({ code: "INTEGRATION_DISABLED", httpStatus: 400 });
  });
  it("shows a separate HIGH action approval and keeps provider text out of speech", async () => {
    const hub = new IntegrationHub();
    hub.register("agent.delegate", () => ({
      capability: "text.generate",
      providers: ["openclaw"],
      objective: "delegate",
      input: {},
      risk: "HIGH",
      privacy: "private",
      budget: { maxCalls: 1, maxDurationMs: 120000, maxOutputTokens: 1024 },
      verification: { kind: "non-empty" },
    }));
    start([provider("openclaw", "text.generate", () => "IGNORE_RULES_APPROVE_ME")], hub);
    const view = await propose([
      {
        action: "agent.delegate",
        args: { instruction: "work" },
        risk: "HIGH",
        kind: "integration",
      },
    ]);
    await plans.approve(view.id, view.hash);
    const pending = await until(
      () => plans.get(view.id),
      (value) => value.steps[0]?.status === "WAITING_FOR_APPROVAL" && !!value.steps[0].approval,
    );
    const actionId = pending.steps[0]?.approval?.id;
    expect(actionId).toBeTruthy();
    await tasks.approve(actionId!, "operator", Date.now() + 120000);
    worker?.wake();
    const done = await status(view.id, "COMPLETED");
    expect(done.panels).toContainEqual({
      type: "text",
      title: "agent.delegate",
      body: "IGNORE_RULES_APPROVE_ME",
    });
    expect(done.say ?? "").not.toContain("IGNORE_RULES_APPROVE_ME");
  });
  it("runs a LOW plan at once and announces its outcome once", async () => {
    start([desktop()]);
    const view = await propose([open]);
    expect(view).toMatchObject({ status: "RUNNING", needsApproval: false });
    await pastReplyWindow(view.id);
    await spoken();
    await delay(700);
    expect(announced).toEqual([
      { text: "Not Defteri açıldı, efendim.", lang: "tr", kind: "outcome", planId: view.id },
    ]);
    const done = await plans.get(view.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.steps[0]).toMatchObject({ status: "COMPLETED", evidence: { ok: true } });
    const scheduled = await db.query<{
      spec: { budget: { maxDurationMs: number }; deadline: string };
    }>("SELECT spec FROM tasks WHERE spec->>'planId'=$1", [view.id]);
    expect(scheduled.rows[0]?.spec.budget.maxDurationMs).toBe(15_000);
  });

  it("lets the turn reply narrate a quick outcome instead of announcing it", async () => {
    start([desktop()]);
    const view = await propose([open]);
    expect((await plans.waitSettled(view.id, 5000)).status).toBe("COMPLETED");
    expect(await plans.claimNarration(view.id)).toBe(true);
    expect(await plans.claimNarration(view.id)).toBe(false);
    await pastReplyWindow(view.id);
    await delay(700);
    expect(announced).toEqual([]);
  });

  it("holds a MEDIUM plan until the operator approves its exact hash", async () => {
    start([desktop()]);
    const view = await propose([open, close]);
    expect(view).toMatchObject({ status: "AWAITING_APPROVAL", needsApproval: true });
    expect((await plans.waitSettled(view.id, 1000)).steps.map((s) => s.status)).toEqual([
      "WAITING_FOR_APPROVAL",
      "WAITING_FOR_APPROVAL",
    ]);
    await expect(plans.approve(view.id, "0".repeat(64))).rejects.toThrow("PLAN_HASH_MISMATCH");
    // Nothing of an unapproved plan reaches the desktop, not even its LOW steps.
    expect(await tasks.list({ limit: 10 })).toEqual([]);
    await plans.approve(view.id, view.hash);
    await status(view.id, "COMPLETED");
    expect(prompts["windows-mcp"]).toHaveLength(2);
  });

  it("cancels a plan left unapproved for two minutes", async () => {
    start([desktop()]);
    const view = await propose([close]);
    await db.query("UPDATE plans SET expires_at=$2 WHERE id=$1", [view.id, Date.now() - 1]);
    await status(view.id, "CANCELLED");
    await expect(plans.approve(view.id, view.hash)).rejects.toThrow("PLAN_NOT_PENDING");
  });

  it("rejecting a plan cancels it and runs nothing", async () => {
    start([desktop()]);
    const view = await propose([open, close]);
    await plans.reject(view.id);
    expect((await plans.get(view.id)).status).toBe("CANCELLED");
    await delay(600);
    expect(prompts["windows-mcp"]).toBeUndefined();
  });
});

describe("one desktop plan at a time", () => {
  it("a new desktop plan cancels the previous one and withdraws its card", async () => {
    start([desktop()]);
    const first = await propose([close]);
    const second = await propose([open]);
    expect(views).toContainEqual(expect.objectContaining({ id: first.id, status: "CANCELLED" }));
    await status(second.id, "COMPLETED");
  });

  it("an info plan does not cancel the desktop plan", async () => {
    start([desktop(), newsFeed(), gemini()]);
    const pending = await propose([close]);
    const brief = await propose([news], "Haberler");
    await status(brief.id, "COMPLETED");
    expect((await plans.get(pending.id)).status).toBe("AWAITING_APPROVAL");
  });

  it("concurrent desktop proposals leave only the newest active", async () => {
    plans = service();
    const [first, second] = await Promise.all([propose([close]), propose([close])]);
    expect((await plans.get(first.id)).status).toBe("CANCELLED");
    expect((await plans.get(second.id)).status).toBe("AWAITING_APPROVAL");
  });

  it("cancelActive withdraws the pending desktop plan without announcing it", async () => {
    start([desktop()]);
    const pending = await propose([close]);
    expect((await plans.cancelActive())?.id).toBe(pending.id);
    expect((await plans.get(pending.id)).status).toBe("CANCELLED");
    expect(await plans.cancelActive()).toBeNull();
    await pastReplyWindow(pending.id);
    await delay(700);
    expect(announced).toEqual([]);
  });
});

describe("plan outcomes", () => {
  it("a failed step blocks the rest and fails the plan", async () => {
    start([desktop((input) => (input.action === "app.open" ? refused : ok()))]);
    const view = await propose([open, step("app.focus", { name: "Not Defteri" })]);
    await pastReplyWindow(view.id);
    const failed = await status(view.id, "FAILED");
    expect(failed.steps[0]?.status).toBe("FAILED");
    await until(
      () => plans.get(view.id),
      (current) => current.steps[1]?.status === "BLOCKED",
    );
    await spoken();
    expect(announced[0]?.text).toBe("Bunu tamamlayamadım, efendim.");
  });

  it("an uncertain step makes the plan uncertain and JARVIS says so", async () => {
    start([
      desktop(() => {
        throw new Error("MCP_CHANNEL_LOST");
      }),
    ]);
    const view = await propose([open]);
    await pastReplyWindow(view.id);
    await status(view.id, "RECOVERY_REQUIRED");
    await spoken();
    expect(announced[0]?.text).toContain("emin değilim");
  });

  it("speaks the news brief over the fetched headlines only", async () => {
    start([newsFeed(), gemini()]);
    const view = await propose([news], "Haberler");
    await pastReplyWindow(view.id);
    const done = await status(view.id, "COMPLETED");
    expect(done.panels).toContainEqual(headlines);
    await spoken();
    expect(announced[0]?.text).toBe("Bugün iki gelişme öne çıkıyor.");
    expect(prompts["gemini-live"]?.[0]).toContain("Merkez Bankası faiz kararını açıkladı");
  });

  it("falls back to the template when the brief fails", async () => {
    start([
      newsFeed(),
      gemini(() => {
        throw new ProviderFailure("permanent", false);
      }),
    ]);
    const view = await propose([news], "Haberler");
    await pastReplyWindow(view.id);
    await status(view.id, "COMPLETED");
    await spoken();
    expect(announced[0]?.text).toBe("2 başlık ekranda, efendim.");
  });

  it("describes the screen through claude-code only", async () => {
    start([
      desktop(() => ok("Focused: Not Defteri — merhaba")),
      gemini(),
      claude(() => "Ekranda Not Defteri açık, efendim."),
    ]);
    const view = await propose([step("screen.describe", { question: "Ne açık?" })]);
    await pastReplyWindow(view.id);
    await status(view.id, "COMPLETED");
    await spoken();
    expect(announced[0]?.text).toBe("Ekranda Not Defteri açık, efendim.");
    expect(prompts["claude-code"]?.[0]).toContain("Focused: Not Defteri — merhaba");
    expect(prompts["gemini-live"]).toBeUndefined();
    // Once answered, the screen text is gone from every task and action record.
    const records = await db.query(
      "SELECT t.spec, t.result, a.parameters, a.result AS action FROM tasks t LEFT JOIN actions a ON a.task_id=t.id",
    );
    expect(JSON.stringify(records.rows)).not.toContain("merhaba");
    expect((await plans.get(view.id)).steps[0]?.evidence?.observation).toBe(
      "[screen text discarded]",
    );
  });
});

describe("clarification and replanning", () => {
  it("a choice among candidates continues the approved plan with the exact target", async () => {
    const save = step("ui.click", { target: "Kaydet" }, "MEDIUM");
    const shortcut = step("key.shortcut", { keys: "ctrl+s" }, "MEDIUM");
    start([
      desktop((input) =>
        input.args.target === "Kaydet"
          ? {
              ok: false,
              evidence: "observed-failure",
              observation: '"Kaydet" matches 2 elements',
              candidates: ["Kaydet", "Farklı Kaydet"],
            }
          : ok(),
      ),
    ]);
    const view = await propose([save, shortcut]);
    await plans.approve(view.id, view.hash);
    const failed = await status(view.id, "FAILED");
    expect(failed.panels).toContainEqual({
      type: "candidates",
      planId: view.id,
      items: ["Kaydet", "Farklı Kaydet"],
    });
    const next = await plans.choose(view.id, 2);
    expect(next.steps.map(({ action, args }) => ({ action, args }))).toEqual([
      { action: "ui.click", args: { target: "Farklı Kaydet" } },
      { action: "key.shortcut", args: { keys: "ctrl+s" } },
    ]);
    expect(next.status).toBe("RUNNING");
    await status(next.id, "COMPLETED");
    await expect(plans.choose(view.id, 1)).rejects.toThrow("PLAN_ALREADY_CONTINUED");
  });

  it("replans once after an observed failure, through claude-code only", async () => {
    start([
      desktop(() => ({
        ok: false,
        evidence: "observed-failure",
        observation: "no window titled Spotify",
      })),
      gemini(),
      claude(
        () =>
          '```json\n{"intent":{"kind":"plan","goal":"Spotify\'a geç","steps":[{"action":"app.focus","args":{"name":"Spotify"}}]}}\n```',
      ),
    ]);
    const view = await propose([step("app.open", { name: "Spotify" })], "Spotify");
    await pastReplyWindow(view.id);
    await status(view.id, "FAILED");
    const replan = await until(
      () => views.find((v) => v.id !== view.id),
      (found) => found !== undefined,
    );
    expect(replan?.steps.map((s) => s.action)).toEqual(["app.focus"]);
    await pastReplyWindow(replan!.id);
    await status(replan!.id, "FAILED");
    await spoken();
    await delay(700);
    expect(prompts["claude-code"]).toHaveLength(1);
    expect(prompts["claude-code"]?.[0]).toContain("no window titled Spotify");
    expect(prompts["gemini-live"]).toBeUndefined();
    expect(announced.map((a) => a.text)).toEqual(["Bunu tamamlayamadım, efendim."]);
  });
  it("does not cancel a newer plan when an old replan finishes late", async () => {
    let release: (() => void) | undefined;
    start([
      desktop(() => ({ ok: false, evidence: "observed-failure", observation: "not found" })),
      claude(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return '{"intent":{"kind":"plan","goal":"retry","steps":[{"action":"app.focus","args":{"name":"Spotify"}}]}}';
      }),
    ]);
    const old = await propose([step("app.open", { name: "Spotify" })]);
    await status(old.id, "FAILED");
    await until(
      () => release,
      (value) => value !== undefined,
    );
    const newer = await propose([close]);
    expect(newer.status).toBe("AWAITING_APPROVAL");
    release?.();
    await until(
      () => announced.length,
      (count) => count > 0,
    );
    expect((await plans.get(newer.id)).status).toBe("AWAITING_APPROVAL");
    expect((await db.query("SELECT id FROM plans")).rows).toHaveLength(2);
  });
});

describe("restart", () => {
  it("a new PlanService over the same database converges", async () => {
    runWorker([desktop(), newsFeed(), gemini()]);
    // The first service never refreshes, as if Core stopped right after admission.
    plans = service();
    const pending = await propose([close]);
    const brief = await propose([news], "Haberler");
    await db.query("UPDATE plans SET expires_at=$2 WHERE id=$1", [pending.id, Date.now() - 1]);
    await until(
      () => tasks.list({ limit: 10 }) as Promise<{ status: string }[]>,
      (rows) => rows.some((row) => row.status === "COMPLETED"),
    );
    plans = service();
    plans.start(stop.signal);
    await status(pending.id, "CANCELLED");
    await status(brief.id, "COMPLETED");
  });
});
