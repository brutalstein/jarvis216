import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";
import { _electron, expect } from "@playwright/test";
import yaml from "js-yaml";

const desktop = dirname(fileURLToPath(import.meta.url));
const output = resolve(desktop, "../../artifacts/desktop-release");
const archive = join(output, "win-unpacked/resources/app.asar");
const files = listPackage(archive).map((file) => file.replaceAll("\\", "/"));
assert(files.includes("/dist/main.cjs"));
assert(files.includes("/dist/splash.html") && files.includes("/dist/icon.png"));
assert(files.some((file) => file.startsWith("/node_modules/electron-updater/")));
assert(
  !files.some((file) => /(?:^|\/)\.env(?:\.|$)|auth\.json$|^\/(?:data|workers|tests)\//.test(file)),
);
assert(!files.some((file) => /\/node_modules\/(?:@anthropic-ai|electron-builder)\//.test(file)));
const pkg = JSON.parse(extractFile(archive, "package.json").toString());
const metadata = yaml.load(await readFile(join(output, "latest.yml"), "utf8"));
const installer = await readFile(join(output, metadata.path));
assert.equal(installer.subarray(0, 2).toString(), "MZ");
assert.equal(createHash("sha512").update(installer).digest("base64"), metadata.sha512);
assert.equal(metadata.version, pkg.version);
const feed = yaml.load(
  await readFile(join(output, "win-unpacked/resources/app-update.yml"), "utf8"),
);
assert.equal(feed.provider, "github");
assert.equal(feed.owner, "brutalstein");
assert.equal(feed.repo, "jarvis216");

const dir = await mkdtemp(join(tmpdir(), "jarvis-package-"));
let app;
const updaterErrors = new Set();
try {
  const envFile = join(dir, ".env");
  await writeFile(envFile, "PORT=1\nJARVIS_TOKEN=synthetic-package-test-token\n");
  const env = Object.fromEntries(
    ["PATH", "SystemRoot", "SYSTEMROOT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  app = await _electron.launch({
    executablePath: join(output, "win-unpacked/J.A.R.V.I.S.exe"),
    args: [`--user-data-dir=${join(dir, "profile")}`],
    env: { ...env, JARVIS_DESKTOP_TEST: "1", JARVIS_ENV_FILE: envFile, JARVIS_REPO_ROOT: dir },
  });
  app.process().stderr.on("data", (chunk) => {
    for (const code of String(chunk).match(/\bERR_UPDATER_[A-Z_]+\b/g) ?? [])
      updaterErrors.add(code);
  });
  await expect
    .poll(() => app.windows().find((page) => page.url().endsWith("/index.html")))
    .toBeTruthy();
  const page = app.windows().find((page) => page.url().endsWith("/index.html"));
  await page.waitForLoadState("domcontentloaded");
  assert.equal(await app.evaluate(({ app: electron }) => electron.isPackaged), true);
  assert.equal(
    await app.evaluate(({ app: electron }) => electron.getPath("userData")),
    join(dir, "profile"),
  );
  await page.getByRole("button", { name: "Güncellemeler", exact: true }).click();
  await page.getByRole("dialog", { name: "Güncellemeler" }).waitFor();
  const state = await page.evaluate(() => window.jarvis.updates.status());
  assert.equal(state.phase, "idle");
  assert.equal(state.version, pkg.version);
  let feedCheck = "NOT_RUN";
  if (process.argv.includes("--live-feed")) {
    await page.getByRole("button", { name: "Güncellemeleri denetle" }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.jarvis.updates.status())).phase, {
        timeout: 30_000,
      })
      .toMatch(/^(current|available|error)$/);
    feedCheck = (await page.evaluate(() => window.jarvis.updates.status())).phase;
    assert(
      ["current", "available", "error"].includes(feedCheck),
      `Unexpected live feed state: ${feedCheck}`,
    );
  }
  await page.screenshot({ path: join(output, "packaged-updates.png"), animations: "disabled" });
  const receipt = {
    checkedAt: new Date().toISOString(),
    version: pkg.version,
    installer: metadata.path,
    installerSha256: createHash("sha256").update(installer).digest("hex"),
    manifestSha512Matches: true,
    isolatedProfile: true,
    packagedShell: true,
    archiveFiles: files.length,
    operatorFilesExcluded: true,
    updaterPhase: state.phase,
    signaturePublisherConfigured: Boolean(feed.publisherName),
    feedCheck,
    updaterErrors: [...updaterErrors],
    liveCoreAndVoice: "NOT_RUN",
    signedUpgrade: "BLOCKED",
    publishedRelease: false,
  };
  await writeFile(join(output, "verification.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
}
