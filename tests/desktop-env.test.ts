import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { locateEnvFile } from "../apps/desktop/src/main/env.js";

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
