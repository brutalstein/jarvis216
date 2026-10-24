import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { coreSecret, launch } from "./helpers";

const shots = resolve("../../artifacts/ui");

// Core's health endpoints on the port the test .env names; readiness can lag like a cold start.
function fakeCore(readyDelayMs = 0): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url === "/healthz") return response.writeHead(200).end('{"status":"alive"}');
    if (request.url === "/readyz") {
      if (request.headers.authorization !== `Bearer ${coreSecret}`)
        return response.writeHead(401).end();
      setTimeout(() => response.writeHead(200).end('{"database":"ready"}'), readyDelayMs);
      return;
    }
    response.writeHead(404).end();
  });
  return new Promise((done) => server.listen(2161, "127.0.0.1", () => done(server)));
}

// CDP screenshots stall on a transparent frameless window; the native capture does not.
async function capture(app: ElectronApplication, title: string, file: string) {
  // Let the last status paint and its transitions settle.
  await new Promise((done) => setTimeout(done, 800));
  const png = await app.evaluate(async ({ BrowserWindow }, name) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === name);
    return (await window?.capturePage())?.toPNG().toString("base64") ?? "";
  }, title);
  expect(png.length).toBeGreaterThan(0);
  await mkdir(shots, { recursive: true });
  await writeFile(`${shots}/${file}`, Buffer.from(png, "base64"));
}

const visible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.isVisible())
      .map((w) => w.webContents.getURL().split("/").at(-1)),
  );

test("the main window waits behind the loading screen until Core and its database answer", async () => {
  const run = await launch({ boot: true });
  let core: Server | undefined;
  try {
    const splash = run.page;
    // Core is down: its step fails, the database waits on it, and nothing else opens.
    await expect(splash.locator("body")).toHaveAttribute("data-phase", "failed");
    await expect(splash.locator('[data-step="config"]')).toHaveAttribute("data-state", "ready");
    await expect(splash.locator('[data-step="core"]')).toHaveAttribute("data-state", "failed");
    await expect(splash.locator('[data-step="database"]')).toHaveAttribute("data-state", "waiting");
    await expect(splash.locator('[data-step="openclaw"]')).toHaveAttribute("data-state", "skipped");
    await expect(splash.locator('[data-step="voice"]')).toHaveAttribute("data-state", "ready");
    await expect(splash.getByRole("alert")).toHaveText("Çekirdek: Çekirdeğe ulaşılamadı.");
    await expect(splash.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
    expect(await visible(run.app)).toEqual(["splash.html"]);
    expect(run.app.windows().some((page) => page.url().endsWith("/index.html"))).toBe(false);
    await capture(run.app, "J.A.R.V.I.S", "boot-failed.png");

    // Core comes up with a slow database: the loading screen shows the check in progress.
    core = await fakeCore(2500);
    await splash.getByRole("button", { name: "Tekrar dene" }).click();
    await expect(splash.locator('[data-step="database"]')).toHaveAttribute("data-state", "running");
    await expect(splash.locator('[data-step="core"] .boot-detail')).toHaveText("Zaten çalışıyor");
    await expect(splash.getByRole("alert")).toBeHidden();
    await capture(run.app, "J.A.R.V.I.S", "boot-running.png");

    // Everything answered: the main window opens and the loading screen goes away.
    await expect.poll(() => visible(run.app), { timeout: 15_000 }).toEqual(["index.html"]);
    const main = run.app.windows().find((page) => page.url().endsWith("/index.html"));
    if (!main) throw new Error("MAIN_WINDOW_MISSING");
    await expect(main.locator(".wordmark")).toHaveText("J.A.R.V.I.S");
    await expect(main).toHaveTitle("J.A.R.V.I.S");
    // The renderer's first voice request found its handler: no start-up error notice.
    await expect(main.locator("body")).toHaveAttribute("data-state", "listening");
  } finally {
    await run.close();
    core?.close();
  }
});

test("the loading screen's close button quits JARVIS", async () => {
  const run = await launch({ boot: true });
  try {
    await expect(run.page.locator("body")).toHaveAttribute("data-phase", "failed");
    const closed = run.app.waitForEvent("close");
    await run.page.getByRole("button", { name: "Kapat" }).first().click();
    await closed;
  } finally {
    await run.close();
  }
});
