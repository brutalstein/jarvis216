import { expect, test } from "@playwright/test";
import { emit, launch } from "./helpers";

test("settings lists output devices, preserves selection on failure and refreshes hotplug", async () => {
  const run = await launch();
  try {
    await run.page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
        configurable: true,
        value: async () => [
          { kind: "audioinput", deviceId: "mic", label: "Test microphone" },
          { kind: "audiooutput", deviceId: "headset", label: "Test headset" },
        ],
      });
    });
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    const output = run.page.getByLabel("Ses çıkışı", { exact: true });
    await expect(output.getByRole("option", { name: "Test headset" })).toBeAttached();
    await output.selectOption("headset");
    await expect(output).toHaveValue("");
    await expect(run.page.locator("[data-settings-status]")).toContainText(
      "Ses çıkışı değiştirilemedi",
    );
    await run.page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
        value: async () => [{ kind: "audiooutput", deviceId: "usb", label: "USB speaker" }],
      });
      navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    });
    await expect(output.getByRole("option", { name: "USB speaker" })).toBeAttached();
    await expect(output.getByRole("option", { name: "Test headset" })).toHaveCount(0);
  } finally {
    await run.close();
  }
});

test("a disconnected voice session makes a bounded automatic reconnect attempt", async () => {
  const run = await launch();
  try {
    await expect(run.page.locator("body")).toHaveAttribute("data-state", "listening");
    await emit(run.app, { type: "error", code: "VOICE_DISCONNECTED" });
    await expect(run.page.getByRole("alert")).toBeVisible();
    await expect(run.page.locator("body")).toHaveAttribute("data-state", "listening", {
      timeout: 5000,
    });
    await expect(run.page.getByRole("alert")).toBeHidden();
  } finally {
    await run.close();
  }
});
