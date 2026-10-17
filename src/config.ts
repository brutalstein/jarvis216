import { z } from "zod";
import type { Executor } from "./contracts.js";
import { ClaudeExecutor, CodexExecutor, GeminiExecutor } from "./integrations/models.js";
import { BrowserExecutor, OpenClawExecutor, WorkflowExecutor } from "./integrations/services.js";
import { type Provider, ProviderRegistry } from "./routing.js";
import { containedPath, type EnvSecrets } from "./security.js";

// .env.example placeholders are long enough to pass length checks; never accept them.
const generated = (value: string) => !value.includes("REPLACE_");
export const ConfigSchema = z.object({
  DATABASE_URL: z.string().url().refine(generated, "Run scripts/bootstrap.ps1"),
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
  const register = (executor: Executor, configuration: string, priority: number) =>
    providers.push({
      id: executor.id,
      capability: executor.capability,
      external: executor.external,
      retrySafe: executor.retrySafe,
      authenticated: true,
      enabled: true,
      priority,
      maxInputChars: 20_000,
      configuration,
      execute: executor.execute.bind(executor),
    });
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
    register(
      new GeminiExecutor(secrets.resolve("GEMINI_API_KEY"), model),
      `gemini-api:${model}:tools-none`,
      20,
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
    register(
      new CodexExecutor(secrets.resolve("OPENAI_API_KEY"), model, workspace, home),
      `codex-sdk:${model}:${workspace}:${home}:isolated`,
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
