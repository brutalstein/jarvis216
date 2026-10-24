import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("update button is beside Settings; development builds show their limit without networking", async () => {
  const run = await launch();
  try {
    expect(await run.app.evaluate(({ app }) => app.getPath("userData"))).toContain(
      "jarvis-desktop-",
    );
    const button = run.page.getByRole("button", { name: "Güncellemeler", exact: true });
    await expect(button).toBeVisible();
    expect(await button.evaluate((node) => node.nextElementSibling?.id)).toBe("settings-open");
    await button.click();
    const dialog = run.page.getByRole("dialog", { name: "Güncellemeler" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Kurulu Windows sürümünde kullanılabilir");
    await expect(dialog.getByRole("button", { name: "Güncellemeleri denetle" })).toBeDisabled();
    expect(await run.page.evaluate(() => Object.keys(window.jarvis.updates).sort())).toEqual([
      "check",
      "download",
      "install",
      "status",
    ]);
    const denied = await run.app.evaluate(async ({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find(
        (win) => win.getTitle() === "J.A.R.V.I.S Mini",
      );
      return overlay?.webContents.executeJavaScript(
        "window.jarvis.updates.check().then(() => 'ALLOWED', error => String(error))",
      );
    });
    expect(denied).toContain("FORBIDDEN");
    await run.page.keyboard.press("Escape");
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    await expect(run.page.getByRole("dialog", { name: "Ayarlar" })).toBeVisible();
  } finally {
    await run.close();
  }
});
