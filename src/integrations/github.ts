import { spawn } from "node:child_process";
import { z } from "zod";
import { type ExecutionResult, type Executor, type Task, taskDeadline } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";

const owner = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
const repo = z
  .string()
  .regex(/^[a-z\d_.-]{1,100}$/i)
  .refine((value) => value !== "." && value !== "..");
const repository = { owner, repo };
const limit = z.number().int().min(1).max(30).default(10);
const issueNumber = z.number().int().min(1).max(2_147_483_647);
export const githubActionSchemas = {
  "github.profile": z.strictObject({}),
  "github.repositories": z.strictObject({ owner: owner.optional(), limit }),
  "github.repository": z.strictObject(repository),
  "github.file": z.strictObject({
    ...repository,
    path: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          !value.includes("\\") &&
          Array.from(value).every((char) => char.charCodeAt(0) >= 32) &&
          value.split("/").every((part) => part !== "." && part !== ".." && part !== ""),
      ),
    ref: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z\d_./-]+$/i)
      .optional(),
  }),
  "github.issues": z.strictObject({ ...repository, limit }),
  "github.issue": z.strictObject({ ...repository, number: issueNumber }),
  "github.issue_create": z.strictObject({
    ...repository,
    title: z.string().trim().min(1).max(256),
    body: z.string().max(8000),
  }),
};
const Profile = z
  .object({ id: z.number().int().positive(), login: owner, html_url: z.string() })
  .refine((value) => value.html_url === `https://github.com/${value.login}`);
const Repo = z
  .object({
    id: z.number().int().positive(),
    name: repo,
    full_name: z.string(),
    private: z.boolean(),
    html_url: z.string(),
    default_branch: z.string().max(200).nullable(),
  })
  .refine(
    (value) =>
      value.full_name.endsWith(`/${value.name}`) &&
      value.full_name.split("/").length === 2 &&
      value.html_url === `https://github.com/${value.full_name}`,
  );
const Issue = z.object({
  id: z.number().int().positive(),
  number: issueNumber,
  title: z.string().max(256),
  body: z.string().max(16000).nullable(),
  state: z.enum(["open", "closed"]),
  html_url: z.string(),
});
const File = z.object({
  type: z.literal("file"),
  path: z.string(),
  size: z.number().int().min(0).max(32000),
  encoding: z.literal("base64"),
  content: z.string().max(44000),
  sha: z.string().regex(/^[a-f\d]{40,64}$/i),
  html_url: z.string(),
});
const inherited = [
  "PATH",
  "SystemRoot",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "GH_CONFIG_DIR",
];
const evidence = (
  ok: boolean,
  kind: "observed" | "refused" | "incomplete",
  observation: string,
  data?: unknown,
): ExecutionResult => ({
  text: JSON.stringify({
    ok,
    evidence: kind,
    observation,
    provenance: "standalone:gh-native-auth",
    ...(data !== undefined && { data }),
  }),
  source: `github-cli:${kind}`,
  outcome: {
    status: ok ? "completed" : kind === "refused" ? "blocked" : "incomplete",
    verified: ok,
  },
});

/** Fixed gh API routes; authentication remains in the CLI's native store. */
export class GitHubExecutor implements Executor {
  readonly id = "github-cli";
  readonly capability = "tool.execute";
  readonly external = true;
  readonly retrySafe = false;
  // An interrupted write is uncertain; Core must not infer its outcome from an error.
  readonly outcomeObservable = false;
  constructor(private options: { command: readonly [string, ...string[]] }) {}

  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    signal.throwIfAborted();
    const input = z
      .strictObject({ action: z.string(), args: z.record(z.string(), z.unknown()) })
      .safeParse(task.spec.input);
    if (
      task.spec.capability !== this.capability ||
      !input.success ||
      !Object.hasOwn(githubActionSchemas, input.data.action)
    )
      return evidence(false, "refused", "Invalid GitHub action");
    const action = input.data.action as keyof typeof githubActionSchemas;
    const parsed = githubActionSchemas[action].safeParse(input.data.args);
    if (!parsed.success || (action === "github.issue_create" && task.spec.risk !== "HIGH"))
      return evidence(false, "refused", "Invalid arguments or insufficient action risk");
    const args = parsed.data as Record<string, string | number>;
    const base = `repos/${args.owner}/${args.repo}`;
    const issue = (raw: unknown) => {
      const value = Issue.parse(raw);
      if (value.html_url !== `https://github.com/${args.owner}/${args.repo}/issues/${value.number}`)
        throw new Error("INVALID_ISSUE_URL");
      return value;
    };
    let data: unknown;
    try {
      switch (action) {
        case "github.profile": {
          const value = Profile.parse(await this.request("user", "GET", task, signal));
          data = { authenticated: true, login: value.login, url: value.html_url };
          break;
        }
        case "github.repositories": {
          const endpoint = args.owner ? `users/${args.owner}/repos` : "user/repos";
          const values = z
            .array(Repo)
            .max(Number(args.limit))
            .parse(
              await this.request(`${endpoint}?per_page=${args.limit}&page=1`, "GET", task, signal),
            );
          if (
            args.owner &&
            values.some(
              (value) =>
                value.full_name.split("/")[0]?.toLowerCase() !== String(args.owner).toLowerCase(),
            )
          )
            throw new Error("INVALID_REPOSITORY_OWNER");
          data = {
            repositories: values,
            limit: args.limit,
            page: 1,
            truncated: values.length === args.limit,
          };
          break;
        }
        case "github.repository": {
          const value = Repo.parse(await this.request(base, "GET", task, signal));
          if (value.full_name.toLowerCase() !== `${args.owner}/${args.repo}`.toLowerCase())
            throw new Error("INVALID_REPOSITORY");
          data = value;
          break;
        }
        case "github.file": {
          const endpoint = `${base}/contents/${String(args.path).split("/").map(encodeURIComponent).join("/")}${args.ref ? `?ref=${encodeURIComponent(args.ref)}` : ""}`;
          const value = File.parse(await this.request(endpoint, "GET", task, signal));
          const encoded = value.content.replace(/\n/g, "");
          if (
            value.path !== args.path ||
            !value.html_url.startsWith(`https://github.com/${args.owner}/${args.repo}/blob/`) ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
          )
            throw new Error("INVALID_FILE");
          const content = Buffer.from(encoded, "base64");
          if (content.length !== value.size) throw new Error("INVALID_FILE_SIZE");
          data = {
            path: value.path,
            sha: value.sha,
            content: new TextDecoder("utf-8", { fatal: true }).decode(content),
            url: value.html_url,
          };
          break;
        }
        case "github.issues": {
          const values = z
            .array(z.unknown())
            .max(Number(args.limit))
            .parse(
              await this.request(
                `${base}/issues?state=open&per_page=${args.limit}&page=1`,
                "GET",
                task,
                signal,
              ),
            );
          data = {
            issues: values
              .filter((value) => !value || typeof value !== "object" || !("pull_request" in value))
              .map(issue),
            limit: args.limit,
            page: 1,
            truncated: values.length === args.limit,
          };
          break;
        }
        case "github.issue": {
          const value = issue(
            await this.request(`${base}/issues/${args.number}`, "GET", task, signal),
          );
          if (value.number !== args.number) throw new Error("INVALID_ISSUE_NUMBER");
          data = value;
          break;
        }
        case "github.issue_create": {
          const created = issue(
            await this.request(`${base}/issues`, "POST", task, signal, {
              title: args.title,
              body: args.body,
            }),
          );
          const observed = issue(
            await this.request(`${base}/issues/${created.number}`, "GET", task, signal),
          );
          if (
            observed.id !== created.id ||
            observed.title !== args.title ||
            (observed.body ?? "") !== args.body
          )
            return evidence(false, "incomplete", "Issue creation was not independently verified");
          data = observed;
          break;
        }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure("invalid-response", false);
    }
    const result = evidence(true, "observed", `${action} verified through GitHub API`, data);
    const observed = data as Record<string, unknown>;
    const preview =
      action === "github.profile"
        ? `${observed.login}\n${observed.url}`
        : action === "github.repositories"
          ? [
              ...(observed.repositories as z.infer<typeof Repo>[]).map(
                (repo) => `${repo.full_name} (${repo.private ? "private" : "public"})`,
              ),
              ...(observed.truncated
                ? ["More repositories are available; this is the first page."]
                : []),
            ].join("\n")
          : action === "github.repository"
            ? `${observed.full_name}\nBranch: ${observed.default_branch}\n${observed.html_url}`
            : action === "github.file"
              ? String(observed.content)
              : action === "github.issues"
                ? (observed.issues as z.infer<typeof Issue>[])
                    .map((issue) => `#${issue.number} ${issue.title} (${issue.state})`)
                    .join("\n") || "No open issues."
                : `#${observed.number} ${observed.title}\n${observed.body ?? ""}`;
    const body = JSON.parse(result.text);
    body.panel = {
      type: "text",
      title: action === "github.file" ? String(observed.path) : "GitHub",
      body: preview.slice(0, 4000) + (preview.length > 4000 ? "\n[Preview shortened]" : ""),
    };
    result.text = JSON.stringify(body);
    if (result.text.length > 64000) throw new ProviderFailure("invalid-response", false);
    return result;
  }

  private request(
    endpoint: string,
    method: "GET" | "POST",
    task: Task,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> {
    const timeout = Math.min(30000, taskDeadline(task) - Date.now());
    if (timeout <= 0) return Promise.reject(new ProviderFailure("transient", false, false));
    return new Promise((resolve, reject) => {
      const argv = [
        ...this.options.command.slice(1),
        "api",
        "--hostname",
        "github.com",
        "--method",
        method,
        endpoint,
        // Bound the needed metadata before capturing GitHub's much larger repository objects.
        ...(/^(?:user|users\/[^/]+)\/repos\?/.test(endpoint)
          ? ["--jq", "map({id,name,full_name,private,html_url,default_branch})"]
          : []),
        ...(body !== undefined ? ["--input", "-"] : []),
      ];
      const child = spawn(this.options.command[0], argv, {
        shell: false,
        windowsHide: true,
        env: {
          ...Object.fromEntries(
            inherited.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
          ),
          GH_HOST: "github.com",
          GH_PROMPT_DISABLED: "1",
          GH_PAGER: "cat",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let oversized = false;
      let timedOut = false;
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 128000) {
          oversized = true;
          child.kill();
        } else stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(0, 8192);
      });
      child.stdin.on("error", () => {});
      child.on("error", (error: NodeJS.ErrnoException) => {
        cleanup();
        reject(
          new ProviderFailure(
            error.code === "ENOENT" || error.code === "EACCES"
              ? "provider-unavailable"
              : "permanent",
            false,
            false,
          ),
        );
      });
      child.on("close", (code) => {
        cleanup();
        if (signal.aborted) return reject(signal.reason);
        if (oversized) return reject(new ProviderFailure("invalid-response", false));
        if (timedOut) return reject(new ProviderFailure("transient", false));
        if (code !== 0) {
          const kind =
            code === 4 || /auth login|not logged in|HTTP 401/i.test(stderr)
              ? "authentication-required"
              : /HTTP 429|rate limit/i.test(stderr)
                ? "rate-limited"
                : /HTTP 5\d\d|connect|timeout/i.test(stderr)
                  ? "transient"
                  : "permanent";
          return reject(new ProviderFailure(kind, false));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new ProviderFailure("invalid-response", false));
        }
      });
      child.stdin.end(body !== undefined ? JSON.stringify(body) : undefined);
    });
  }
}
