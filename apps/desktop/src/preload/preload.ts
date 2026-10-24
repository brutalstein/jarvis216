import { contextBridge, ipcRenderer } from "electron";
import type { BootStatus, Bridge, UiEvent } from "../shared";

const bridge: Bridge = {
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
  },
  voice: () => ipcRenderer.invoke("voice"),
  onEvent: (cb) => {
    ipcRenderer.on("ui:event", (_event, data: UiEvent) => cb(data));
    ipcRenderer.on("test:emit", (_event, data: UiEvent) => cb(data));
  },
  turns: {
    export: () => ipcRenderer.invoke("turns:export"),
    deleteAll: () => ipcRenderer.invoke("turns:delete"),
  },
  plans: {
    approve: (id, hash) => ipcRenderer.invoke("plans:approve", id, hash),
    approveAction: (id) => ipcRenderer.invoke("plans:approve-action", id),
    reject: (id) => ipcRenderer.invoke("plans:reject", id),
    cancel: (id) => ipcRenderer.invoke("plans:cancel", id),
    choose: (id, index) => ipcRenderer.invoke("plans:choose", id, index),
    open: (url) => ipcRenderer.invoke("plans:open", url),
    guide: (id, value) => ipcRenderer.invoke("guide:check", id, value),
  },
  permissions: {
    get: () => ipcRenderer.invoke("permissions:get"),
    set: (change) => ipcRenderer.invoke("permissions:set", change),
    preset: (name, expiresInMs) => ipcRenderer.invoke("permissions:preset", name, expiresInMs),
  },
  brain: {
    get: () => ipcRenderer.invoke("brain:get"),
    consolidate: () => ipcRenderer.invoke("brain:consolidate"),
    forgetSkill: (id) => ipcRenderer.invoke("brain:forget-skill", id),
    reset: () => ipcRenderer.invoke("brain:reset"),
  },
  memories: {
    get: () => ipcRenderer.invoke("memories:get"),
    forget: (id) => ipcRenderer.invoke("memories:forget", id),
    clear: () => ipcRenderer.invoke("memories:clear"),
  },
  enrollment: {
    status: () => ipcRenderer.invoke("enroll:status"),
    start: () => ipcRenderer.invoke("enroll:start"),
    finish: () => ipcRenderer.invoke("enroll:finish"),
    cancel: () => ipcRenderer.invoke("enroll:cancel"),
    remove: () => ipcRenderer.invoke("enroll:remove"),
  },
  setListening: (on) => {
    ipcRenderer.send("listening", on);
  },
  mini: () => ipcRenderer.send("window:mini"),
  restore: () => ipcRenderer.send("window:restore"),
  quit: () => ipcRenderer.send("app:quit"),
  boot: {
    onStatus: (cb) => {
      ipcRenderer.on("boot:status", (_event, status: BootStatus) => cb(status));
    },
    retry: () => ipcRenderer.send("boot:retry"),
  },
};
contextBridge.exposeInMainWorld("jarvis", bridge);
window.addEventListener("jarvis:ui", (event) => {
  ipcRenderer.send("ui:relay", (event as CustomEvent).detail);
});
// Overlay stays click-through except over actual cards; no general IPC capability is exposed.
window.addEventListener("DOMContentLoaded", () => {
  if (!location.pathname.endsWith("overlay.html")) return;
  window.addEventListener("mousemove", (event) => {
    ipcRenderer.send(
      "overlay:pointer",
      event.target instanceof Element &&
        Boolean(
          event.target.closest("[data-card], [data-hud-card], [data-restore], [data-window-bar]"),
        ),
    );
  });
  window.addEventListener("mouseleave", () => ipcRenderer.send("overlay:pointer", false));
});
