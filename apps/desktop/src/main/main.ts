import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import type { PlanView, UiEvent, Voice } from "../shared";
import { readOperatorEnv } from "./env";
import { streamPlans } from "./plans";
import { startVoiceService } from "./voice";

const testing = process.env.JARVIS_DESKTOP_TEST === "1";
let main: BrowserWindow;
let overlay: BrowserWindow;
let tray: Tray;
let listening = true;
let quitting = false;
let service: (Voice & { stop(): void }) | undefined;
let voice: Promise<Voice>;
let env: ReturnType<typeof readOperatorEnv>;
const streamStop = new AbortController();
const plans = new Map<string, PlanView>();

function receivePlan(event: UiEvent) {
  if (event.type === "plan") {
    plans.set(event.plan.id, event.plan);
    // shortcut: retain 20 recent plans in this window; fetch history from Core if a history UI is added.
    if (plans.size > 20) plans.delete(plans.keys().next().value ?? "");
  }
  broadcast(event);
  if (event.type === "announce") {
    void voice
      .then(async (connection) => {
        await fetch(`${connection.url}/announce`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: event.text, lang: event.lang }),
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
        label: "Göster",
        click: () => {
          main.show();
          main.focus();
        },
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
  function window(file: string, options: Electron.BrowserWindowConstructorOptions) {
    const win = new BrowserWindow({
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
  main = window("index.html", {
    title: "JARVIS",
    width: 1080,
    height: 760,
    minWidth: 700,
    minHeight: 560,
    backgroundColor: "#0c0a09",
    autoHideMenuBar: true,
    show: false,
  });
  const bounds = screen.getPrimaryDisplay().workArea;
  overlay = window("overlay.html", {
    title: "JARVIS Overlay",
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
  overlay.setIgnoreMouseEvents(true, { forward: true });
  main.once("ready-to-show", () => main.show());
  main.on("hide", () => overlay.showInactive());
  main.on("show", () => overlay.hide());
  main.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      main.hide();
    }
  });
  // An embedded geometric application mark; no external asset or network request.
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="#a7e5d3" stroke-width="1.6"><rect width="32" height="32" rx="8" fill="#1c1917" stroke="none"/><circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="6.5"/><circle cx="16" cy="16" r="3"/></svg>',
    ),
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("JARVIS");
  tray.on("double-click", () => main.show());
  updateTray();
  globalShortcut.register("Control+Alt+J", () => setListening(!listening));
  if (testing) ipcMain.on("test:toggle-listening", () => setListening(!listening));

  let voiceFailed = false;
  const startVoice = () => {
    voiceFailed = false;
    voice = startVoiceService({
      repoRoot: resolve(__dirname, "../../.."),
      ...env,
      dataDir: process.env.VOICE_DATA_DIR ?? resolve(__dirname, "../../../data/voice"),
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
  try {
    env = readOperatorEnv(process.env.JARVIS_ENV_FILE ?? "");
    if (testing)
      voice = Promise.resolve({
        url: "http://127.0.0.1:1",
        token: "launch-test-token",
        test: true,
      });
    else startVoice();
  } catch {
    voice = Promise.reject(new Error("ENV_MISSING"));
  }
  // Renderer pulls status after DOM startup, so an early error is never lost.
  voice.catch(() => {});
  if (env) void streamPlans(env, receivePlan, streamStop.signal);
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
  ipcMain.handle("plans:open", async (event, url: unknown) => {
    if (!allowed(event.sender) || typeof url !== "string" || !url.startsWith("https:"))
      throw new Error("FORBIDDEN");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password)
      throw new Error("FORBIDDEN");
    const known = [...plans.values()].some((plan) =>
      plan.panels.some(
        (panel) => panel.type === "news" && panel.items.some((item) => item.url === url),
      ),
    );
    if (!known) throw new Error("FORBIDDEN");
    await shell.openExternal(url);
  });
  ipcMain.handle("voice", async (event) => {
    if (!allowed(event.sender) || event.sender !== main.webContents) throw new Error("FORBIDDEN");
    // Retry after a crash or failed start spawns a fresh service instead of reusing a dead port.
    if (voiceFailed) startVoice();
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
  ipcMain.on("listening", (event, on: unknown) => {
    if (allowed(event.sender) && typeof on === "boolean") setListening(on);
  });
  ipcMain.on("ui:relay", (event, data: UiEvent) => {
    if (
      event.sender === main.webContents &&
      data &&
      ["state", "caption", "display"].includes(data.type)
    )
      overlay.webContents.send("ui:event", data);
  });
  ipcMain.on("overlay:pointer", (event, over: unknown) => {
    if (event.sender === overlay.webContents && typeof over === "boolean")
      overlay.setIgnoreMouseEvents(!over, { forward: true });
  });
});
app.on("before-quit", () => {
  quitting = true;
  streamStop.abort();
  service?.stop();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});
