import { spawn } from "node:child_process";
import { z } from "zod";
import type { ExecutionResult, Executor, Task } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";

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
  usage: z
    .object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) })
    .optional()
    .catch(undefined),
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
export type ClaudeAgentOptions = {
  maxTurns: number;
  permissionMode: "auto" | "acceptEdits" | "plan" | "dontAsk";
  mcpConfig?: string;
  // Additional MCP sources are additive; preserve the operator's installed servers.
  mcpConfigs?: readonly string[];
  // Core supplies the *current* Settings grant, not a startup snapshot.
  autonomous?: () => boolean;
};
export class ClaudeCodeExecutor implements Executor {
  readonly id: "claude-code" | "claude-agent";
  readonly capability = "text.generate";
  readonly external = true;
  readonly retrySafe: boolean;
  readonly riskFloor?: "HIGH";
  readonly outputTokenLimitEnforced = false;
  constructor(
    private options: {
      command: readonly [string, ...string[]];
      model: string;
      workdir: string;
      agent?: ClaudeAgentOptions;
    },
  ) {
    this.id = options.agent ? "claude-agent" : "claude-code";
    this.retrySafe = !options.agent;
    if (options.agent) this.riskFloor = "HIGH";
  }
  execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
    const { command, model, workdir } = this.options;
    const env = {
      ...Object.fromEntries(
        claudeCodeEnvKeys.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
      ),
      // Lightweight conversational Claude remains free of workspace context.
      // The tool-using agent intentionally loads project guidance and skills.
      ...(!this.options.agent
        ? {
            CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
            CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
          }
        : {}),
    };
    const autonomous = this.options.agent?.autonomous?.() === true;
    const flags = this.options.agent
      ? [
          "-p",
          "--output-format",
          "json",
          "--model",
          model,
          "--tools",
          "default",
          "--permission-mode",
          autonomous ? "acceptEdits" : this.options.agent.permissionMode,
          "--max-turns",
          String(this.options.agent.maxTurns),
          ...(this.options.agent.mcpConfigs?.length
            ? ["--mcp-config", ...this.options.agent.mcpConfigs]
            : this.options.agent.mcpConfig
              ? ["--strict-mcp-config", "--mcp-config", this.options.agent.mcpConfig]
              : []),
          // The operator's Full Access preset preauthorizes native and installed MCP tools.
          // Still honors Claude-managed deny rules and the Core's per-action admission.
          ...(autonomous
            ? [
                "--allowedTools",
                "Bash",
                "Read",
                "Write",
                "Edit",
                "Glob",
                "Grep",
                "WebFetch",
                "WebSearch",
                "mcp__*",
              ]
            : []),
          "--setting-sources",
          "user,project,local",
          "--no-session-persistence",
        ]
      : [
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
        ];
    return new Promise((resolve, reject) => {
      const child = spawn(command[0], [...command.slice(1), ...flags], {
        cwd: workdir,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
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
          source: `${this.id}:${model}:subscription`,
          ...(parsed.session_id ? { externalId: parsed.session_id } : {}),
          ...(parsed.usage && {
            usage: {
              inputTokens: parsed.usage.input_tokens,
              outputTokens: parsed.usage.output_tokens,
            },
          }),
        });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(task.spec.objective);
    });
  }
}
