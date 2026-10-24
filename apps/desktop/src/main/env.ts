import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

export type OperatorValues = Record<string, string>;

function settings(values: OperatorValues): { coreUrl: string; coreToken: string } {
  if (!values.JARVIS_TOKEN?.trim()) throw new Error("TOKEN_MISSING");
  const port = Number(values.PORT ?? "2160");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT_INVALID");
  return { coreUrl: `http://127.0.0.1:${port}`, coreToken: values.JARVIS_TOKEN };
}

export function readOperatorEnv(file: string): { coreUrl: string; coreToken: string } {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    throw new Error("ENV_MISSING");
  }
  return settings(parseEnv(source) as OperatorValues);
}

// Installed clients remember the operator's chosen .env; JARVIS_ENV_FILE still wins. Only a
// file that parses as an operator env is remembered, so a wrong pick is asked again next start.
export async function locateEnvFile(
  explicit: string | undefined,
  store: string,
  pick: () => Promise<string | undefined>,
): Promise<string> {
  if (explicit) return explicit;
  try {
    const saved = JSON.parse(readFileSync(store, "utf8")).envFile;
    if (typeof saved === "string") {
      readOperatorEnv(saved);
      return saved;
    }
  } catch {}
  const chosen = await pick();
  if (!chosen) return "";
  try {
    readOperatorEnv(chosen);
    writeFileSync(store, JSON.stringify({ envFile: chosen }));
  } catch {}
  return chosen;
}

export type Cipher = { encrypt(text: string): Buffer; decrypt(data: Buffer): string };
type Copy = { source: string; mtimeMs: number; text: string };

/**
 * The operator's .env, kept encrypted (Windows DPAPI through Electron safeStorage) in the app's
 * own folder, so JARVIS starts without asking for a file. The plaintext file is read again only
 * when it changes; once it is gone, the encrypted copy alone still starts JARVIS. Only a file
 * that parses as an operator env is ever stored.
 */
export function loadOperatorEnv(
  store: string,
  source: string | undefined,
  cipher: Cipher,
): {
  source: string;
  values: OperatorValues;
  coreUrl: string;
  coreToken: string;
  imported: boolean;
} {
  let saved: Copy | undefined;
  try {
    saved = JSON.parse(cipher.decrypt(readFileSync(store)));
  } catch {}
  const file = source || saved?.source;
  let current = saved;
  try {
    if (file) {
      const { mtimeMs } = statSync(file);
      if (saved?.source !== file || saved.mtimeMs !== mtimeMs)
        current = { source: file, mtimeMs, text: readFileSync(file, "utf8") };
    }
  } catch {}
  if (!current) throw new Error("ENV_MISSING");
  const values = parseEnv(current.text) as OperatorValues;
  const result = { source: current.source, values, ...settings(values) };
  const imported = current !== saved;
  if (imported) {
    const temporary = `${store}.${process.pid}.tmp`;
    writeFileSync(temporary, cipher.encrypt(JSON.stringify(current)), { mode: 0o600 });
    renameSync(temporary, store);
  }
  return { ...result, imported };
}
