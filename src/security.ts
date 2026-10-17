import { realpath } from "node:fs/promises";
import path from "node:path";
import { invariant } from "./contracts.js";

export class EnvSecrets {
  constructor(private values: Readonly<Record<string, string | undefined>>) {}
  resolve(reference: string): string {
    const value = this.values[reference];
    invariant(value && value.length >= 8, "SECRET_UNAVAILABLE", 503);
    return value;
  }
  redact(text: string): string {
    let redacted = text;
    for (const secret of Object.values(this.values))
      if (secret && secret.length >= 8) redacted = redacted.split(secret).join("[REDACTED]");
    return redacted;
  }
}

export async function containedPath(root: string, candidate: string): Promise<string> {
  const [base, resolved] = await Promise.all([realpath(root), realpath(candidate)]);
  const relative = path.relative(base, resolved);
  invariant(
    relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
    "WORKSPACE_ESCAPE",
    403,
  );
  return resolved;
}
