import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { PermissionMode } from "../src/shared";
import { coreSecret, launch } from "./helpers";

// A fake Core: permissions, brain and memory endpoints the Settings use, recorded calls.
const shots = resolve("tests/screenshots");
type Action = {
  id: string;
  kind: string;
  risk: string;
  description: { tr: string; en: string };
  mode: PermissionMode;
  defaultMode: PermissionMode;
  expiresAt: number | null;
  available: boolean;
};
const actions = (): Action[] => [
  action("app.open", "desktop", "LOW", "Uygulama aç"),
  action("app.close", "desktop", "MEDIUM", "Uygulamayı kapat"),
  action("file.move", "desktop", "MEDIUM", "Dosya taşı"),
  action("memory.save", "memory", "MEDIUM", "Not hatırla"),
  { ...action("agent.delegate", "integration", "HIGH", "Uzman ajana görev ver"), available: false },
];
function action(id: string, kind: string, risk: string, tr: string): Action {
  const mode = risk === "LOW" ? "allow" : "ask";
  return {
    id,
    kind,
    risk,
    description: { tr, en: tr },
    mode,
    defaultMode: mode,
    expiresAt: null,
    available: true,
  };
}
let view = {
  version: 0,
  preset: "guarded",
  actions: actions(),
  settings: { learning: true, reflexes: true },
};
let skills = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    goal: "Spotify'ı aç",
    phrases: ["spotifyi ac"],
    steps: ["app.open"],
    strength: 0.83,
    successes: 3,
    uses: 1,
  },
];
let memories = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    note: "Kahvemi sade içerim",
    createdAt: Date.now(),
  },
];
const calls: { method: string; url: string; body: unknown; authorization?: string }[] = [];
const json = (response: import("node:http").ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};
const server = createServer((request, response) => {
  if (request.url === "/v1/stream") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(": ready\n\n");
    return;
  }
  let raw = "";
  request.on("data", (chunk) => {
    raw += String(chunk);
  });
  request.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    const url = request.url ?? "";
    const method = request.method ?? "GET";
    calls.push({ method, url, body, authorization: request.headers.authorization });
    if (url === "/v1/permissions" && method === "GET") return json(response, view);
    if (url === "/v1/permissions" && method === "PUT") {
      for (const [id, grant] of Object.entries(
        (body.actions ?? {}) as Record<string, { mode: PermissionMode; expiresInMs?: number }>,
      )) {
        const found = view.actions.find((a) => a.id === id);
        if (found) {
          found.mode = grant.mode;
          found.expiresAt = grant.expiresInMs ? Date.now() + grant.expiresInMs : null;
        }
      }
      view = {
        ...view,
        version: view.version + 1,
        preset: "custom",
        settings: { ...view.settings, ...body.settings },
      };
      return json(response, view);
    }
    if (url === "/v1/permissions/preset") {
      for (const found of view.actions)
        found.mode = body.preset === "autonomous" ? "allow" : found.defaultMode;
      view = { ...view, version: view.version + 1, preset: body.preset };
      return json(response, view);
    }
    if (url === "/v1/brain" && method === "GET")
      return json(response, {
        stats: {
          experiences: 12,
          skills: skills.length,
          preferences: 1,
          planSuccessRate: 0.9,
          correctionRate: 0.05,
          reflexShare: 0.2,
          lastConsolidatedAt: null,
        },
        skills,
      });
    if (url.startsWith("/v1/brain/skills/")) {
      skills = skills.filter((skill) => !url.endsWith(skill.id));
      return response.writeHead(204).end();
    }
    if (url === "/v1/brain/consolidate") return json(response, { created: 0 });
    if (url === "/v1/brain" && method === "DELETE") {
      skills = [];
      return response.writeHead(204).end();
    }
    if (url === "/v1/memories" && method === "GET") return json(response, { memories });
    if (url.startsWith("/v1/memories/")) {
      memories = memories.filter((memory) => !url.endsWith(memory.id));
      return response.writeHead(204).end();
    }
    if (url === "/v1/memories" && method === "DELETE") {
      memories = [];
      return response.writeHead(204).end();
    }
    response.writeHead(404).end();
  });
});
test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
  await new Promise<void>((done) => server.listen(2161, "127.0.0.1", done));
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});

test("permissions: presets and per-action choices go to Core with the operator token", async () => {
  const run = await launch();
  try {
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    const sheet = run.page.getByRole("dialog", { name: "Ayarlar" });
    await sheet.getByRole("tab", { name: "İzinler" }).click();
    await expect(sheet.getByRole("tab", { name: "İzinler" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(sheet.getByLabel("Mikrofon")).toBeHidden();
    await expect(sheet.getByRole("radio", { name: "Güvenli" })).toBeChecked();
    const close = sheet.locator('[data-action="app.close"]');
    await expect(close).toContainText("Orta risk");
    await expect(sheet.locator('[data-action="agent.delegate"]')).toHaveAttribute(
      "data-available",
      "false",
    );
    await expect(sheet.locator('[data-action="agent.delegate"]')).toContainText("Yapılandırılmadı");
    await sheet.getByLabel("Yeni izinlerin süresi").selectOption("3600000");
    await close.getByRole("radio", { name: "İzin ver" }).check();
    await expect(close.getByRole("radio", { name: "İzin ver" })).toBeChecked();
    await expect(close).toContainText("'a kadar");
    const put = calls.findLast((call) => call.method === "PUT");
    expect(put?.body).toEqual({
      actions: { "app.close": { mode: "allow", expiresInMs: 3600000 } },
    });
    expect(put?.authorization).toBe(`Bearer ${coreSecret}`);
    await expect(sheet.locator("[data-settings-status]")).toContainText("Uygulamayı kapat");
    await sheet
      .locator('[data-action="file.move"]')
      .getByRole("radio", { name: "Engelle" })
      .check();
    expect(calls.findLast((call) => call.method === "PUT")?.body).toEqual({
      actions: { "file.move": { mode: "deny", expiresInMs: undefined } },
    });
    await sheet.getByRole("radio", { name: "Tam yetki" }).check();
    await expect(sheet.getByRole("radio", { name: "Tam yetki" })).toBeChecked();
    expect(calls.findLast((call) => call.url === "/v1/permissions/preset")?.body).toEqual({
      preset: "autonomous",
      expiresInMs: 3600000,
    });
    await expect(sheet.locator("[data-preset-note]")).toContainText("onay kartı olmadan");
    await run.page.waitForTimeout(400);
    await run.page.screenshot({ path: `${shots}/settings-permissions.png` });
    // The renderer never receives the Core token, and the bridge refuses malformed changes.
    expect(await run.page.evaluate(() => document.documentElement.outerHTML)).not.toContain(
      coreSecret,
    );
    await expect(
      run.page.evaluate(() =>
        window.jarvis.permissions.set({
          actions: { "shell.run;rm": { mode: "allow" } },
        } as never),
      ),
    ).rejects.toThrow("INVALID_PERMISSIONS");
    await expect(
      run.page.evaluate(() => window.jarvis.permissions.preset("root" as never)),
    ).rejects.toThrow("INVALID_PRESET");
  } finally {
    await run.close();
  }
});

test("learning: switches, skills and reset; memory: notes and forgetting", async () => {
  const run = await launch();
  try {
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    const sheet = run.page.getByRole("dialog", { name: "Ayarlar" });
    await sheet.getByRole("tab", { name: "Öğrenme" }).click();
    await expect(sheet.locator("[data-brain-stats]")).toContainText("12 deneyim");
    await expect(sheet.getByLabel("Etkileşimlerden öğren")).toBeChecked();
    await sheet.getByLabel("Öğrenilen kısayolları kullan").uncheck();
    expect(calls.findLast((call) => call.method === "PUT")?.body).toEqual({
      settings: { reflexes: false },
    });
    await expect(sheet.locator("[data-skill-list]")).toContainText("Spotify'ı aç");
    await run.page.waitForTimeout(300);
    await run.page.screenshot({ path: `${shots}/settings-learning.png` });
    await sheet.getByRole("button", { name: "Spotify'ı aç becerisini unut" }).click();
    await expect(sheet.locator("[data-skill-list]")).toContainText("Henüz öğrenilmiş");
    await sheet.getByRole("button", { name: "Öğrenileni sıfırla" }).click();
    await sheet.getByRole("button", { name: "Sıfırla", exact: true }).click();
    expect(calls.some((call) => call.method === "DELETE" && call.url === "/v1/brain")).toBe(true);

    await sheet.getByRole("tab", { name: "Hafıza" }).click();
    await expect(sheet.locator("[data-memory-list]")).toContainText("Kahvemi sade içerim");
    await sheet.getByRole("button", { name: "“Kahvemi sade içerim” notunu unut" }).click();
    await expect(sheet.locator("[data-memory-list]")).toContainText("Henüz hatırladığım");
    // Arrow keys move between tabs.
    await sheet.getByRole("tab", { name: "Hafıza" }).press("ArrowRight");
    await expect(sheet.getByRole("tab", { name: "Genel" })).toBeFocused();
    await expect(sheet.getByLabel("Mikrofon")).toBeVisible();
  } finally {
    await run.close();
  }
});
