import { expect, test } from "@playwright/test";
import { coreSecret, launch } from "./helpers";

test("isolated shell exposes only the bounded bridge and no Core token", async () => {
  const run = await launch();
  try {
    await expect(run.page).toHaveTitle("JARVIS");
    expect(await run.page.evaluate(() => typeof Reflect.get(window, "require"))).toBe("undefined");
    expect(await run.page.evaluate(() => Object.keys(window.jarvis).sort())).toEqual(
      [
        "updates",
        "voice",
        "onEvent",
        "turns",
        "plans",
        "permissions",
        "brain",
        "memories",
        "enrollment",
        "setListening",
      ].sort(),
    );
    expect(
      await run.page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content"),
    ).toContain("script-src 'self'");
    expect(await run.page.content()).not.toContain(coreSecret);
    expect(JSON.stringify(await run.page.evaluate(() => window.jarvis.voice()))).not.toContain(
      coreSecret,
    );
    expect(await run.page.evaluate(() => typeof Reflect.get(window, "process"))).toBe("undefined");
    await run.page.evaluate(() => {
      location.assign("https://example.com");
    });
    expect(await run.page.evaluate(() => location.protocol)).toBe("file:");
    expect(
      await run.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.getTitle() === "JARVIS")
          ?.webContents.getURL(),
      ),
    ).toMatch(/^file:/);
  } finally {
    await run.close();
  }
});

test("missing operator env produces a recoverable visible error", async () => {
  const run = await launch({ missing: true });
  try {
    await expect(run.page.locator("body")).toHaveAttribute("data-state", "error");
    await expect(run.page.locator('[role="alert"]')).toBeVisible();
  } finally {
    await run.close();
  }
});
