import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { desktopUpdates } from "../apps/desktop/src/main/updates.js";

function fixture(enabled = true) {
  const driver = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  });
  const notify = vi.fn();
  const beforeInstall = vi.fn();
  const updates = desktopUpdates({ driver, enabled, version: "0.1.0", notify, beforeInstall });
  return { driver, updates, notify, beforeInstall };
}

describe("desktop updater", () => {
  it("keeps development builds offline and cannot install", async () => {
    const { updates, driver } = fixture(false);
    expect((await updates.check()).phase).toBe("unsupported");
    await expect(updates.download()).rejects.toThrow("UPDATE_NOT_AVAILABLE");
    expect(() => updates.install()).toThrow("UPDATE_NOT_READY");
    expect(driver.checkForUpdates).not.toHaveBeenCalled();
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
  });

  it("requires explicit download and a verified download event before installation", async () => {
    const { updates, driver, beforeInstall } = fixture();
    expect(driver.autoDownload).toBe(false);
    expect(driver.autoInstallOnAppQuit).toBe(false);
    expect(driver.allowPrerelease).toBe(false);
    expect(driver.allowDowngrade).toBe(false);
    await updates.check();
    driver.emit("update-available", { version: "0.2.0" });
    expect(updates.status()).toMatchObject({ phase: "available", version: "0.1.0", next: "0.2.0" });
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
    expect(() => updates.install()).toThrow("UPDATE_NOT_READY");
    await updates.download();
    driver.emit("download-progress", { percent: 42.8 });
    expect(updates.status()).toMatchObject({ phase: "downloading", percent: 42 });
    expect(() => updates.install()).toThrow("UPDATE_NOT_READY");
    driver.emit("update-downloaded", { version: "0.2.0" });
    updates.install();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(driver.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("does not duplicate checks or downloads, and retries after network errors without leaking them", async () => {
    const { updates, driver, notify } = fixture();
    await Promise.all([updates.check(), updates.check()]);
    expect(driver.checkForUpdates).toHaveBeenCalledOnce();
    driver.emit("error", new Error("secret remote details"));
    expect(updates.status()).toMatchObject({ phase: "error" });
    expect(JSON.stringify(notify.mock.calls)).not.toContain("secret");
    await updates.check();
    driver.emit("update-available", { version: "0.2.0" });
    await Promise.all([updates.download(), updates.download()]);
    expect(driver.downloadUpdate).toHaveBeenCalledOnce();
    driver.emit("error", new Error("failed integrity check"));
    expect(() => updates.install()).toThrow("UPDATE_NOT_READY");
    await updates.check();
    driver.emit("update-not-available");
    expect(updates.status()).toMatchObject({ phase: "current" });
  });

  it("reports rejected network operations and can recover", async () => {
    const { updates, driver } = fixture();
    driver.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    expect((await updates.check()).phase).toBe("error");
    await updates.check();
    driver.emit("update-available", { version: "0.2.0" });
    driver.downloadUpdate.mockRejectedValueOnce(new Error("checksum mismatch"));
    expect((await updates.download()).phase).toBe("error");
    expect(() => updates.install()).toThrow("UPDATE_NOT_READY");
  });
});
