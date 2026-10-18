import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, UiEvent } from "../shared";

const bridge: Bridge = {
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
        Boolean(event.target.closest("[data-card], [data-hud-card]")),
    );
  });
  window.addEventListener("mouseleave", () => ipcRenderer.send("overlay:pointer", false));
});
