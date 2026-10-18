import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { emit, launch } from "./helpers";

const shots = resolve("../../artifacts/ui");
const states = ["idle", "listening", "thinking", "speaking", "approval", "error"] as const;

async function overlayPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith("/overlay.html"))).toBe(true);
  const page = app.windows().find((w) => w.url().endsWith("/overlay.html"));
  if (!page) throw new Error("OVERLAY_MISSING");
  await page.waitForLoadState("domcontentloaded");
  return page;
}

function contrast(page: Page, selectors: string[]) {
  return page.evaluate((list) => {
    function luminance(rgb: string) {
      const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
        const c = Number(v) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    return list.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`MISSING_CONTRAST_TARGET ${selector}`);
      const fg = luminance(getComputedStyle(el).color);
      let bg: Element = el;
      while (bg.parentElement && getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)")
        bg = bg.parentElement;
      const back = luminance(getComputedStyle(bg).backgroundColor);
      return {
        selector,
        ratio: (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05),
      };
    });
  }, selectors);
}

test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
});

test("every presence state has its own colour, word and capture", async () => {
  const run = await launch();
  try {
    const colours = new Set<string>();
    for (const state of states) {
      await emit(run.app, { type: "state", value: state });
      await expect(run.page.locator("body")).toHaveAttribute("data-state", state);
      await expect(run.page.locator("[data-status]")).not.toBeEmpty();
      colours.add(
        await run.page.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue("--state-target").trim(),
        ),
      );
      await run.page.waitForTimeout(700);
      await run.page.screenshot({ path: `${shots}/${state}.png` });
    }
    expect(colours.size).toBe(states.length);
  } finally {
    await run.close();
  }
});

test("captions show only the latest sentence, styled by speaker, then fade", async () => {
  const run = await launch();
  try {
    await run.page.clock.install();
    const caption = run.page.locator("[data-caption]");
    await expect(run.page.locator("[data-hint]")).toBeVisible();
    await emit(run.app, { type: "caption", role: "user", text: "Jarvis, yarın hava nasıl?" });
    await expect(caption).toHaveText("Jarvis, yarın hava nasıl?");
    await expect(caption).toHaveAttribute("data-role", "user");
    await expect(run.page.locator("[data-hint]")).toBeHidden();
    await emit(run.app, { type: "caption", role: "jarvis", text: "Yarın güneşli, efendim." });
    await expect(caption).toHaveText("Yarın güneşli, efendim.");
    await expect(caption).toHaveAttribute("data-role", "jarvis");
    await run.page.clock.fastForward(16000);
    await expect(caption).toBeHidden();
  } finally {
    await run.close();
  }
});

test("display cards render text only, keep three, pin and expire", async () => {
  const run = await launch();
  try {
    await run.page.clock.install();
    for (let i = 0; i < 4; i++)
      await emit(run.app, {
        type: "display",
        blocks: [{ type: "text", title: `Kart ${i}`, body: "<img src=x onerror=alert(1)>" }],
      });
    const cards = run.page.locator("[data-card]");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("Kart 1");
    await expect(cards.last()).toContainText("<img src=x onerror=alert(1)>");
    expect(await run.page.locator("[data-card] img").count()).toBe(0);
    await expect(run.page.locator("body")).toHaveAttribute("data-cards", "true");
    await emit(run.app, {
      type: "display",
      blocks: [
        { type: "list", title: "Bugün", items: ["09:00 Ekip toplantısı", "13:30 Diş hekimi"] },
        { type: "code", language: "ts", code: "const answer = 42;" },
      ],
    });
    await expect(cards).toHaveCount(3);
    await expect(run.page.locator("[data-card] pre")).toHaveText("const answer = 42;");
    // Let replaced cards leave and new ones settle before the capture.
    await run.page.clock.runFor(400);
    await run.page.waitForTimeout(500);
    await run.page.screenshot({ path: `${shots}/cards.png` });
    const pin = cards.first().getByRole("button", { name: "Sabitle" });
    await pin.click();
    await expect(cards.first().getByRole("button", { name: "Sabitlemeyi kaldır" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await run.page.clock.fastForward(21000);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Kart 3");
  } finally {
    await run.close();
  }
});

test("reduced motion freezes the presence", async () => {
  const run = await launch();
  try {
    await expect(run.page.locator("[data-presence]")).toHaveAttribute("data-motion", "full");
    await run.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(run.page.locator("[data-presence]")).toHaveAttribute("data-motion", "reduced");
  } finally {
    await run.close();
  }
});

test("listening toggles from the button and the tray path; shortcut and overlay exist", async () => {
  const run = await launch();
  try {
    expect(
      await run.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+J")),
    ).toBe(true);
    expect(
      await run.app.evaluate(({ BrowserWindow }) =>
        Boolean(
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "JARVIS Overlay")
            ?.isAlwaysOnTop(),
        ),
      ),
    ).toBe(true);
    const toggle = run.page.locator("#listen-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await run.app.evaluate(({ ipcMain }) => {
      ipcMain.emit("test:toggle-listening");
    });
    await expect(run.page.locator("body")).toHaveAttribute("data-listening", "false");
    await expect(toggle).toHaveText("Dinlemeyi başlat");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(run.page.locator("body")).toHaveAttribute("data-listening", "true");
    await expect(toggle).toHaveText("Dinlemeyi durdur");
  } finally {
    await run.close();
  }
});

test("settings sheet holds microphone, voice and conversations; Escape closes it", async () => {
  const run = await launch();
  try {
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    const sheet = run.page.getByRole("dialog", { name: "Ayarlar" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Mikrofon")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sesimi tanıt" })).toBeVisible();
    await sheet.getByRole("button", { name: "Tümünü sil" }).click();
    await expect(sheet.getByText("Tüm konuşmalar kalıcı olarak silinir.")).toBeVisible();
    await run.page.waitForTimeout(500);
    await run.page.screenshot({ path: `${shots}/settings.png` });
    await sheet.getByRole("button", { name: "Vazgeç" }).click();
    await expect(sheet.getByText("Tüm konuşmalar kalıcı olarak silinir.")).toBeHidden();
    await run.page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  } finally {
    await run.close();
  }
});

test("a voice error is announced with a recovery action", async () => {
  const run = await launch();
  try {
    await emit(run.app, { type: "error", code: "VOICE_DISCONNECTED" });
    const alert = run.page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button")).toBeVisible();
    await expect(run.page.locator("body")).toHaveAttribute("data-state", "error");
    await run.page.waitForTimeout(700);
    await run.page.screenshot({ path: `${shots}/error-notice.png` });
  } finally {
    await run.close();
  }
});

test("text meets 4.5 to 1 contrast on its surface", async () => {
  const run = await launch();
  try {
    await emit(run.app, { type: "state", value: "listening" });
    await emit(run.app, { type: "caption", role: "jarvis", text: "Sizi dinliyorum." });
    await emit(run.app, {
      type: "display",
      blocks: [
        { type: "text", title: "Not", body: "Okunabilir metin" },
        { type: "list", items: ["Birinci madde"] },
      ],
    });
    await run.page.getByRole("button", { name: "Ayarlar", exact: true }).click();
    const ratios = await contrast(run.page, [
      "[data-caption]",
      "[data-status]",
      "[data-card] h2",
      "[data-card] p",
      "[data-card] li",
      "kbd",
      "#listen-toggle",
      "dialog .lede",
      "dialog [data-enroll-note]",
      "dialog label",
      "#turns-delete",
    ]);
    for (const { selector, ratio } of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  } finally {
    await run.close();
  }
});

test("the overlay mirrors state, caption and cards", async () => {
  const run = await launch();
  try {
    const overlay = await overlayPage(run.app);
    await run.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "JARVIS Overlay")
        ?.showInactive();
    });
    await emit(run.app, { type: "state", value: "speaking" });
    await emit(run.app, { type: "caption", role: "jarvis", text: "Toplantı on beş dakika sonra." });
    await emit(run.app, {
      type: "display",
      blocks: [{ type: "list", title: "Toplantı", items: ["15:00 Ürün incelemesi"] }],
    });
    await expect(overlay.locator("body")).toHaveAttribute("data-state", "speaking");
    await expect(overlay.locator("[data-caption]")).toHaveText("Toplantı on beş dakika sonra.");
    await expect(overlay.locator("[data-card]")).toHaveCount(1);
    await overlay.waitForTimeout(700);
    // CDP screenshots stall on a transparent, unfocusable window; the native capture does not.
    const png = await run.app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "JARVIS Overlay");
      return (await window?.capturePage())?.toPNG().toString("base64") ?? "";
    });
    expect(png.length).toBeGreaterThan(0);
    await writeFile(`${shots}/overlay.png`, Buffer.from(png, "base64"));
  } finally {
    await run.close();
  }
});

test("the layout holds from the minimum window to a large one", async () => {
  const run = await launch();
  try {
    await emit(run.app, { type: "state", value: "speaking" });
    await emit(run.app, {
      type: "caption",
      role: "jarvis",
      text: "Yarın sabah dokuzda ekip toplantınız var, ardından öğlen diş hekimi randevunuz.",
    });
    await emit(run.app, {
      type: "display",
      blocks: [
        { type: "list", title: "Bugün", items: ["09:00 Ekip toplantısı", "13:30 Diş hekimi"] },
        { type: "text", title: "Not", body: "Raporu cuma gününe kadar göndermeniz gerekiyor." },
      ],
    });
    for (const [width, height] of [
      [700, 560],
      [1080, 760],
      [1440, 900],
    ]) {
      await run.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "JARVIS")
            ?.setContentSize(size[0], size[1]);
        },
        [width, height],
      );
      await expect.poll(() => run.page.evaluate(() => innerWidth)).toBe(width);
      await run.page.waitForTimeout(800);
      const layout = await run.page.evaluate(() => {
        const box = (s: string) => {
          const el = document.querySelector(s);
          if (!el) throw new Error(`MISSING ${s}`);
          return el.getBoundingClientRect();
        };
        const presence = box("[data-presence]");
        const caption = box("[data-caption]");
        const stage = box("[data-stage]");
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          presenceClear: presence.right <= stage.left,
          captionClear: caption.right <= stage.left,
          stageInside: stage.right <= innerWidth && stage.top >= 0 && stage.bottom <= innerHeight,
        };
      });
      expect(layout).toEqual({
        overflow: false,
        presenceClear: true,
        captionClear: true,
        stageInside: true,
      });
      await run.page.screenshot({ path: `${shots}/layout-${width}.png` });
    }
  } finally {
    await run.close();
  }
});
