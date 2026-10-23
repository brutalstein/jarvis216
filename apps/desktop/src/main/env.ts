import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function readOperatorEnv(file: string): { coreUrl: string; coreToken: string } {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    throw new Error("ENV_MISSING");
  }
  const values = parseEnv(source);
  if (!values.JARVIS_TOKEN?.trim()) throw new Error("TOKEN_MISSING");
  const port = Number(values.PORT ?? "2160");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT_INVALID");
  return { coreUrl: `http://127.0.0.1:${port}`, coreToken: values.JARVIS_TOKEN };
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
