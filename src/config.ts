import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import type { Executor } from "./contracts.js";
import { ClaudeCodeExecutor } from "./integrations/claude-code.js";
import { ClaudeExecutor, CodexExecutor, GeminiExecutor } from "./integrations/models.js";
import { OpenAICompatibleExecutor, providerId } from "./integrations/openai-compatible.js";
import { BrowserExecutor, OpenClawExecutor, WorkflowExecutor } from "./integrations/services.js";
import { type Provider, ProviderRegistry } from "./routing.js";
import { containedPath, type EnvSecrets } from "./security.js";

// .env.example placeholders are long enough to pass length checks; never accept them.
const generated = (value: string) => !value.includes("REPLACE_");
// Local-first: node --env-file never overrides a shell variable, so an inherited DATABASE_URL
// for another project would otherwise be migrated silently.
const localDatabase = (value: string) =>
  ["127.0.0.1", "localhost", "[::1]", "postgres"].includes(new URL(value).hostname);
export const ConfigSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine(generated, "Run scripts/bootstrap.ps1")
    .refine(localDatabase, "DATABASE_URL must be this host or the Compose postgres service"),
  JARVIS_TOKEN: z.string().min(32).refine(generated, "Run scripts/bootstrap.ps1"),
  N8N_INGRESS_TOKEN: z.string().min(32).refine(generated, "Run scripts/bootstrap.ps1"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(2160),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  MODEL_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  BROWSER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  WORKFLOW_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
});
export async function configuredProviders(
  env: NodeJS.ProcessEnv,
  secrets: EnvSecrets,
): Promise<ProviderRegistry> {
  const providers: Provider[] = [];
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
    const model = z.string().min(1).parse(env.CLAUDE_MODEL);
    register(
      new ClaudeExecutor(secrets.resolve("ANTHROPIC_API_KEY"), model),
      `claude-api:${model}:tools-none`,
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
    const configured = Object.fromEntries(
      Object.entries(workflows).map(([name, value]) => [
        name,
        { url: value.url, version: value.version, token: secrets.resolve(value.tokenRef) },
      ]),
    );
    register(new WorkflowExecutor(configured), JSON.stringify(workflows), 10);
  }
  return new ProviderRegistry(providers);
}
