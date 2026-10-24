import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import { autoUpdater } from "electron-updater";
import type { BootStatus, PermissionChange, PlanView, UiEvent, Voice } from "../shared";
import {
  type BootStep,
  httpOk,
  portOpen,
  runBoot,
  type Service,
  startService,
  waitFor,
} from "./boot";
import { loadOperatorEnv, locateEnvFile } from "./env";
import { checkGuide, restartCore } from "./guide";
import { streamPlans } from "./plans";
import { desktopUpdates } from "./updates";
import { startVoiceService } from "./voice";

const testing = process.env.JARVIS_DESKTOP_TEST === "1";
let main: BrowserWindow | undefined;
let overlay: BrowserWindow | undefined;
let splash: BrowserWindow | undefined;
let tray: Tray;
let listening = true;
let quitting = false;
let service: (Voice & { stop(): void }) | undefined;
let voice: Promise<Voice> | undefined;
let env: { coreUrl: string; coreToken: string } | undefined;
let operator: ReturnType<typeof loadOperatorEnv> | undefined;
let envFile = "";
// Services this app started; ones already running (the service script, a dev terminal) stay theirs.
let core: Service | undefined;
let openclaw: Service | undefined;
const streamStop = new AbortController();
const plans = new Map<string, PlanView>();

function receivePlan(event: UiEvent) {
  if (event.type === "plan") {
    plans.set(event.plan.id, event.plan);
    // shortcut: retain 20 recent plans in this window; fetch history from Core if a history UI is added.
    if (plans.size > 20) plans.delete(plans.keys().next().value ?? "");
  }
  broadcast(event);
  // Finished background work also reaches the operator when they are away from the window.
  if (
    event.type === "announce" &&
    event.kind === "outcome" &&
    !testing &&
    Notification.isSupported()
  )
    new Notification({ title: "J.A.R.V.I.S", body: event.text }).show();
  if (event.type === "announce") {
    void voice
      ?.then(async (connection) => {
        await fetch(`${connection.url}/announce`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            text: event.text,
            lang: event.lang,
            kind: event.kind,
            ...(event.planId && { planId: event.planId }),
          }),
          signal: AbortSignal.timeout(5000),
        });
      })
      .catch(() => {});
  }
}

function broadcast(event: UiEvent) {
  for (const win of [main, overlay])
    if (win && !win.isDestroyed()) win.webContents.send("ui:event", event);
}
function setListening(on: boolean) {
  listening = on;
  broadcast({ type: "listening", value: on });
  broadcast({ type: "state", value: on ? "listening" : "idle" });
  updateTray();
}
function updateTray() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: main?.isVisible() && !main.isMinimized() ? "Mini moda geç" : "Pencereyi göster",
        accelerator: "Control+Alt+M",
        registerAccelerator: false,
        click: toggleWindow,
      },
      {
        label: listening ? "Dinlemeyi durdur" : "Dinlemeyi başlat",
        click: () => setListening(!listening),
      },
      { type: "separator" },
      { label: "Çık", click: () => app.quit() },
    ]),
  );
}
// Full window and the top-right mini bar trade places; a minimized window counts as mini.
function showMain() {
  if (!main || main.isDestroyed()) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}
function toggleWindow() {
  if (main?.isVisible() && !main.isMinimized()) main.hide();
  else showMain();
}
function allowed(sender: Electron.WebContents) {
  return [main, overlay].some((win) => win && !win.isDestroyed() && win.webContents === sender);
}
async function coreCall(method: string) {
  if (!env) throw new Error("CORE_UNAVAILABLE");
  // shortcut: export stops at Core's 500-turn cap; paginate if 30 days ever hold more.
  const query = method === "GET" ? "?limit=500" : "";
  const response = await fetch(`${env.coreUrl}/v1/conversation/turns${query}`, {
    method,
    headers: { authorization: `Bearer ${env.coreToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("CORE_UNAVAILABLE");
  return method === "GET" ? response.json() : undefined;
}

// One authenticated Core request from the main process; the renderer never holds the token.
async function coreJson(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!env) throw new Error("CORE_UNAVAILABLE");
  const response = await fetch(`${env.coreUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.coreToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`CORE_${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where the database lives, for the loading screen: never the address or credentials. */
function databaseName(url: string | undefined) {
  if (!url) return "PostgreSQL";
  const host = new URL(url).hostname;
  const region = /^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/.exec(host)?.[1];
  if (region) return `Supabase ${region}`;
  if (host.endsWith(".supabase.co")) return "Supabase";
  return ["127.0.0.1", "localhost", "[::1]"].includes(host) ? "Yerel PostgreSQL" : "PostgreSQL";
}
// Shape check before anything reaches Core; Core validates again.
function permissionChange(value: unknown): PermissionChange {
  if (!value || typeof value !== "object") throw new Error("INVALID_PERMISSIONS");
  const { actions, settings } = value as PermissionChange;
  const change: PermissionChange = {};
  if (actions !== undefined) {
    if (!actions || typeof actions !== "object") throw new Error("INVALID_PERMISSIONS");
    change.actions = {};
    for (const [id, grant] of Object.entries(actions)) {
      if (
        !/^[a-z]+\.[a-z_]+$/.test(id) ||
        !grant ||
        !["ask", "allow", "deny"].includes(grant.mode) ||
        (grant.expiresInMs !== undefined &&
          (!Number.isInteger(grant.expiresInMs) || grant.expiresInMs < 60_000))
      )
        throw new Error("INVALID_PERMISSIONS");
      change.actions[id] = {
        mode: grant.mode,
        ...(grant.expiresInMs !== undefined && { expiresInMs: grant.expiresInMs }),
      };
    }
  }
  if (settings !== undefined) {
    if (!settings || typeof settings !== "object") throw new Error("INVALID_PERMISSIONS");
    change.settings = {};
    for (const key of ["learning", "reflexes"] as const) {
      const flag = settings[key];
      if (flag === undefined) continue;
      if (typeof flag !== "boolean") throw new Error("INVALID_PERMISSIONS");
      change.settings[key] = flag;
    }
  }
  return change;
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      contents === main?.webContents &&
        permission === "media" &&
        "mediaTypes" in details &&
        details.mediaTypes?.every((type) => type === "audio") === true,
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) => contents === main?.webContents && permission === "media",
  );
  // The application mark (build/icon.svg), bundled beside the code; no network request.
  const icon = nativeImage.createFromPath(join(__dirname, "icon.png"));
  function window(file: string, options: Electron.BrowserWindowConstructorOptions) {
    const win = new BrowserWindow({
      icon,
      ...options,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    win.webContents.on("did-finish-load", () => {
      for (const plan of plans.values()) win.webContents.send("ui:event", { type: "plan", plan });
    });
    void win.loadURL(pathToFileURL(join(__dirname, file)).href);
    return win;
  }
  // Created only after every service answered, so the renderer never calls a missing handler.
  function openWindows() {
    main = window("index.html", {
      title: "J.A.R.V.I.S",
      width: 1080,
      height: 760,
      minWidth: 700,
      minHeight: 560,
      backgroundColor: "#0c0a09",
      autoHideMenuBar: true,
      show: false,
    });
    const bounds = screen.getPrimaryDisplay().workArea;
    const edge = window("overlay.html", {
      title: "J.A.R.V.I.S Mini",
      width: 380,
      height: 450,
      x: bounds.x + bounds.width - 400,
      y: bounds.y + 40,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: false,
    });
    overlay = edge;
    // Windows can ignore the default floating level for a non-focusable overlay.
    edge.setAlwaysOnTop(true, "pop-up-menu");
    edge.setIgnoreMouseEvents(true, { forward: true });
    const win = main;
    win.once("ready-to-show", () => {
      win.show();
      // The loading screen leaves only once the main window is on screen.
      splash?.close();
      splash = undefined;
    });
    edge.webContents.on("did-finish-load", () =>
      edge.webContents.send("ui:event", { type: "listening", value: listening }),
    );
    const toMini = () => {
      edge.showInactive();
      updateTray();
    };
    const toFull = () => {
      edge.hide();
      updateTray();
    };
    win.on("hide", toMini);
    win.on("minimize", toMini);
    win.on("show", toFull);
    win.on("restore", toFull);
    win.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
  }
  const updates = desktopUpdates({
    driver: autoUpdater,
    enabled: app.isPackaged && process.platform === "win32",
    version: app.getVersion(),
    notify: (update) => {
      if (main && !main.isDestroyed())
        main.webContents.send("ui:event", { type: "update", update });
    },
    beforeInstall: () => {
      quitting = true;
    },
  });
  for (const method of ["status", "check", "download", "install"] as const) {
    ipcMain.handle(`updates:${method}`, (event) => {
      if (event.sender !== main?.webContents || event.senderFrame !== main.webContents.mainFrame)
        throw new Error("FORBIDDEN");
      return updates[method]();
    });
  }
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 32, height: 32, quality: "best" }));
  tray.setToolTip("J.A.R.V.I.S");
  tray.on("double-click", toggleWindow);
  updateTray();
  globalShortcut.register("Control+Alt+J", () => setListening(!listening));
  globalShortcut.register("Control+Alt+M", toggleWindow);
  if (testing) ipcMain.on("test:toggle-window", toggleWindow);
  if (testing) ipcMain.on("test:toggle-listening", () => setListening(!listening));

  const userData = app.getPath("userData");
  const logs = join(userData, "logs");
  mkdirSync(logs, { recursive: true });
  let repoRoot = "";
  let voiceFailed = false;
  const startVoice = () => {
    voiceFailed = false;
    if (testing) {
      voice = Promise.resolve({
        url: "http://127.0.0.1:1",
        token: "launch-test-token",
        test: true,
      });
      return;
    }
    if (!env) throw new Error("ENV_MISSING");
    voice = startVoiceService({
      repoRoot,
      ...env,
      dataDir: process.env.VOICE_DATA_DIR ?? join(repoRoot, "data/voice"),
      threshold: operator?.values.VOICE_SPEAKER_THRESHOLD,
      onExit: () => {
        voiceFailed = !quitting;
        service = undefined;
      },
    }).then((value) => {
      service = value;
      return value;
    });
    voice.catch(() => {
      voiceFailed = true;
    });
  };
  const loadEnv = async () => {
    const store = join(userData, "operator.env");
    const cipher = {
      encrypt: (text: string) => safeStorage.encryptString(text),
      decrypt: (data: Buffer) => safeStorage.decryptString(data),
    };
    try {
      operator = loadOperatorEnv(store, process.env.JARVIS_ENV_FILE, cipher);
    } catch (error) {
      if (testing) throw error;
      // First start of an install: the .env an older version remembered, else asked once.
      const picked = await locateEnvFile(
        undefined,
        join(userData, "jarvis.json"),
        async () =>
          (
            await dialog.showOpenDialog({
              title: "J.A.R.V.I.S .env dosyasını seçin",
              properties: ["openFile", "dontAddToRecent"],
              filters: [{ name: "J.A.R.V.I.S .env", extensions: ["env", "*"] }],
            })
          ).filePaths[0],
      );
      operator = loadOperatorEnv(store, picked, cipher);
    }
    envFile = operator.source;
    env = { coreUrl: operator.coreUrl, coreToken: operator.coreToken };
    // The installed app runs the operator's checkout; updates never contain operator data.
    repoRoot =
      process.env.JARVIS_REPO_ROOT ??
      (app.isPackaged ? dirname(resolve(envFile)) : resolve(__dirname, "../../.."));
  };
  // Operator values win over an inherited shell variable (a stale DATABASE_URL, for one).
  const serviceEnv = (): NodeJS.ProcessEnv => ({ ...process.env, ...operator?.values });
  const startCore = async () => {
    if (!env) throw new Error("ENV_MISSING");
    const health = `${env.coreUrl}/healthz`;
    if (await httpOk(health)) return { detail: core ? "Çalışıyor" : "Zaten çalışıyor" };
    if (testing) throw new Error("CORE_UNREACHABLE");
    const entry = join(repoRoot, "dist", "main.js");
    if (!existsSync(entry)) throw new Error("CORE_NOT_BUILT");
    core?.stop();
    // Electron's own Node runs Core: nothing else to install, and its version ships with the app.
    core = startService(process.execPath, [entry], {
      cwd: repoRoot,
      env: { ...serviceEnv(), ELECTRON_RUN_AS_NODE: "1" },
      log: join(logs, "core.log"),
    });
    await waitFor(() => httpOk(health), { timeoutMs: 90_000, code: "CORE", exited: core.exited });
    return { detail: "Başlatıldı" };
  };
  const steps: BootStep[] = [
    {
      id: "config",
      label: "Yapılandırma",
      run: async () => {
        await loadEnv();
        return { detail: operator?.imported ? ".env şifreli kasaya alındı" : "Şifreli kasa" };
      },
    },
    { id: "core", label: "Çekirdek", after: ["config"], run: startCore },
    {
      id: "database",
      label: "Veritabanı",
      after: ["core"],
      run: async () => {
        if (!env) throw new Error("ENV_MISSING");
        const { coreUrl, coreToken } = env;
        const ready = () => httpOk(`${coreUrl}/readyz`, coreToken);
        await waitFor(ready, { timeoutMs: 30_000, code: "DATABASE" });
        const started = performance.now();
        await ready();
        const ms = Math.round(performance.now() - started);
        return { detail: `${databaseName(operator?.values.DATABASE_URL)} · ${ms} ms` };
      },
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      after: ["config"],
      run: async () => {
        if (operator?.values.ENABLE_OPENCLAW !== "true") return { skipped: true, detail: "Kapalı" };
        const address = new URL(operator.values.OPENCLAW_URL || "http://127.0.0.1:18789");
        const port = Number(address.port || 80);
        if (await portOpen(port)) return { detail: openclaw ? "Çalışıyor" : "Zaten çalışıyor" };
        if (testing) throw new Error("OPENCLAW_UNREACHABLE");
        openclaw?.stop();
        openclaw = startService(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            join(repoRoot, "scripts", "openclaw-native.ps1"),
          ],
          // Stopped with JARVIS on quit, so nothing it started keeps the computer busy.
          { cwd: repoRoot, env: serviceEnv(), log: join(logs, "openclaw.log") },
        );
        // The gateway's first start prepares its runtime; the service script allows 165 s.
        await waitFor(() => portOpen(port), {
          timeoutMs: 180_000,
          code: "OPENCLAW",
          exited: openclaw.exited,
        });
        return { detail: "Başlatıldı" };
      },
    },
    {
      id: "voice",
      label: "Ses servisi",
      after: ["config"],
      run: async () => {
        if (!voice || voiceFailed) startVoice();
        await voice;
        return { detail: "Hazır" };
      },
    },
  ];
  for (const action of ["approve", "reject", "cancel", "choose"] as const) {
    ipcMain.handle(`plans:${action}`, async (event, id: unknown, value: unknown) => {
      if (!allowed(event.sender)) throw new Error("FORBIDDEN");
      if (
        typeof id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
        (action === "approve" &&
          (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) ||
        (action === "choose" &&
          (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100))
      )
        throw new Error("INVALID_PLAN");
      if (!env) throw new Error("CORE_UNAVAILABLE");
      const response = await fetch(`${env.coreUrl}/v1/plans/${id}/${action}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.coreToken}`, "content-type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { hash: value } : action === "choose" ? { index: value } : {},
        ),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("PLAN_UPDATE_FAILED");
      if (action === "choose") return response.json();
    });
  }
  ipcMain.handle("plans:approve-action", async (event, id: unknown) => {
    if (
      !allowed(event.sender) ||
      typeof id !== "string" ||
      ![...plans.values()].some(
        (plan) =>
          plan.status === "RUNNING" &&
          plan.steps.some(
            (step) =>
              step.risk === "HIGH" &&
              step.status === "WAITING_FOR_APPROVAL" &&
              step.approval?.id === id,
          ),
      )
    )
      throw new Error("FORBIDDEN");
    if (!env) throw new Error("CORE_UNAVAILABLE");
    const response = await fetch(`${env.coreUrl}/v1/actions/${id}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.coreToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresAt: new Date(Date.now() + 120_000).toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("ACTION_APPROVAL_FAILED");
  });
  ipcMain.handle("plans:open", async (event, url: unknown) => {
    if (!allowed(event.sender) || typeof url !== "string" || !/^https?:/.test(url))
      throw new Error("FORBIDDEN");
    const parsed = new URL(url);
    // Plain http only for this machine's own services (a guide's local n8n page).
    const local =
      parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" && !local) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      throw new Error("FORBIDDEN");
    const known = [...plans.values()].some((plan) =>
      plan.panels.some(
        (panel) =>
          (panel.type === "news" && panel.items.some((item) => item.url === url)) ||
          (panel.type === "guide" && panel.links.some((link) => link.url === url)),
      ),
    );
    if (!known) throw new Error("FORBIDDEN");
    await shell.openExternal(url);
  });
  // The check comes from Core's own plan, never the renderer; the pasted value goes only to the
  // operator's .env and to the address the vendor's pages named.
  ipcMain.handle("guide:check", async (event, id: unknown, value: unknown) => {
    const panel =
      typeof id === "string"
        ? plans.get(id)?.panels.find((item) => item.type === "guide")
        : undefined;
    if (
      !allowed(event.sender) ||
      panel?.type !== "guide" ||
      !panel.check ||
      !envFile ||
      (value !== undefined && typeof value !== "string")
    )
      throw new Error("FORBIDDEN");
    const result = await checkGuide(envFile, panel.check, value);
    if (!result.saved) return { state: result.state, restarting: false };
    if (!core) return { state: result.state, restarting: restartCore(envFile) };
    // Core started here: restart it with the saved value, re-read into the encrypted copy.
    core.stop();
    core = undefined;
    void loadEnv()
      .then(startCore)
      .catch(() => {});
    return { state: result.state, restarting: true };
  });
  ipcMain.handle("voice", async (event) => {
    if (!allowed(event.sender) || event.sender !== main?.webContents) throw new Error("FORBIDDEN");
    // Retry after a crash or failed start spawns a fresh service instead of reusing a dead port.
    if (voiceFailed && env) startVoice();
    if (!voice) throw new Error("ENV_MISSING");
    const { url, token, test } = await voice;
    return { url, token, test };
  });
  for (const [channel, method] of [
    ["turns:export", "GET"],
    ["turns:delete", "DELETE"],
  ]) {
    ipcMain.handle(channel, (event) => {
      if (!allowed(event.sender)) throw new Error("FORBIDDEN");
      return coreCall(method);
    });
  }
  for (const [channel, path, method] of [
    ["enroll:status", "/health", "GET"],
    ["enroll:start", "/enroll/start", "POST"],
    ["enroll:finish", "/enroll/finish", "POST"],
    ["enroll:cancel", "/enroll/cancel", "POST"],
    ["enroll:remove", "/enroll", "DELETE"],
  ]) {
    ipcMain.handle(channel, async (event) => {
      if (!allowed(event.sender)) throw new Error("FORBIDDEN");
      if (!voice) throw new Error("VOICE_UNAVAILABLE");
      const connection = await voice;
      const response = await fetch(connection.url + path, {
        method,
        headers: { authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(response.status === 409 ? "MORE_SPEECH_NEEDED" : "VOICE_UNAVAILABLE");
      if (method === "GET") {
        const { enrolled, seconds } = await response.json();
        return { enrolled: enrolled === true, seconds: Number(seconds) || 0 };
      }
    });
  }
  // Settings: permissions, learning and memory, all through Core's authenticated API.
  const settingsCall = (channel: string, run: (...args: unknown[]) => Promise<unknown>) =>
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!allowed(event.sender) || event.sender !== main?.webContents)
        throw new Error("FORBIDDEN");
      return run(...args);
    });
  settingsCall("permissions:get", () => coreJson("GET", "/v1/permissions"));
  settingsCall("permissions:set", (change) =>
    coreJson("PUT", "/v1/permissions", permissionChange(change)),
  );
  settingsCall("permissions:preset", (name, expiresInMs) => {
    if (
      typeof name !== "string" ||
      !["guarded", "trusted", "autonomous"].includes(name) ||
      (expiresInMs !== undefined &&
        (typeof expiresInMs !== "number" || !Number.isInteger(expiresInMs) || expiresInMs < 60_000))
    )
      throw new Error("INVALID_PRESET");
    return coreJson("POST", "/v1/permissions/preset", {
      preset: name,
      ...(expiresInMs !== undefined && { expiresInMs }),
    });
  });
  settingsCall("brain:get", () => coreJson("GET", "/v1/brain"));
  settingsCall("brain:consolidate", async () => {
    await coreJson("POST", "/v1/brain/consolidate");
  });
  settingsCall("brain:forget-skill", async (id) => {
    if (typeof id !== "string" || !uuid.test(id)) throw new Error("INVALID_SKILL");
    await coreJson("DELETE", `/v1/brain/skills/${id}`);
  });
  settingsCall("brain:reset", async () => {
    await coreJson("DELETE", "/v1/brain");
  });
  settingsCall("memories:get", async () => {
    const { memories } = (await coreJson("GET", "/v1/memories")) as { memories: unknown[] };
    return memories;
  });
  settingsCall("memories:forget", async (id) => {
    if (typeof id !== "string" || !uuid.test(id)) throw new Error("INVALID_MEMORY");
    await coreJson("DELETE", `/v1/memories/${id}`);
  });
  settingsCall("memories:clear", async () => {
    await coreJson("DELETE", "/v1/memories");
  });
  ipcMain.on("listening", (event, on: unknown) => {
    if (allowed(event.sender) && typeof on === "boolean") setListening(on);
  });
  ipcMain.on("ui:relay", (event, data: UiEvent) => {
    if (
      event.sender === main?.webContents &&
      data &&
      ["state", "caption", "display"].includes(data.type)
    )
      overlay?.webContents.send("ui:event", data);
  });
  ipcMain.on("window:mini", (event) => {
    if (event.sender === main?.webContents) main.hide();
  });
  ipcMain.on("window:restore", (event) => {
    if (event.sender === overlay?.webContents) showMain();
  });
  ipcMain.on("app:quit", (event) => {
    if (allowed(event.sender) || event.sender === splash?.webContents) app.quit();
  });
  ipcMain.on("overlay:pointer", (event, over: unknown) => {
    if (event.sender === overlay?.webContents && typeof over === "boolean")
      overlay.setIgnoreMouseEvents(!over, { forward: true });
  });

  // Nothing opens until every service answers; the loading screen shows each check.
  if (!testing || process.env.JARVIS_BOOT === "1") {
    let status: BootStatus | undefined;
    let retry = () => {};
    ipcMain.on("boot:retry", (event) => {
      if (event.sender === splash?.webContents) retry();
    });
    const screenWindow = window("splash.html", {
      title: "J.A.R.V.I.S",
      width: 560,
      height: 590,
      resizable: false,
      maximizable: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
    });
    splash = screenWindow;
    screenWindow.once("ready-to-show", () => screenWindow.show());
    // Closed before the main window opened (Alt+F4): nothing else is visible, so quit.
    screenWindow.on("closed", () => {
      if (splash === screenWindow) app.quit();
    });
    screenWindow.webContents.on("did-finish-load", () => {
      if (status) screenWindow.webContents.send("boot:status", status);
    });
    const report = (next: BootStatus) => {
      status = next;
      if (!screenWindow.isDestroyed()) screenWindow.webContents.send("boot:status", next);
    };
    while (!(await runBoot(steps, report)))
      await new Promise<void>((resolve) => {
        retry = resolve;
      });
  } else {
    try {
      await loadEnv();
      startVoice();
    } catch {
      voice = Promise.reject(new Error("ENV_MISSING"));
    }
  }
  // Renderer pulls status after DOM startup, so an early error is never lost.
  voice?.catch(() => {});
  if (env) void streamPlans(env, receivePlan, streamStop.signal);
  openWindows();
});
app.on("before-quit", () => {
  quitting = true;
  streamStop.abort();
  service?.stop();
  core?.stop();
  openclaw?.stop();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});
