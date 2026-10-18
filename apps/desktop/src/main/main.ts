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
  Tray,
} from "electron";
import type { UiEvent, Voice } from "../shared";
import { readOperatorEnv } from "./env";
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
  const response = await fetch(`${env.coreUrl}/v1/conversation/turns`, {
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
    void win.loadURL(pathToFileURL(join(__dirname, file)).href);
    return win;
  }
  main = window("index.html", {
    title: "JARVIS",
    width: 1080,
    height: 760,
    minWidth: 700,
    minHeight: 560,
    backgroundColor: "#080d12",
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
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#101c25"/><path d="M9 10h13v9c0 8-13 8-13 0" fill="none" stroke="#b7dee0" stroke-width="3"/></svg>',
    ),
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("JARVIS");
  tray.on("double-click", () => main.show());
  updateTray();
  globalShortcut.register("Control+Alt+J", () => setListening(!listening));
  if (testing) ipcMain.on("test:toggle-listening", () => setListening(!listening));

  try {
    env = readOperatorEnv(process.env.JARVIS_ENV_FILE ?? "");
    voice = testing
      ? Promise.resolve({ url: "http://127.0.0.1:1", token: "launch-test-token", test: true })
      : startVoiceService({
          repoRoot: resolve(__dirname, "../../.."),
          ...env,
          dataDir: process.env.VOICE_DATA_DIR ?? resolve(__dirname, "../../../data/voice"),
        }).then((value) => {
          service = value;
          return value;
        });
  } catch {
    voice = Promise.reject(new Error("ENV_MISSING"));
  }
  // Renderer pulls status after DOM startup, so an early error is never lost.
  voice.catch(() => {});
  ipcMain.handle("voice", async (event) => {
    if (!allowed(event.sender) || event.sender !== main.webContents) throw new Error("FORBIDDEN");
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
    ["enroll:start", "/enroll/start", "POST"],
    ["enroll:finish", "/enroll/finish", "POST"],
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
  service?.stop();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});
