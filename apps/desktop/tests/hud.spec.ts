import { mkdir, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { PlanView } from "../src/shared";
import { coreSecret, emit, launch } from "./helpers";

const shots = resolve("tests/screenshots");
const calls: { url: string; body: string; authorization?: string }[] = [];
let stream: ServerResponse | undefined;
let streamAuthorization: string | undefined;
const server = createServer((request, response) => {
  if (request.url === "/v1/stream") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(": ready\n\n");
    stream = response;
    streamAuthorization = request.headers.authorization;
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += String(chunk);
  });
  request.on("end", () => {
    calls.push({ url: request.url ?? "", body, authorization: request.headers.authorization });
    response.writeHead(204).end();
  });
});
const plan: PlanView = {
  id: "hud-plan",
  goal: "Not Defteri’ni kapat",
  lang: "tr",
  kind: "desktop",
  status: "AWAITING_APPROVAL",
  hash: "bound-plan-hash",
  needsApproval: true,
  expiresAt: Date.now() + 120000,
  steps: [
    {
      action: "app.close",
      args: { name: "Notepad" },
      risk: "MEDIUM",
      mode: "ask",
      status: "WAITING_FOR_APPROVAL",
    },
  ],
  panels: [],
};

test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
  await new Promise<void>((done) => server.listen(2161, "127.0.0.1", done));
});
test.afterAll(async () => {
  stream?.end();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

test("approval keyboard actions bind the exact hash and ignore settings inputs", async () => {
  const run = await launch();
  await run.page.emulateMedia({ reducedMotion: "reduce" });
  calls.length = 0;
  try {
    await emit(run.app, { type: "plan", plan });
    await expect(run.page.getByRole("heading", { name: plan.goal })).toBeVisible();
    await expect(run.page.locator("[data-risk]")).toHaveText("Onay gerekir");
    await run.page.screenshot({ path: `${shots}/approval.png` });
    await run.page.keyboard.press("Enter");
    await expect
      .poll(() => calls.find((call) => call.url.endsWith("/approve")))
      .toEqual({
        url: "/v1/plans/hud-plan/approve",
        body: JSON.stringify({ hash: plan.hash }),
        authorization: `Bearer ${coreSecret}`,
      });
    await emit(run.app, { type: "plan", plan: { ...plan, id: "reject-plan" } });
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    await run.page.locator("#microphone").focus();
    await run.page.keyboard.press("Enter");
    expect(calls.some((call) => call.url.includes("reject-plan"))).toBe(false);
    await run.page.getByRole("button", { name: "Kapat", exact: true }).click();
    await run.page.locator("body").click({ position: { x: 20, y: 100 } });
    await run.page.keyboard.press("Escape");
    await expect
      .poll(() => calls.some((call) => call.url.endsWith("/reject-plan/reject")))
      .toBe(true);
  } finally {
    await run.close();
  }
});
test("HIGH integration exposes its separate action approval", async () => {
  stream = undefined;
  const run = await launch();
  calls.length = 0;
  try {
    await expect.poll(() => Boolean(stream)).toBe(true);
    (stream as ServerResponse | undefined)?.write(
      `event: plan\ndata: ${JSON.stringify({
        ...plan,
        status: "RUNNING",
        kind: "integration",
        needsApproval: false,
        steps: [
          {
            action: "agent.delegate",
            args: { instruction: "work" },
            risk: "HIGH",
            status: "WAITING_FOR_APPROVAL",
            approval: { id: "11111111-1111-4111-8111-111111111111", target: "openclaw" },
          },
        ],
      })}\n\n`,
    );
    await run.page.getByRole("button", { name: "openclaw işlemini onayla" }).click();
    await expect
      .poll(() => calls.find((call) => call.url.includes("/v1/actions/")))
      .toMatchObject({ url: "/v1/actions/11111111-1111-4111-8111-111111111111/approve" });
    expect(run.page.locator("[data-risk]")).toHaveText("Ayrı onay gerekir");
  } finally {
    await run.close();
  }
});

test("news, candidates and windows use text-only panels with a running control indicator", async () => {
  const run = await launch();
  await run.page.emulateMedia({ reducedMotion: "reduce" });
  calls.length = 0;
  try {
    await emit(run.app, {
      type: "plan",
      plan: {
        ...plan,
        status: "FAILED",
        needsApproval: false,
        panels: [
          { type: "candidates", planId: plan.id, items: ["Birinci pencere", "İkinci pencere"] },
        ],
      },
    });
    await run.page.getByRole("button", { name: "2. İkinci pencere" }).click();
    await expect
      .poll(() => calls.find((call) => call.url.endsWith("/choose"))?.body)
      .toBe('{"index":2}');
    await run.page.screenshot({ path: `${shots}/candidates-failure.png` });
    const items = Array.from({ length: 5 }, (_, i) => ({
      headline: `<b>Haber ${i + 1}</b>`,
      source: "Kaynak",
      publishedAt: "2026-10-18T09:00:00Z",
      url: `https://news.example/${i}`,
    }));
    await emit(run.app, {
      type: "plan",
      plan: {
        ...plan,
        id: "news",
        goal: "Bugünün haberleri",
        kind: "info",
        status: "COMPLETED",
        needsApproval: false,
        steps: [{ action: "news.brief", args: {}, risk: "LOW", status: "COMPLETED" }],
        panels: [{ type: "news", title: "Bugün", items }],
      },
    });
    await expect(run.page.locator("[data-news]")).toHaveCount(5);
    await expect(run.page.locator("[data-news]").first()).toContainText("Haber 1");
    await expect(run.page.locator("[data-news]").first()).not.toContainText("<b>");
    expect(await run.page.locator("[data-news] b").count()).toBe(0);
    await run.page.screenshot({ path: `${shots}/news.png` });
    await emit(run.app, {
      type: "plan",
      plan: {
        ...plan,
        status: "RUNNING",
        needsApproval: false,
        steps: [
          { action: "app.close", args: { name: "Notepad" }, risk: "MEDIUM", status: "RUNNING" },
        ],
        panels: [{ type: "windows", items: ["Not Defteri", "Spotify"] }],
      },
    });
    await expect(run.page.locator("[data-control]")).toBeVisible();
    await expect(run.page.locator("[data-plan-status=RUNNING] [data-step-status]")).toHaveText(
      "İşlem sürüyor",
    );
    await run.page.screenshot({ path: `${shots}/progress.png` });
    const overlay = run.app.windows().find((page) => page.url().endsWith("/overlay.html"));
    if (!overlay) throw new Error("OVERLAY_MISSING");
    await overlay.emulateMedia({ reducedMotion: "reduce" });
    await expect(overlay.locator("[data-control]")).toBeVisible();
    await overlay.screenshot({ path: `${shots}/overlay-control.png` });
    await emit(run.app, {
      type: "plan",
      plan: { ...plan, status: "COMPLETED", needsApproval: false },
    });
    await expect(overlay.locator("[data-control]")).toBeHidden();
  } finally {
    await run.close();
  }
});

test("authenticated SSE delivers plans; arbitrary external URLs cannot open", async () => {
  stream = undefined;
  const run = await launch();
  try {
    await expect.poll(() => Boolean(stream)).toBe(true);
    expect(streamAuthorization).toBe(`Bearer ${coreSecret}`);
    (stream as ServerResponse | undefined)?.write(`event: plan\ndata: ${JSON.stringify(plan)}\n\n`);
    await expect(run.page.getByRole("heading", { name: plan.goal })).toBeVisible();
    await expect(
      run.page.evaluate(() => window.jarvis.plans.open("https://unknown.example/")),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      run.page.evaluate(() => window.jarvis.plans.approve("../escape", "hash")),
    ).rejects.toThrow("INVALID_PLAN");
    await run.app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        Reflect.set(globalThis, "openedNews", url);
      };
    });
    const news = {
      ...plan,
      id: "stream-news",
      panels: [
        {
          type: "news",
          title: "Bugün",
          items: [
            {
              headline: "Başlık",
              source: "Kaynak",
              publishedAt: "2026-10-18",
              url: "https://news.example/known",
            },
          ],
        },
      ],
    };
    (stream as ServerResponse | undefined)?.write(`event: plan\ndata: ${JSON.stringify(news)}\n\n`);
    await expect(run.page.locator("[data-news]")).toHaveCount(1);
    await run.page.locator("[data-news]").click();
    await expect
      .poll(() => run.app.evaluate(() => Reflect.get(globalThis, "openedNews")))
      .toBe("https://news.example/known");
    (stream as ServerResponse | undefined)?.write(
      'event: announce\ndata: {"text":"İşlem tamamlandı.","lang":"tr"}\n\n',
    );
    await expect(run.page.locator("[data-caption]")).toHaveText("İşlem tamamlandı.");
    const previous = stream as ServerResponse | undefined;
    stream = undefined;
    previous?.end();
    await expect.poll(() => Boolean(stream)).toBe(true);
    (stream as ServerResponse | undefined)?.write(
      `event: plan\ndata: ${JSON.stringify({ ...plan, status: "CANCELLED" })}\n\n`,
    );
    await expect(run.page.locator("[data-hud-card=hud-plan]")).toHaveAttribute(
      "data-plan-status",
      "CANCELLED",
    );
  } finally {
    await run.close();
  }
});

test("a guide tracks ticked steps, opens its first official page once and verifies the pasted key", async () => {
  stream = undefined;
  // The vendor's check address: accepts only the right key, in the header the guide named.
  const vendor = createServer((request, response) => {
    response.writeHead(request.headers["x-n8n-api-key"] === "good-key" ? 200 : 401).end("{}");
  });
  await new Promise<void>((done) => vendor.listen(0, "127.0.0.1", done));
  const port = (vendor.address() as { port: number }).port;
  const run = await launch();
  try {
    await expect.poll(() => Boolean(stream)).toBe(true);
    await run.app.evaluate(({ shell }) => {
      Reflect.set(globalThis, "opened", []);
      shell.openExternal = async (url: string) => {
        (Reflect.get(globalThis, "opened") as string[]).push(url);
      };
    });
    const opened = () => run.app.evaluate(() => Reflect.get(globalThis, "opened") as string[]);
    const guide: PlanView = {
      ...plan,
      id: "guide-plan",
      goal: "n8n API anahtarı",
      kind: "integration",
      status: "RUNNING",
      needsApproval: false,
      steps: [
        {
          action: "help.guide",
          args: { topic: "n8n API key for JARVIS automations" },
          risk: "LOW",
          mode: "allow",
          status: "RUNNING",
        },
      ],
    };
    const send = (value: PlanView) =>
      (stream as ServerResponse | undefined)?.write(
        `event: plan\ndata: ${JSON.stringify(value)}\n\n`,
      );
    send(guide);
    await expect(run.page.locator("[data-hud-card=guide-plan]")).toBeVisible();
    send({
      ...guide,
      status: "COMPLETED",
      panels: [
        {
          type: "guide",
          title: "n8n API anahtarı",
          steps: ["Açılan n8n sayfasında giriş yap.", "Create an API key düğmesine bas."],
          links: [
            { label: "n8n API ayarları", url: "http://127.0.0.1:5678/settings/api" },
            { label: "Dokümantasyon", url: "https://docs.n8n.io/api/authentication/" },
          ],
          sources: ["https://docs.n8n.io/api/authentication/"],
          where: ".env içindeki N8N_API_KEY= satırına yapıştır.",
          check: {
            env: "N8N_API_KEY",
            verify: {
              url: `http://127.0.0.1:${port}/api/v1/workflows?limit=1`,
              in: "header",
              name: "X-N8N-API-KEY",
            },
          },
        },
      ],
    });
    const card = run.page.locator("[data-panel=guide]");
    await expect(card.locator(".guide-steps li")).toHaveCount(2);
    const status = card.locator(".guide-status");
    await expect(status).toContainText("Bekliyorum");
    await expect(card.locator(".guide-steps li").first()).toHaveAttribute("data-state", "active");
    await card.locator(".guide-step").first().click();
    await expect(card.locator(".guide-progress")).toHaveText("1/2 adım tamam");
    await expect(card.locator(".guide-steps li").nth(1)).toHaveAttribute("data-state", "active");
    // Another plan's update re-renders the HUD; the ticks and the field survive it.
    send({ ...plan, id: "other-plan", status: "RUNNING" });
    await expect(card.locator(".guide-progress")).toHaveText("1/2 adım tamam");
    const field = card.locator(".guide-check input");
    await expect(field).toHaveAttribute("type", "password");
    await field.fill("bad-key");
    await card.locator(".guide-check button").click();
    await expect(status).toContainText("çalışmadı");
    await expect(field).toHaveValue("");
    expect(await readFile(run.file, "utf8")).not.toContain("N8N_API_KEY");
    await field.fill("good-key");
    await card.locator(".guide-check button").click();
    await expect(status).toContainText("Doğrulandı");
    await expect(card.locator(".guide-progress")).toHaveText("2/2 adım tamam");
    await expect(field).toBeHidden();
    const saved = await readFile(run.file, "utf8");
    expect(saved).toContain("N8N_API_KEY=good-key");
    expect(saved).toContain(`JARVIS_TOKEN=${coreSecret}`);
    // The renderer never learns what .env holds, and cannot check a plan without a guide.
    await expect(run.page.evaluate(() => window.jarvis.plans.guide("other-plan"))).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(card.locator(".guide-where")).toContainText("N8N_API_KEY");
    await expect(card.locator(".guide-sources")).toHaveText("Resmi kaynak: docs.n8n.io");
    await expect.poll(opened).toEqual(["http://127.0.0.1:5678/settings/api"]);
    await card.locator("[data-guide-link]").nth(1).click();
    await expect
      .poll(opened)
      .toEqual(["http://127.0.0.1:5678/settings/api", "https://docs.n8n.io/api/authentication/"]);
    await run.page.screenshot({ path: `${shots}/guide.png` });
    await expect(
      run.page.evaluate(() => window.jarvis.plans.open("http://127.0.0.1:9999/other")),
    ).rejects.toThrow("FORBIDDEN");
  } finally {
    await run.close();
    vendor.close();
  }
});

test("a running plan shows where it looks, time spent and left; progress is not a caption", async () => {
  const run = await launch();
  try {
    const now = Date.now();
    const progress: NonNullable<PlanView["progress"]> = {
      step: 1,
      steps: 1,
      action: "browser.read_many",
      args: {},
      stage: "reading",
      detail: "bbc.com",
      index: 2,
      total: 3,
      startedAt: now - 12_000,
      stepStartedAt: now - 11_000,
      etaAt: now + 20_000,
    };
    const research: PlanView = {
      ...plan,
      id: "live-plan",
      goal: "Haberlere bak",
      kind: "integration",
      status: "RUNNING",
      needsApproval: false,
      steps: [
        {
          action: "browser.read_many",
          args: { pages: [{ url: "https://bbc.com/", expectedText: "BBC" }] },
          risk: "LOW",
          mode: "allow",
          status: "RUNNING",
        },
      ],
      progress,
    };
    await emit(run.app, { type: "plan", plan: research });
    const live = run.page.locator("[data-live=live-plan]");
    await expect(live).toHaveText(/^bbc\.com okunuyor · 2\/3 · 1[23] sn · ~(19|20) sn kaldı$/);
    await expect(run.page.getByRole("progressbar", { name: "Tahmini ilerleme" })).toHaveAttribute(
      "aria-valuenow",
      /^(3[5-9]|4[0-2])$/,
    );
    // The line keeps counting between Core's updates.
    await expect(live).toHaveText(/ 1[4-6] sn · /, { timeout: 4000 });
    await run.page.waitForTimeout(300);
    await run.page.screenshot({ path: `${shots}/live-progress.png` });
    await emit(run.app, {
      type: "announce",
      text: "Şimdi bbc.com sayfasını okuyorum; 1 sayfa daha var.",
      lang: "tr",
      kind: "progress",
      planId: "live-plan",
    });
    await expect(run.page.locator("[data-caption]")).not.toHaveText(/bbc\.com/);
    await emit(run.app, {
      type: "plan",
      plan: {
        ...research,
        progress: { ...progress, finishing: true, etaAt: now + 30_000 },
      },
    });
    await expect(live).toHaveText(/^Sonuçları derliyorum · /);
    await emit(run.app, {
      type: "plan",
      plan: { ...research, status: "COMPLETED", progress: undefined },
    });
    await expect(run.page.locator("[data-live]")).toHaveCount(0);
  } finally {
    await run.close();
  }
});
