import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

test("local microphone transport reaches Core and plays a spoken reply", async () => {
  test.skip(process.env.JARVIS_E2E !== "1", "Requires local GPU models and the isolated dev Core");
  test.setTimeout(180000);
  const sample = resolve("../../data/voice/samples/e2e-tr.wav");
  const store = await mkdtemp(join(tmpdir(), "jarvis-voice-e2e-"));
  const run = await launch({
    extraEnv: {
      JARVIS_DESKTOP_TEST: "0",
      JARVIS_ENV_FILE: resolve("../../.env.voice-dev"),
      VOICE_DATA_DIR: store,
    },
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${sample}`,
    ],
  });
  const errors: string[] = [];
  const timings: string[] = [];
  run.page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  run.page.on("pageerror", (error) => errors.push(error.message));
  run.app.process().stderr?.on("data", (chunk) => {
    const text = String(chunk);
    if (text.includes("VOICE_") || text.includes("Error") || text.includes("failed"))
      console.log(text.slice(0, 2000));
  });
  run.app.process().stdout?.on("data", (chunk) => {
    const line = String(chunk);
    if (line.includes('"event":"turn.timing"')) timings.push(line);
  });
  try {
    await expect(run.page.locator("body")).toHaveAttribute(
      "data-state",
      /listening|thinking|speaking/,
      { timeout: 60000 },
    );
    await expect(run.page.locator("[data-caption]")).not.toBeEmpty({ timeout: 60000 });
    await expect
      .poll(
        async () => {
          const exported = await run.page.evaluate(() => window.jarvis.turns.export());
          return JSON.stringify(exported);
        },
        { timeout: 60000 },
      )
      .toMatch(/(?:[JjCcÇç]arv[iı]s)/);
    await expect.poll(() => timings.length, { timeout: 30000 }).toBeGreaterThan(0);
    console.log(timings.join("").trim());
    await expect
      .poll(() =>
        run.page.evaluate(() => {
          const audio = document.querySelector("audio");
          return Boolean(
            audio &&
              audio.srcObject instanceof MediaStream &&
              !audio.paused &&
              audio.currentTime > 0,
          );
        }),
      )
      .toBe(true);
    // Enrollment uses a disposable voice print; the operator's own print is never touched.
    await run.page.evaluate(() => window.jarvis.enrollment.start());
    await expect
      .poll(
        () =>
          run.page.evaluate(async () => {
            const voice = await window.jarvis.voice();
            const response = await fetch(`${voice.url}/health`, {
              headers: { authorization: `Bearer ${voice.token}` },
            });
            return (await response.json()).seconds;
          }),
        { timeout: 90000, intervals: [2000] },
      )
      .toBeGreaterThanOrEqual(25);
    await run.page.evaluate(() => window.jarvis.enrollment.finish());
    const enrolled = await run.page.evaluate(async () => {
      const voice = await window.jarvis.voice();
      return (
        await (
          await fetch(`${voice.url}/health`, {
            headers: { authorization: `Bearer ${voice.token}` },
          })
        ).json()
      ).enrolled;
    });
    expect(enrolled).toBe(true);
    await expect(run.page.locator("[data-caption]")).toBeVisible({ timeout: 30000 });
    await expect.poll(() => timings.length, { timeout: 30000 }).toBeGreaterThan(1);
    await run.page.evaluate(() => window.jarvis.enrollment.remove());
  } catch (error) {
    console.log("Renderer errors:", errors.map((text) => text.slice(0, 400)).join("\n"));
    throw error;
  } finally {
    await run.close();
    await rm(store, { recursive: true, force: true });
  }
});
