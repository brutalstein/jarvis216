import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { type ExecutionResult, type Executor, type Task, taskDeadline } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";

const exec = promisify(execFile);
const Request = z.strictObject({ action: z.literal("github.profile"), args: z.strictObject({}) });
const Profile = z
  .object({
    id: z.number().int().positive(),
    login: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i),
    url: z.string(),
  })
  .refine((profile) => profile.url === `https://github.com/${profile.login}`);

// Credentials stay in gh's native login store; prompts never become commands or endpoints.
export class GitHubExecutor implements Executor {
  readonly id = "github-cli";
  readonly capability = "info.fetch";
  readonly external = true;
  readonly retrySafe = true;
  constructor(private options: { command: readonly [string, ...string[]] }) {}

  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    if (task.spec.capability !== this.capability || !Request.safeParse(task.spec.input).success)
      throw new ProviderFailure("permanent", false, false);
    const timeout = Math.min(30_000, taskDeadline(task) - Date.now());
    if (timeout <= 0) throw new ProviderFailure("transient", false, false);
    let stdout: string;
    try {
      ({ stdout } = await exec(
        this.options.command[0],
        [
          ...this.options.command.slice(1),
          "api",
          "--hostname",
          "github.com",
          "--method",
          "GET",
          "user",
          "--jq",
          "{login:.login,id:.id,url:.html_url}",
        ],
        {
          signal,
          timeout,
          maxBuffer: 8192,
          windowsHide: true,
          shell: false,
          encoding: "utf8",
          env: {
            ...Object.fromEntries(
              [
                "PATH",
                "SystemRoot",
                "USERPROFILE",
                "HOME",
                "APPDATA",
                "LOCALAPPDATA",
                "GH_CONFIG_DIR",
              ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
            ),
            GH_HOST: "github.com",
            GH_PROMPT_DISABLED: "1",
          },
        },
      ));
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      const failed = error as { code?: string | number; stderr?: string; killed?: boolean };
      if (failed.code === "ENOENT" || failed.code === "EACCES")
        throw new ProviderFailure("provider-unavailable", true, false);
      if (failed.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        throw new ProviderFailure("invalid-response", false);
      if (failed.code === 4 || /auth login|not logged in|HTTP 401/i.test(failed.stderr ?? ""))
        throw new ProviderFailure("authentication-required", false);
      if (/HTTP 429|rate limit/i.test(failed.stderr ?? ""))
        throw new ProviderFailure("rate-limited", true);
      if (failed.killed || /HTTP 5\d\d|connect|timeout/i.test(failed.stderr ?? ""))
        throw new ProviderFailure("transient", true);
      throw new ProviderFailure("permanent", false);
    }
    let profile: z.infer<typeof Profile>;
    try {
      profile = Profile.parse(JSON.parse(stdout));
    } catch {
      throw new ProviderFailure("invalid-response", false);
    }
    return {
      text: JSON.stringify({ authenticated: true, login: profile.login, url: profile.url }),
      source: "github:authenticated-profile",
      externalId: String(profile.id),
    };
  }
}
