import { mkdir } from "node:fs/promises";
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
    await expect(run.page.locator("[data-news]").first()).toContainText(items[0].headline);
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
      shell.openExternal = async (url: string) => { Reflect.set(globalThis, "openedNews", url); };
    });
    const news = { ...plan, id: "stream-news", panels: [{ type: "news", title: "Bugün", items: [{ headline: "Başlık", source: "Kaynak", publishedAt: "2026-10-18", url: "https://news.example/known" }] }] };
    (stream as ServerResponse | undefined)?.write(`event: plan\ndata: ${JSON.stringify(news)}\n\n`);
    await expect(run.page.locator("[data-news]")).toHaveCount(1);
    await run.page.locator("[data-news]").click();
    await expect.poll(() => run.app.evaluate(() => Reflect.get(globalThis, "openedNews"))).toBe("https://news.example/known");
    (stream as ServerResponse | undefined)?.write('event: announce\ndata: {"text":"İşlem tamamlandı.","lang":"tr"}\n\n');
    await expect(run.page.locator("[data-caption]")).toHaveText("İşlem tamamlandı.");
    const previous = stream as ServerResponse | undefined;
    stream = undefined;
    previous?.end();
    await expect.poll(() => Boolean(stream)).toBe(true);
    (stream as ServerResponse | undefined)?.write(`event: plan\ndata: ${JSON.stringify({ ...plan, status: "CANCELLED" })}\n\n`);
    await expect(run.page.locator("[data-hud-card=hud-plan]")).toHaveAttribute("data-plan-status", "CANCELLED");
  } finally {
    await run.close();
  }
});
