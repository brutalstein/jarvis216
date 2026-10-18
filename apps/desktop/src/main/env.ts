import { readFileSync } from "node:fs";
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
