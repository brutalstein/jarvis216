import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/core/database.js";
import {
  boot,
  database,
  FakeModel,
  type Running,
  type Services,
  Stream,
  services,
  until,
} from "./harness.js";

// End to end through the composition root: HTTP API, live stream, workers, real executors
// against fake services (browser worker, OpenClaw, n8n, Windows-MCP over stdio).

let db: Database;
let drop: () => Promise<void>;
let fakes: Services;
let model: FakeModel;
let running: Running;
let stream: Stream;

const plan = (goal: string, steps: { action: string; args: Record<string, unknown> }[]) => ({
  intent: { kind: "plan", goal, steps },
});
const read = (expected: string[] = ["Reuters", "BBC"]) =>
  plan("Haberlere bak", [
    {
      action: "browser.read_many",
      args: {
        pages: [
          { url: "https://www.reuters.com/", expectedText: expected[0] },
          { url: "https://bbc.com/", expectedText: expected[1] },
        ],
      },
    },
  ]);
const say = async (utterance: string) => {
  const response = await running.api<{ say: string; planId?: string; provider: string | null }>(
    "POST",
    "/v1/conversation/turns",
    { utterance },
  );
  expect(response.status).toBe(200);
  return response.body;
};
const planOf = (id: string) =>
  until(
    () => stream.plans.get(id),
    (view) => view !== undefined,
  );
// The exact Core action approval a HIGH step is waiting for, from the plan card.
const approvalOf = (view: Record<string, unknown> | undefined) =>
  (view?.steps as { approval?: { id: string } }[] | undefined)?.[0]?.approval?.id ?? "";
const settled = (id: string, status = "COMPLETED") =>
  until(
    () => stream.plans.get(id),
    (view) => view?.status === status,
    20_000,
  );

beforeEach(async () => {
  ({ db, drop } = await database());
  fakes = await services();
  model = new FakeModel();
  running = await boot(db, fakes.env, model);
  stream = new Stream(running);
}, 60_000);
afterEach(async () => {
  await stream.close();
  await running.stop();
  await fakes.close();
  await drop();
}, 60_000);

describe("the HTTP surface", () => {
  it("answers liveness openly and refuses every other route without the right credential", async () => {
    expect((await running.api("GET", "/healthz", undefined, "")).status).toBe(200);
    const tree = running.core.server.printRoutes({ commonPrefix: false });
    const routes: { method: string; url: string }[] = [];
    const stack: string[] = [];
    for (const line of tree.split("\n")) {
      const match = /^([│ ]*)(?:├── |└── )(\S+)(?: \(([^)]*)\))?/.exec(line);
      if (!match) continue;
      const depth = (match[1] ?? "").length / 4;
      stack.length = depth;
      stack.push(match[2] ?? "");
      for (const method of (match[3] ?? "").split(", ").filter((m) => m && m !== "HEAD"))
        routes.push({ method, url: stack.join("") });
    }
    expect(routes.length).toBeGreaterThan(30);
    for (const { method, url } of routes) {
      if (url === "/healthz") continue;
      const path = url.replaceAll(":id", randomUUID());
      const hook = path.startsWith("/v1/hooks/");
      for (const token of ["", hook ? running.token : running.webhook]) {
        const response = await running.api(method, path, method === "GET" ? undefined : {}, token);
        expect([method, url, token ? "wrong" : "none", response.status]).toEqual([
          method,
          url,
          token ? "wrong" : "none",
          401,
        ]);
      }
    }
  });
});

describe("talking while JARVIS works", () => {
  it("acknowledges research at once, streams where it looks and speaks the result", async () => {
    model.turns.push(read());
    model.briefs.push("Reuters'ta piyasalar sakin, BBC seçimleri yazıyor.");
    const ack = await say("Jarvis, Reuters ve BBC'de ne var bak");
    expect(ack.say).toMatch(/^Reuters\.com ve bbc\.com sayfalarına bakıyorum, efendim; .* sürer\./);
    const id = ack.planId ?? "";
    const done = await settled(id);
    expect(done?.say).toBe("Reuters'ta piyasalar sakin, BBC seçimleri yazıyor.");
    const details = stream.history
      .filter((view) => view.id === id)
      .map((view) => (view.progress as { detail?: string } | undefined)?.detail)
      .filter(Boolean);
    expect(details).toContain("reuters.com");
    // The outcome is announced once the reply window has passed, tagged for the voice queue.
    const outcome = await until(
      () => stream.announcements.find((a) => a.planId === id && a.kind === "outcome"),
      (a) => a !== undefined,
      15_000,
    );
    expect(outcome?.text).toBe("Reuters'ta piyasalar sakin, BBC seçimleri yazıyor.");
    expect(fakes.browser.calls).toHaveLength(1);
  });

  it("answers a status question and stops the research by voice", async () => {
    let release = () => {};
    fakes.browser.gate = new Promise((resolve) => {
      release = resolve;
    });
    model.turns.push(read());
    const ack = await say("Jarvis, haberlere bak");
    const id = ack.planId ?? "";
    await until(
      () => stream.plans.get(id),
      (view) => (view?.progress as { detail?: string } | undefined)?.detail === "reuters.com",
    );
    const status = await say("Jarvis, durum ne?");
    expect(status.provider).toBeNull();
    expect(status.say).toMatch(/^Haberlere bak: şu an reuters\.com sayfasını okuyorum/);
    const stop = await say("dur");
    expect(stop.provider).toBeNull();
    // A page read changes nothing, so stopping it mid-request is a clean cancel.
    expect(stop.say).toBe("İptal ettim, efendim.");
    const view = await until(
      () => stream.plans.get(id),
      (current) => current?.status !== "RUNNING",
    );
    expect(view?.status).toBe("CANCELLED");
    release();
  });

  it("says plainly when a page does not hold what was expected", async () => {
    model.turns.push(read(["Reuters", "not on the page"]));
    const ack = await say("Jarvis, haberlere bak");
    const failed = await settled(ack.planId ?? "", "FAILED");
    expect(failed?.say).toBe("Bunu tamamlayamadım, efendim.");
  });
});

describe("desktop actions and approvals", () => {
  it("opens at once, waits for a tap to close, and closes the exact window", async () => {
    model.turns.push(
      plan("Not Defteri aç", [{ action: "app.open", args: { name: "Not Defteri" } }]),
    );
    expect((await say("Jarvis, Not Defteri'ni aç")).say).toBe("Not Defteri açıldı, efendim.");
    model.turns.push(
      plan("Not Defteri'ni kapat", [{ action: "app.close", args: { name: "Not Defteri" } }]),
    );
    const asked = await say("Jarvis, Not Defteri'ni kapat");
    expect(asked.say).toBe("Not Defteri'ni kapat: onayınızı bekliyorum, efendim.");
    const card = await planOf(asked.planId ?? "");
    expect(card?.status).toBe("AWAITING_APPROVAL");
    expect(
      (await running.api("POST", `/v1/plans/${card?.id}/approve`, { hash: "forged" })).status,
    ).toBe(409);
    expect(
      (await running.api("POST", `/v1/plans/${card?.id}/approve`, { hash: card?.hash })).status,
    ).toBe(204);
    const done = await settled(asked.planId ?? "");
    expect(done?.say).toBe("Not Defteri kapatıldı, efendim.");
  });

  it("runs an action allowed in Settings without a card, records the grant, and refuses a denied one", async () => {
    const allowed = await running.api<{ actions: { id: string; mode: string }[] }>(
      "PUT",
      "/v1/permissions",
      {
        actions: { "app.close": { mode: "allow" } },
      },
    );
    expect(allowed.body.actions.find((a) => a.id === "app.close")?.mode).toBe("allow");
    model.turns.push(
      plan("Not Defteri aç", [{ action: "app.open", args: { name: "Not Defteri" } }]),
    );
    await say("Jarvis, Not Defteri'ni aç");
    model.turns.push(plan("Kapat", [{ action: "app.close", args: { name: "Not Defteri" } }]));
    expect((await say("Jarvis, Not Defteri'ni kapat")).say).toBe("Not Defteri kapatıldı, efendim.");
    const listed = await running.api<{ id: string; capability: string }[]>(
      "GET",
      "/v1/tasks?limit=20",
    );
    const steps = listed.body.filter((task) => task.capability === "desktop.act");
    const events = await Promise.all(
      steps.map((task) =>
        running.api<{ envelope: { type: string; payload: Record<string, unknown> } }[]>(
          "GET",
          `/v1/tasks/${task.id}/events`,
        ),
      ),
    );
    const grants = events
      .flatMap((e) => e.body)
      .filter((e) => e.envelope.type === "approval.granted");
    expect(grants.map((g) => g.envelope.payload)).toContainEqual(
      expect.objectContaining({ via: "standing-grant", action: "app.close" }),
    );
    await running.api("PUT", "/v1/permissions", { actions: { "app.close": { mode: "deny" } } });
    model.turns.push(plan("Kapat", [{ action: "app.close", args: { name: "Spotify" } }]));
    expect((await say("Jarvis, Spotify'ı kapat")).say).toBe("Bu işlem ayarlarda kapalı, efendim.");
    const audit = await running.api<{ entries: unknown[] }>("GET", "/v1/permissions/audit");
    expect(audit.body.entries).toHaveLength(2);
  });
});

describe("high-risk integrations", () => {
  it("delegates to the agent only after the plan tap and the exact action approval", async () => {
    model.turns.push(
      plan("Tedarikçileri karşılaştır", [
        { action: "agent.delegate", args: { instruction: "Üç tedarikçiyi karşılaştır" } },
      ]),
    );
    model.briefs.push("Ajan üç tedarikçiyi karşılaştırdı, efendim.");
    const asked = await say("Jarvis, tedarikçileri ajana karşılaştırt");
    const card = await planOf(asked.planId ?? "");
    await running.api("POST", `/v1/plans/${card?.id}/approve`, { hash: card?.hash });
    const waiting = await until(
      () => stream.plans.get(card?.id as string),
      (view) =>
        Boolean((view?.steps as { approval?: { id: string } }[] | undefined)?.[0]?.approval),
    );
    expect(fakes.openclaw.calls).toHaveLength(0);
    const approved = await running.api("POST", `/v1/actions/${approvalOf(waiting)}/approve`, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(approved.status).toBe(204);
    const done = await settled(card?.id as string);
    expect(done?.say).toBe("Ajan üç tedarikçiyi karşılaştırdı, efendim.");
    expect(fakes.openclaw.calls[0]).toMatchObject({
      agent: "jarvis-e2e",
      body: { tools: [], tool_choice: "none", input: "Üç tedarikçiyi karşılaştır" },
    });
  });

  it("invokes a registered n8n workflow with its idempotency key after both approvals", async () => {
    model.turns.push(
      plan("Günlük raporu gönder", [
        {
          action: "automation.invoke",
          args: { workflow: "daily-report", payload: { day: "pazartesi" } },
        },
      ]),
    );
    const asked = await say("Jarvis, günlük raporu gönder");
    const card = await planOf(asked.planId ?? "");
    await running.api("POST", `/v1/plans/${card?.id}/approve`, { hash: card?.hash });
    const waiting = await until(
      () => stream.plans.get(card?.id as string),
      (view) =>
        Boolean((view?.steps as { approval?: { id: string } }[] | undefined)?.[0]?.approval),
    );
    await running.api("POST", `/v1/actions/${approvalOf(waiting)}/approve`, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await settled(card?.id as string);
    const [call] = fakes.workflow.calls;
    expect(call?.body).toMatchObject({
      protocolVersion: 1,
      payload: { day: "pazartesi" },
      workflowVersion: "1",
    });
    expect(call?.key).toBe((call?.body as { taskId?: string } | undefined)?.taskId);
    expect(call?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("takes an n8n task on its own credential and pushes its outcomes back", async () => {
    const submitted = await running.api<{ id: string }>(
      "POST",
      "/v1/hooks/n8n",
      {
        eventId: "evt-1",
        sentAt: new Date().toISOString(),
        objective: "Tedarikçileri karşılaştır",
        verificationText: "tedarikçi",
      },
      running.webhook,
    );
    expect(submitted.status).toBe(202);
    const id = submitted.body.id;
    await until(
      () => fakes.callbacks,
      (list) => list.some((c) => (c as { status: string }).status === "WAITING_FOR_APPROVAL"),
    );
    const actions = await running.api<{ id: string; status: string }[]>(
      "GET",
      `/v1/tasks/${id}/actions`,
    );
    const pending = actions.body.find((a) => a.status === "AWAITING_APPROVAL");
    await running.api("POST", `/v1/actions/${pending?.id}/approve`, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const pushed = await until(
      () => fakes.callbacks,
      (list) => list.some((c) => (c as { status: string }).status === "COMPLETED"),
      20_000,
    );
    expect(pushed.find((c) => (c as { status: string }).status === "COMPLETED")).toMatchObject({
      taskId: id,
      result: { text: "Ajan raporu: üç tedarikçi karşılaştırıldı." },
    });
    expect(
      (await running.api("GET", `/v1/hooks/n8n/tasks/${id}`, undefined, running.webhook)).status,
    ).toBe(200);
    expect((await running.api("GET", `/v1/hooks/n8n/tasks/${id}`)).status).toBe(401);
  });
});

describe("learning, restarts and forgetting", () => {
  it("turns practice into a reflex that survives a restart, with Settings and timings", async () => {
    await running.api("PUT", "/v1/permissions", { settings: { learning: true, reflexes: true } });
    for (let i = 0; i < 3; i++) {
      model.turns.push(plan("Spotify aç", [{ action: "app.open", args: { name: "Spotify" } }]));
      expect((await say("Jarvis, Spotify'ı aç")).say).toBe("Spotify açıldı, efendim.");
    }
    const learned = await until(
      () => running.api<{ stats: { skills: number } }>("GET", "/v1/brain"),
      (r) => r.body.stats.skills === 1,
    );
    expect(learned.body.stats.skills).toBe(1);
    const prompts = model.prompts.length;
    const reflex = await say("Jarvis, Spotify'ı aç");
    expect(reflex.provider).toBeNull();
    expect(model.prompts).toHaveLength(prompts);
    const measured = running.core.durations.estimate("app.open");
    await stream.close();
    await running.stop();
    running = await boot(db, fakes.env, model);
    stream = new Stream(running);
    const again = await say("Jarvis, Spotify'ı aç lütfen");
    expect(again.provider).toBeNull();
    expect(again.say).toBe("Spotify açıldı, efendim.");
    expect(running.core.durations.estimate("app.open")).toBe(measured);
    expect(running.core.permissions.settings()).toEqual({ learning: true, reflexes: true });
  });

  it("forgets conversations and what was learned on request, and old ones on schedule", async () => {
    model.turns.push(plan("Spotify aç", [{ action: "app.open", args: { name: "Spotify" } }]));
    await say("Jarvis, Spotify'ı aç");
    await db.query(
      "INSERT INTO conversation_turns(id,created_at,utterance,follow_up,task_id,reply,provider) VALUES($1,$2,'eski',false,NULL,'{\"say\":\"eski\"}','x')",
      [randomUUID(), Date.now() - 40 * 86_400_000],
    );
    await running.core.maintain();
    const kept = await running.api<{ turns: { utterance: string }[] }>(
      "GET",
      "/v1/conversation/turns",
    );
    expect(kept.body.turns.map((t) => t.utterance)).toEqual(["Jarvis, Spotify'ı aç"]);
    expect((await running.api("DELETE", "/v1/conversation/turns")).status).toBe(204);
    expect(
      (await running.api<{ turns: unknown[] }>("GET", "/v1/conversation/turns")).body.turns,
    ).toEqual([]);
    const brain = await running.api<{ stats: { experiences: number } }>("GET", "/v1/brain");
    expect(brain.body.stats.experiences).toBe(0);
  });
});
