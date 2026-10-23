import type { AppUpdater } from "electron-updater";
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";
import type { UpdateState } from "../shared";

type Driver = Pick<
  AppUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowPrerelease"
  | "allowDowngrade"
  | "disableWebInstaller"
  | "checkForUpdates"
  | "downloadUpdate"
  | "quitAndInstall"
> & {
  on: <E extends keyof AppUpdaterEvents>(event: E, listener: AppUpdaterEvents[E]) => unknown;
};

export function desktopUpdates(options: {
  driver: Driver;
  enabled: boolean;
  version: string;
  notify(state: UpdateState): void;
  beforeInstall(): void;
}) {
  const { driver, enabled, version, notify } = options;
  let state: UpdateState = { phase: enabled ? "idle" : "unsupported", version };
  const set = (phase: UpdateState["phase"], extra: Partial<UpdateState> = {}) => {
    state = { version, phase, ...extra };
    notify(state);
  };
  driver.autoDownload = false;
  driver.autoInstallOnAppQuit = false;
  driver.allowPrerelease = false;
  driver.allowDowngrade = false;
  driver.disableWebInstaller = true;
  driver.on("error", () => set("error"));
  driver.on("update-available", (info) => set("available", { next: info.version }));
  driver.on("update-not-available", () => set("current"));
  driver.on("download-progress", (info) => {
    if (state.phase === "downloading")
      set("downloading", { next: state.next, percent: Math.floor(info.percent) });
  });
  // electron-updater emits this only after integrity/signature validation succeeds.
  driver.on("update-downloaded", (info) => set("ready", { next: info.version }));

  return {
    status: () => state,
    async check() {
      if (!enabled || ["checking", "downloading", "ready", "installing"].includes(state.phase))
        return state;
      set("checking");
      try {
        await driver.checkForUpdates();
      } catch {
        set("error");
      }
      return state;
    },
    async download() {
      if (state.phase === "downloading") return state;
      if (!enabled || state.phase !== "available") throw new Error("UPDATE_NOT_AVAILABLE");
      set("downloading", { next: state.next, percent: 0 });
      try {
        await driver.downloadUpdate();
      } catch {
        set("error");
      }
      return state;
    },
    install() {
      if (!enabled || state.phase !== "ready") throw new Error("UPDATE_NOT_READY");
      set("installing", { next: state.next });
      options.beforeInstall();
      driver.quitAndInstall(false, true);
    },
  };
}
