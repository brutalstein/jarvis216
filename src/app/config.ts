import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ThinkingLevel } from "@google/genai";
import { McpToolPort, containedPath as profilePath } from "@jarvis/action-engine";
import { createIntegrationHub } from "@jarvis/integration-hub";
import { z } from "zod";
import type { Executor } from "../core/contracts.js";
import { type Provider, ProviderRegistry } from "../core/routing.js";
import { containedPath, type EnvSecrets } from "../core/security.js";
import { DesktopExecutor, NewsExecutor } from "../integrations/actions.js";
import { ClaudeCodeExecutor } from "../integrations/claude-code.js";
import { playwrightMcpConfig } from "../integrations/claude-mcp.js";
import {
  ClaudeExecutor,
  CodexExecutor,
  GeminiExecutor,
  supportsRefusalFallback,
} from "../integrations/models.js";
import { OpenAICompatibleExecutor, providerId } from "../integrations/openai-compatible.js";
import { BrowserExecutor, OpenClawExecutor, WorkflowExecutor } from "../integrations/services.js";
import { MemoryExecutor, type MemoryStore } from "../services/memory.js";

// .env.example placeholders are long enough to pass length checks; never accept them.
const generated = (value: string) => !value.includes("REPLACE_");
// Local-first: node --env-file never overrides a shell variable, so an inherited DATABASE_URL
// for another project would otherwise be migrated silently.
const localDatabase = (value: string) =>
  ["127.0.0.1", "localhost", "[::1]", "postgres"].includes(new URL(value).hostname);
export const ConfigSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine(generated, "Run scripts/bootstrap.ps1")
      .refine(localDatabase, "DATABASE_URL must be this host or the Compose postgres service"),
    JARVIS_TOKEN: z.string().min(32).refine(generated, "Run scripts/bootstrap.ps1"),
    N8N_INGRESS_TOKEN: z.string().min(32).refine(generated, "Run scripts/bootstrap.ps1"),
    PORT: z.coerce.number().int().min(1024).max(65535).default(2160),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    // Extra workers that only take spoken turns, so conversation never queues behind work.
    INTERACTIVE_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    MODEL_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    BROWSER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
    WORKFLOW_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
    // Optional push of n8n-submitted task outcomes to a registered n8n webhook.
    N8N_CALLBACK_URL: z.preprocess((v) => v || undefined, z.url().optional()),
    N8N_CALLBACK_TOKEN: z.preprocess(
      (v) => v || undefined,
      z.string().min(32).refine(generated, "Run scripts/bootstrap.ps1").optional(),
    ),
  })
  .refine((config) => Boolean(config.N8N_CALLBACK_URL) === Boolean(config.N8N_CALLBACK_TOKEN), {
    message: "Set N8N_CALLBACK_URL and N8N_CALLBACK_TOKEN together",
    path: ["N8N_CALLBACK_URL"],
  });
export type Config = z.infer<typeof ConfigSchema>;

export async function configuredProviders(
  env: NodeJS.ProcessEnv,
  secrets: EnvSecrets,
  local: {
    memory?: MemoryStore;
    prefer?: (target: string, candidates: string[]) => string | undefined;
    // Registered like configured executors, after them (fake models in end-to-end tests).
    executors?: Executor[];
    agentAutonomous?: () => boolean;
  } = {},
): Promise<{
  registry: ProviderRegistry;
  tools?: McpToolPort;
  integrations: ReturnType<typeof createIntegrationHub>;
}> {
  const providers: Provider[] = [];
  let tools: McpToolPort | undefined;
  let workflowNames: string[] = [];
  const trusted = z
    .string()
    .default("")
    .parse(env.JARVIS_PRIVATE_PROVIDERS)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const register = (executor: Executor, configuration: string, priority: number) => {
    const trustedForPrivate = trusted.includes(executor.id);
    providers.push({
      id: executor.id,
      capability: executor.capability,
      external: executor.external,
      retrySafe: executor.retrySafe,
      ...(executor.outcomeObservable !== undefined
        ? { outcomeObservable: executor.outcomeObservable }
        : {}),
      ...(executor.outputTokenLimitEnforced !== undefined
        ? { outputTokenLimitEnforced: executor.outputTokenLimitEnforced }
        : {}),
      ...(executor.riskFloor ? { riskFloor: executor.riskFloor } : {}),
      authenticated: true,
      enabled: true,
      priority,
      maxInputChars: 20_000,
      trustedForPrivate,
      // Trust is part of the approved configuration, so granting it invalidates old approvals.
      configuration: trustedForPrivate ? `${configuration}:trusted-private` : configuration,
      execute: executor.execute.bind(executor),
    });
  };
  if (env.ENABLE_CLAUDE === "true") {
    const model = z
      .string()
      .regex(/^[a-z0-9.-]{1,80}$/)
      .parse(env.CLAUDE_MODEL?.trim() || "claude-opus-5-5");
    const effort = z
      .enum(["low", "medium", "high", "xhigh", "max"])
      .optional()
      .parse(env.CLAUDE_EFFORT?.trim() || undefined);
    const refusalFallback = env.CLAUDE_REFUSAL_FALLBACK !== "false";
    const key = secrets.resolve("ANTHROPIC_API_KEY");
    const fallback =
      refusalFallback && supportsRefusalFallback(model) ? "refusal-fallback" : "single";
    register(
      new ClaudeExecutor(key, model, undefined, { ...(effort && { effort }), refusalFallback }),
      `claude-api:${model}:tools-none:effort-${effort ?? "default"}:${fallback}`,
      10,
    );
    // Realtime conversation: same model at low effort so a short reply budget is not spent
    // on thinking (mirrors gemini-live).
    register(
      new ClaudeExecutor(key, model, undefined, {
        id: "claude-live",
        effort: "low",
        refusalFallback,
      }),
      `claude-api:${model}:tools-none:effort-low:${fallback}`,
      10,
    );
  }
  if (env.ENABLE_GEMINI === "true") {
    const model = z.string().min(1).parse(env.GEMINI_MODEL);
    const key = secrets.resolve("GEMINI_API_KEY");
    register(new GeminiExecutor(key, model), `gemini-api:${model}:tools-none`, 20);
    register(
      new GeminiExecutor(key, model, undefined, {
        id: "gemini-live",
        thinkingLevel: ThinkingLevel.MINIMAL,
      }),
      `gemini-api:${model}:tools-none:thinking-minimal`,
      20,
    );
  }
  const freeModels = [
    {
      flag: "ENABLE_OPENROUTER",
      prefix: "or",
      base: "https://openrouter.ai/api/v1",
      key: "OPENROUTER_API_KEY",
      models: "OPENROUTER_MODELS",
      priority: 50,
      // Hide reasoning so the token budget goes to the reply.
      extraBody: { reasoning: { effort: "low", exclude: true } },
      jsonMode: true,
    },
    {
      flag: "ENABLE_NVIDIA",
      prefix: "nv",
      base: "https://integrate.api.nvidia.com/v1",
      key: "NVIDIA_API_KEY",
      models: "NVIDIA_MODELS",
      priority: 60,
    },
  ] as const;
  for (const free of freeModels) {
    if (env[free.flag] !== "true") continue;
    const key = secrets.resolve(free.key);
    const models = z
      .string()
      .parse(env[free.models])
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    for (const model of models)
      register(
        new OpenAICompatibleExecutor({
          id: providerId(free.prefix, model),
          base: free.base,
          key,
          model,
          ...("extraBody" in free ? { extraBody: free.extraBody } : {}),
          ...("jsonMode" in free ? { jsonMode: free.jsonMode } : {}),
        }),
        `${free.base}:${model}:tools-none`,
        free.priority,
      );
  }
  if (env.ENABLE_CLAUDE_CODE === "true") {
    const binary = z
      .string()
      .refine(path.isAbsolute, "CLAUDE_CODE_PATH must be absolute")
      .parse(env.CLAUDE_CODE_PATH);
    await access(binary);
    const model = z.string().trim().min(1).parse(env.CLAUDE_CODE_MODEL);
    const workdir = path.resolve("data/claude-code");
    await mkdir(workdir, { recursive: true });
    register(
      new ClaudeCodeExecutor({ command: [binary], model, workdir }),
      `claude-code:${model}:tools-none`,
      15,
    );
  }
  if (
    env.ENABLE_CLAUDE_AGENT === "true" &&
    !local.executors?.some((executor) => executor.id === "claude-agent")
  ) {
    // Kept separate from conversational Claude; operator chooses a delegated workspace.
    const binary = z.string().refine(path.isAbsolute).parse(env.CLAUDE_CODE_PATH);
    await access(binary);
    const model = z.string().trim().min(1).parse(env.CLAUDE_CODE_MODEL);
    const workspace = env.CLAUDE_AGENT_WORKSPACE
      ? z.string().refine(path.isAbsolute).parse(env.CLAUDE_AGENT_WORKSPACE)
      : path.resolve("data/claude-agent");
    await mkdir(workspace, { recursive: true });
    const permissionMode = z
      .enum(["auto", "acceptEdits", "plan", "dontAsk"])
      .default("auto")
      .parse(env.CLAUDE_AGENT_PERMISSION_MODE || undefined);
    const maxTurns = z.coerce
      .number()
      .int()
      .min(1)
      .max(80)
      .default(12)
      .parse(env.CLAUDE_AGENT_MAX_TURNS || undefined);
    const mcpConfig = env.CLAUDE_AGENT_MCP_CONFIG?.trim() || undefined;
    if (mcpConfig) {
      z.string().refine(path.isAbsolute).parse(mcpConfig);
      const raw = JSON.parse(await readFile(mcpConfig, "utf8"));
      z.object({ mcpServers: z.record(z.string(), z.unknown()) }).parse(raw);
    }
    const browserMcp = env.CLAUDE_AGENT_PLAYWRIGHT === "true";
    const mcpConfigs = [
      ...(mcpConfig ? [mcpConfig] : []),
      ...(browserMcp
        ? [playwrightMcpConfig({ headless: env.CLAUDE_AGENT_PLAYWRIGHT_HEADLESS === "true" })]
        : []),
    ];
    register(
      new ClaudeCodeExecutor({
        command: [binary],
        model,
        workdir: workspace,
        agent: {
          permissionMode,
          maxTurns,
          ...(browserMcp ? { mcpConfigs } : mcpConfig ? { mcpConfig } : {}),
          ...(local.agentAutonomous && { autonomous: local.agentAutonomous }),
        },
      }),
      `claude-agent:${model}:${workspace}:${permissionMode}:turns-${maxTurns}:mcp-${mcpConfig ?? "none"}:playwright-${browserMcp}:headless-${env.CLAUDE_AGENT_PLAYWRIGHT_HEADLESS === "true"}`,
      70,
    );
  }
  if (env.ENABLE_OPENCLAW === "true") {
    z.literal("true").parse(env.OPENCLAW_POLICY_VERIFIED);
    const base = z.url().parse(env.OPENCLAW_URL);
    const agent = z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .parse(env.OPENCLAW_AGENT_ID);
    register(
      new OpenClawExecutor(base, secrets.resolve("OPENCLAW_TOKEN"), agent),
      `${base}:${agent}:policy-verified`,
      30,
    );
  }
  if (env.ENABLE_BROWSER === "true") {
    const base = z.url().parse(env.BROWSER_WORKER_URL);
    register(
      new BrowserExecutor(base, secrets.resolve("BROWSER_WORKER_TOKEN")),
      `${base}:extract-v1`,
      10,
    );
  }
  if (env.ENABLE_CODEX === "true") {
    z.literal("true").parse(env.CODEX_ISOLATION_VERIFIED);
    const model = z.string().min(1).parse(env.CODEX_MODEL);
    const workspace = await containedPath("data/workspaces", z.string().parse(env.CODEX_WORKSPACE));
    const home = await containedPath("data/codex-homes", z.string().parse(env.CODEX_ISOLATED_HOME));
    const auth = z.enum(["api-key", "chatgpt"]).default("api-key").parse(env.CODEX_AUTH);
    if (auth === "chatgpt") await access(path.join(home, "auth.json"));
    register(
      new CodexExecutor(
        auth === "chatgpt"
          ? { kind: auth }
          : { kind: auth, key: secrets.resolve("OPENAI_API_KEY") },
        model,
        workspace,
        home,
      ),
      `codex-sdk:${model}:${workspace}:${home}:isolated:${auth}`,
      40,
    );
  }
  if (env.ENABLE_N8N === "true") {
    const workflows = z
      .record(
        z.string(),
        z.strictObject({ url: z.url(), tokenRef: z.string(), version: z.string().min(1) }),
      )
      .parse(JSON.parse(env.N8N_WORKFLOWS_JSON ?? "{}"));
    workflowNames = Object.keys(workflows);
    const configured = Object.fromEntries(
      Object.entries(workflows).map(([name, value]) => [
        name,
        { url: value.url, version: value.version, token: secrets.resolve(value.tokenRef) },
      ]),
    );
    register(new WorkflowExecutor(configured), JSON.stringify(workflows), 10);
  }
  if (env.ENABLE_DESKTOP === "true") {
    const profile = z.string().min(1).parse(env.USERPROFILE);
    const desktop = await access(path.join(profile, "OneDrive", "Desktop")).then(
      () => path.join(profile, "OneDrive", "Desktop"),
      () => path.join(profile, "Desktop"),
    );
    const requested = env.JARVIS_FILE_ROOTS?.trim()
      ? z.array(z.string().min(1)).min(1).max(16).parse(JSON.parse(env.JARVIS_FILE_ROOTS))
      : [desktop, path.join(profile, "Documents"), path.join(profile, "Downloads")];
    const roots = await Promise.all(requested.map((root) => profilePath(root, [profile])));
    const allow = [
      "App",
      "Click",
      "Type",
      "Scroll",
      "Shortcut",
      "Snapshot",
      "Screenshot",
      "FileSystem",
      "Clipboard",
      "Wait",
      "WaitFor",
      "ControlStatus",
    ];
    const options = {
      command: z.string().min(1).default("uvx").parse(env.WINDOWS_MCP_COMMAND),
      args: z
        .array(z.string())
        .min(1)
        .parse(JSON.parse(env.WINDOWS_MCP_ARGS || '["windows-mcp@0.8.8","serve"]')),
      env: { ANONYMIZED_TELEMETRY: "false", WINDOWS_MCP_TOOLS: allow.join(",") },
      allow,
    };
    tools = new McpToolPort(options);
    register(
      new DesktopExecutor(tools, roots, local.prefer),
      JSON.stringify({ ...options, roots }),
      10,
    );
  }
  // Local and governed per action by the operator's permissions (default: ask).
  if (local.memory) register(new MemoryExecutor(local.memory), "memory:v1:local", 10);
  for (const executor of local.executors ?? []) register(executor, `injected:${executor.id}`, 10);
  if (env.ENABLE_NEWS === "true") {
    const feeds = z
      .array(z.url().refine((url) => new URL(url).protocol === "https:"))
      .min(1)
      .max(16)
      .parse(
        JSON.parse(env.NEWS_FEEDS || '["https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr"]'),
      );
    register(new NewsExecutor(feeds), JSON.stringify({ feeds }), 10);
  }
  const browserUrls =
    env.ENABLE_BROWSER === "true"
      ? z
          .array(z.url())
          .max(32)
          .parse(JSON.parse(env.BROWSER_ALLOWED_URLS ?? "[]"))
      : [];
  const integrations = createIntegrationHub({
    claudeAgent: env.ENABLE_CLAUDE_AGENT === "true",
    openclaw: env.ENABLE_OPENCLAW === "true",
    browserUrls,
    workflows: workflowNames,
  });
  // Daily call or token ceilings per provider (e.g. a free tier's request quota). A spent budget
  // skips the provider until its rolling 24-hour usage drops; it never raises another's.
  const budgets = z
    .record(
      z.string().regex(/^[a-z0-9-]{1,40}$/),
      z
        .strictObject({
          callsPerDay: z.number().int().min(1).optional(),
          tokensPerDay: z.number().int().min(1).optional(),
        })
        .refine((budget) => budget.callsPerDay || budget.tokensPerDay, "empty budget"),
    )
    .parse(JSON.parse(env.PROVIDER_BUDGETS_JSON?.trim() || "{}"));
  return {
    registry: new ProviderRegistry(providers, Date.now, { budgets }),
    ...(tools && { tools }),
    integrations,
  };
}
