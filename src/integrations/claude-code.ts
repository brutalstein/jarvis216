import { spawn } from "node:child_process";
import { z } from "zod";
import type { ExecutionResult, Executor, Task } from "../contracts.js";
import { ProviderFailure } from "../routing.js";

// Only what Claude Code needs to find its own subscription login. ANTHROPIC_API_KEY and every
// other variable stay out, so billing is the operator's subscription, never an API key.
export const claudeCodeEnvKeys = [
  "PATH",
  "SystemRoot",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
] as const;
const maxStdout = 1024 * 1024;
const Output = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  session_id: z.string().optional(),
});

function failure(text: string): ProviderFailure {
  if (/organization has disabled Claude subscription access/i.test(text))
    return new ProviderFailure("policy-denied", false, false);
  if (/\/login|not logged in|authenticat|oauth/i.test(text))
    return new ProviderFailure("authentication-required", false, false);
  if (/usage limit|rate.?limit|\b429\b/i.test(text))
    return new ProviderFailure("rate-limited", true);
  if (/overloaded|\b5\d\d\b/i.test(text)) return new ProviderFailure("transient", true);
  return new ProviderFailure("invalid-response", false);
}

// Runs the unmodified official binary headless: no tools, no MCP, no user settings or hooks.
// The OAuth login stays inside Claude Code; Core never sees the token.
export class ClaudeCodeExecutor implements Executor {
  readonly id = "claude-code";
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe = true;
  readonly outputTokenLimitEnforced = false;
  constructor(
    private options: { command: readonly [string, ...string[]]; model: string; workdir: string },
  ) {}
  execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
    const { command, model, workdir } = this.options;
    const env = Object.fromEntries(
      claudeCodeEnvKeys.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
    );
    return new Promise((resolve, reject) => {
      const child = spawn(
        command[0],
        [
          ...command.slice(1),
          "-p",
          "--output-format",
          "json",
          "--model",
          model,
          "--tools",
          "",
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--disable-slash-commands",
          "--no-session-persistence",
          "--safe-mode",
        ],
        { cwd: workdir, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      let oversized = false;
      let stdoutBytes = 0;
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        if (oversized) return;
        stdoutBytes += Buffer.byteLength(chunk, "utf8");
        if (stdoutBytes > maxStdout) {
          oversized = true;
          child.kill();
        } else stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
      });
      child.on("error", () => {
        signal.removeEventListener("abort", abort);
        reject(new ProviderFailure("provider-unavailable", true, false));
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
        if (oversized) return reject(new ProviderFailure("invalid-response", false));
        let parsed: z.infer<typeof Output>;
        try {
          parsed = Output.parse(JSON.parse(stdout));
        } catch {
          return reject(
            code === 0 ? new ProviderFailure("invalid-response", false) : failure(stderr),
          );
        }
        if (parsed.is_error || code !== 0)
          return reject(failure(`${parsed.result ?? ""} ${stderr}`));
        resolve({
          text: parsed.result ?? "",
          source: `claude-code:${model}:subscription`,
          ...(parsed.session_id ? { externalId: parsed.session_id } : {}),
        });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(task.spec.objective);
    });
  }
}
