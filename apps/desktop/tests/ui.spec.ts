import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { emit, launch } from "./helpers";

test("presence states, captions, safe display cards and reduced motion", async () => {
  const run = await launch();
  try {
    await mkdir("../../artifacts/ui", { recursive: true });
    for (const state of ["idle", "listening", "thinking", "speaking", "approval", "error"]) {
      await emit(run.app, { type: "state", value: state });
      await expect(run.page.locator("body")).toHaveAttribute("data-state", state);
      await run.page.screenshot({ path: resolve(`../../artifacts/ui/${state}.png`) });
    }
    await emit(run.app, { type: "caption", role: "jarvis", text: "Buradayım, efendim." });
    await expect(run.page.locator("[data-caption]")).toHaveText("Buradayım, efendim.");
    for (let i = 0; i < 4; i++) {
      await emit(run.app, {
        type: "display",
        blocks: [{ type: "text", title: `Kart ${i}`, body: "<img src=x onerror=alert(1)>" }],
      });
    }
    await expect(run.page.locator("[data-card]")).toHaveCount(3);
    await expect(run.page.locator("[data-card]").first()).toContainText("Kart 1");
    expect(await run.page.locator("[data-card] img").count()).toBe(0);
    await expect(run.page.locator("[data-card]").last()).toContainText(
      "<img src=x onerror=alert(1)>",
    );
    await run.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(run.page.locator("[data-presence]")).toHaveAttribute("data-motion", "reduced");
    await run.page.screenshot({ path: resolve("../../artifacts/ui/display.png") });
  } finally {
    await run.close();
  }
});

test("keyboard shortcut, tray listening toggle, overlay and settings", async () => {
  const run = await launch();
  try {
    expect(
      await run.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+J")),
    ).toBe(true);
    expect(
      await run.app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === "JARVIS Overlay",
        );
        return Boolean(overlay?.isAlwaysOnTop());
      }),
    ).toBe(true);
    await run.app.evaluate(({ ipcMain }) => {
      ipcMain.emit("test:toggle-listening");
    });
    await expect(run.page.locator("body")).toHaveAttribute("data-listening", "false");
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    await expect(run.page.getByRole("dialog")).toBeVisible();
    await expect(run.page.getByLabel("Mikrofon")).toBeVisible();
    await expect(run.page.getByRole("button", { name: "Sesimi tanı", exact: true })).toBeVisible();
    await run.page.screenshot({ path: resolve("../../artifacts/ui/settings.png") });
    await run.page.keyboard.press("Escape");
    await expect(run.page.getByRole("dialog")).not.toBeVisible();
  } finally {
    await run.close();
  }
});

test("caption and cards expire while pinned cards stay", async () => {
  const run = await launch();
  try {
    await run.page.clock.install();
    await emit(run.app, { type: "caption", role: "jarvis", text: "Geçici yazı" });
    await emit(run.app, {
      type: "display",
      blocks: [
        { type: "text", body: "Sabit kart" },
        { type: "text", body: "Geçici kart" },
      ],
    });
    await run.page.locator("[data-card]").first().getByRole("button", { name: "Sabitle" }).click();
    await run.page.clock.fastForward(21000);
    await expect(run.page.locator("[data-caption]")).not.toBeVisible();
    await expect(run.page.locator("[data-card]")).toHaveCount(1);
    await expect(run.page.locator("[data-card]")).toContainText("Sabit kart");
  } finally {
    await run.close();
  }
});

test("caption, card and settings text meet 4.5 to 1 contrast", async () => {
  const run = await launch();
  try {
    await emit(run.app, { type: "caption", role: "jarvis", text: "Sizi dinliyorum." });
    await emit(run.app, { type: "display", blocks: [{ type: "text", body: "Okunabilir metin" }] });
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    const ratios = await run.page.evaluate(() => {
      function luminance(rgb: string) {
        const c = (rgb.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      }
      return ["[data-caption]", "[data-card] p", "dialog p"].map((selector) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error("MISSING_CONTRAST_TARGET");
        const fg = luminance(getComputedStyle(el).color);
        let bg: Element = el;
        while (bg.parentElement && getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)")
          bg = bg.parentElement;
        const background = luminance(getComputedStyle(bg).backgroundColor);
        return (Math.max(fg, background) + 0.05) / (Math.min(fg, background) + 0.05);
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  } finally {
    await run.close();
  }
});
