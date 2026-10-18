import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect } from "@playwright/test";

export const coreSecret = "core-test-secret-must-never-reach-the-renderer";
export async function launch(
  options: { missing?: boolean; extraEnv?: Record<string, string>; args?: string[] } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-desktop-"));
  const file = join(dir, ".env");
  if (!options.missing) await writeFile(file, `PORT=2161\nJARVIS_TOKEN=${coreSecret}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JARVIS_ENV_FILE: file,
    JARVIS_DESKTOP_TEST: "1",
    ...options.extraEnv,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const cleanEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const app = await _electron.launch({
    args: [resolve("."), ...(options.args ?? [])],
    env: cleanEnv,
  });
  await expect
    .poll(() => app.windows().find((page) => page.url().endsWith("/index.html")))
    .toBeTruthy();
  const page = app.windows().find((page) => page.url().endsWith("/index.html"));
  if (!page) throw new Error("MAIN_WINDOW_MISSING");
  await page.waitForLoadState("domcontentloaded");
  return {
    app,
    page,
    async close() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function emit(app: ElectronApplication, event: unknown) {
  await app.evaluate(({ BrowserWindow }, data) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("test:emit", data);
  }, event);
}
