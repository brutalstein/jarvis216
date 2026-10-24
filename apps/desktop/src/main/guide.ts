import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import type { PlanView } from "../shared";

type GuidePanel = Extract<PlanView["panels"][number], { type: "guide" }>;
export type GuideCheck = NonNullable<GuidePanel["check"]>;
/** missing: nothing yet; rejected: the vendor refused it; present: saved, no test; verified: works. */
export type GuideState = "missing" | "rejected" | "present" | "verified";

// Core's own secrets are never written from a guide, whatever a page or model asked for.
const envName = /^(?!(JARVIS|POSTGRES|DATABASE|VOICE)_)[A-Z][A-Z0-9_]{1,62}$/;
// Keys and ids are single tokens; quotes, comment marks and spaces would change how .env parses.
const valuePattern = /^[^\s"'`#\\]{1,4096}$/;

/** True when the vendor accepts the value, false when it refuses it, undefined when unknown. */
export async function probe(
  verify: NonNullable<GuideCheck["verify"]>,
  value: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean | undefined> {
  const target = new URL(verify.url);
  const local = target.protocol === "http:" && ["127.0.0.1", "localhost"].includes(target.hostname);
  if ((target.protocol !== "https:" && !local) || target.username || target.password)
    return undefined;
  const status = async (candidate: string) => {
    const url = new URL(target);
    const headers: Record<string, string> = { accept: "application/json" };
    if (verify.in === "header") headers[verify.name] = `${verify.prefix ?? ""}${candidate}`;
    else url.searchParams.set(verify.name, candidate);
    try {
      // A redirect would carry the value to an address the guide never named.
      const response = await fetcher(url, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      return response.status;
    } catch {
      return 0;
    }
  };
  const refused = (code: number) => code === 401 || code === 403;
  // A page that answers any value (a docs page, an open endpoint) proves nothing: a made-up
  // value must be refused first.
  if (!refused(await status(`invalid-${randomUUID()}`))) return undefined;
  const code = await status(value);
  return code >= 200 && code < 300 ? true : refused(code) ? false : undefined;
}

/** Sets one NAME=value line in the operator's .env, keeping every other line as it was. */
export async function saveValue(file: string, name: string, value: string): Promise<void> {
  if (!envName.test(name) || !valuePattern.test(value)) throw new Error("INVALID_VALUE");
  const source = await readFile(file, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const line = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  const index = lines.findIndex((item) => line.test(item));
  if (index >= 0) lines[index] = `${name}=${value}`;
  else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, lines.join(eol), { mode: 0o600 });
  await rename(temporary, file);
}

/**
 * Checks what the guide asked the operator to obtain. A pasted value is tested first and saved
 * only if the vendor did not refuse it; without one, the value already in .env is tested.
 */
export async function checkGuide(
  file: string,
  check: GuideCheck,
  value?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ state: GuideState; saved: boolean }> {
  if (!envName.test(check.env)) throw new Error("INVALID_CHECK");
  const pasted = value?.trim();
  if (pasted !== undefined && !valuePattern.test(pasted)) throw new Error("INVALID_VALUE");
  const current = pasted ?? parseEnv(await readFile(file, "utf8"))[check.env]?.trim();
  if (!current) return { state: "missing", saved: false };
  const works = check.verify ? await probe(check.verify, current, fetcher) : undefined;
  if (works === false) return { state: "rejected", saved: false };
  if (pasted !== undefined) await saveValue(file, check.env, pasted);
  return { state: works ? "verified" : "present", saved: pasted !== undefined };
}

/** Restarts Core with the repo's service script so it reads the new value; false if absent. */
export function restartCore(envFile: string): boolean {
  const script = path.join(path.dirname(envFile), "scripts", "jarvis-services.ps1");
  if (process.platform !== "win32" || !existsSync(script)) return false;
  spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Action",
      "Restart",
      "-Service",
      "core",
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref();
  return true;
}
