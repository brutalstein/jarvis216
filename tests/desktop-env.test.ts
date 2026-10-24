import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { type Cipher, loadOperatorEnv, locateEnvFile } from "../apps/desktop/src/main/env.js";

it("asks once for the operator .env, remembers a valid pick and prefers JARVIS_ENV_FILE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-env-"));
  const store = join(dir, "jarvis.json");
  const good = join(dir, ".env");
  const bad = join(dir, "bad.env");
  await writeFile(good, "JARVIS_TOKEN=operator-token\nPORT=2160\n");
  await writeFile(bad, "PORT=2160\n");

  expect(await locateEnvFile(undefined, store, async () => bad)).toBe(bad);
  await expect(readFile(store, "utf8")).rejects.toThrow();

  const pick = vi.fn(async () => good);
  expect(await locateEnvFile(undefined, store, pick)).toBe(good);
  expect(await locateEnvFile(undefined, store, pick)).toBe(good);
  expect(pick).toHaveBeenCalledTimes(1);

  expect(await locateEnvFile("C:/explicit/.env", store, pick)).toBe("C:/explicit/.env");
  expect(await locateEnvFile(undefined, join(dir, "none.json"), async () => undefined)).toBe("");
});

// Stands in for safeStorage (DPAPI): reversible, and never the plaintext on disk.
const cipher: Cipher = {
  encrypt: (text) => Buffer.from(Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString("utf8"),
};

it("keeps an encrypted copy of the operator .env that follows edits and outlives the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-env-"));
  const store = join(dir, "operator.env");
  const file = join(dir, ".env");
  await writeFile(file, "JARVIS_TOKEN=first-secret-token\nPORT=2170\n");

  const first = loadOperatorEnv(store, file, cipher);
  expect(first).toMatchObject({
    source: file,
    imported: true,
    coreUrl: "http://127.0.0.1:2170",
    coreToken: "first-secret-token",
  });
  expect(await readFile(store, "utf8")).not.toContain("first-secret-token");
  // Unchanged file: served from the copy, nothing rewritten.
  expect(loadOperatorEnv(store, undefined, cipher).imported).toBe(false);

  await writeFile(file, "JARVIS_TOKEN=second-secret-token\nGEMINI_API_KEY=g\n");
  await utimes(file, new Date(), new Date(Date.now() + 5000));
  const edited = loadOperatorEnv(store, undefined, cipher);
  expect(edited).toMatchObject({ imported: true, coreToken: "second-secret-token" });
  expect(edited.values.GEMINI_API_KEY).toBe("g");

  await rm(file);
  expect(loadOperatorEnv(store, undefined, cipher)).toMatchObject({
    source: file,
    imported: false,
    coreToken: "second-secret-token",
  });
});

it("never stores a file that is not an operator env and needs a source the first time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-env-"));
  const store = join(dir, "operator.env");
  const bad = join(dir, "bad.env");
  await writeFile(bad, "PORT=2160\n");
  expect(() => loadOperatorEnv(store, undefined, cipher)).toThrow("ENV_MISSING");
  expect(() => loadOperatorEnv(store, bad, cipher)).toThrow("TOKEN_MISSING");
  await expect(readFile(store)).rejects.toThrow();
  // A copy another Windows user encrypted (or a damaged one) is re-imported from the source.
  await writeFile(store, "not decryptable");
  await writeFile(bad, "JARVIS_TOKEN=valid-token\n");
  expect(loadOperatorEnv(store, bad, cipher).coreToken).toBe("valid-token");
});
