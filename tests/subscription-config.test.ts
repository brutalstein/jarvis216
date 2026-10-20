import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { configuredProviders } from "../src/app/config.js";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { EnvSecrets } from "../src/core/security.js";
import { codexOptions } from "../src/integrations/models.js";

const paths: string[] = [];
afterAll(async () => {
  for (const dir of paths) await rm(dir, { recursive: true, force: true });
});
async function codexEnv(login: boolean): Promise<NodeJS.ProcessEnv> {
  await mkdir("data/workspaces", { recursive: true });
  await mkdir("data/codex-homes", { recursive: true });
  const workspace = await mkdtemp(path.resolve("data/workspaces/subscription-test-"));
  const home = await mkdtemp(path.resolve("data/codex-homes/subscription-test-"));
  paths.push(workspace, home);
  // Presence is sufficient; invalid JSON proves Core never parses the credential file.
  if (login) await writeFile(path.join(home, "auth.json"), "not JSON; vendor-owned credentials");
  return {
    ENABLE_CODEX: "true",
    CODEX_AUTH: "chatgpt",
    CODEX_MODEL: "test-model",
    CODEX_ISOLATION_VERIFIED: "true",
    CODEX_WORKSPACE: workspace,
    CODEX_ISOLATED_HOME: home,
  };
}
const secrets = new EnvSecrets({});
it("codex chatgpt options carry no API key", () => {
  const options = codexOptions({ kind: "chatgpt" }, "isolated-home");
  expect(options).not.toHaveProperty("apiKey");
  expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
  expect(options.env?.CODEX_HOME).toBe("isolated-home");
});
it("codex api-key options keep current behavior", () => {
  const options = codexOptions({ kind: "api-key", key: "fixture-api-key" }, "isolated-home");
  expect(options.apiKey).toBe("fixture-api-key");
  expect(options.env?.OPENAI_API_KEY).toBe("fixture-api-key");
});
it("codex chatgpt mode registers without OPENAI_API_KEY when auth.json exists", async () => {
  const { registry } = await configuredProviders(await codexEnv(true), secrets);
  expect(registry.list()).toEqual([
    expect.objectContaining({ id: "codex", riskFloor: "HIGH", outputTokenLimitEnforced: false }),
  ]);
});
it("codex chatgpt mode refuses startup without auth.json", async () => {
  await expect(configuredProviders(await codexEnv(false), secrets)).rejects.toThrow();
});
it("codex refuses unsupported auth modes", async () => {
  const env = { ...(await codexEnv(true)), CODEX_AUTH: "unknown" };
  await expect(configuredProviders(env, secrets)).rejects.toThrow();
});
it("codex defaults to api-key and still requires its secret", async () => {
  const env = await codexEnv(true);
  delete env.CODEX_AUTH;
  await expect(configuredProviders(env, secrets)).rejects.toThrow("SECRET_UNAVAILABLE");
});
const claude = {
  ENABLE_CLAUDE_CODE: "true",
  CLAUDE_CODE_PATH: process.execPath,
  CLAUDE_CODE_MODEL: "test-model",
};
it("claude code registers with an existing absolute path", async () => {
  const { registry } = await configuredProviders(claude, secrets);
  expect(registry.list()).toEqual([
    expect.objectContaining({ id: "claude-code", outputTokenLimitEnforced: false }),
  ]);
  const spec = TaskSpecSchema.parse({
    objective: "test",
    capability: "text.generate",
    providers: ["claude-code"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "contains", value: "ok" },
  });
  const provider = registry.select({ spec } as Task, []);
  expect(provider.configuration).toBe("claude-code:test-model:tools-none");
  expect(provider.external).toBe(true);
  expect(provider.retrySafe).toBe(true);
  expect(provider.priority).toBe(15);
});
it.each(["claude.exe", path.resolve("data/nonexistent-claude.exe"), undefined])(
  "claude code refuses a missing or relative path: %s",
  async (value) => {
    await expect(
      configuredProviders({ ...claude, CLAUDE_CODE_PATH: value }, secrets),
    ).rejects.toThrow();
  },
);
it.each(["", "   ", undefined])("claude code requires a model: %s", async (value) => {
  await expect(
    configuredProviders({ ...claude, CLAUDE_CODE_MODEL: value }, secrets),
  ).rejects.toThrow();
});

it("desktop uses restricted MCP tools and profile-contained default roots", async () => {
  const profile = await mkdtemp(path.resolve("data/profile-test-"));
  paths.push(profile);
  await mkdir(path.join(profile, "OneDrive", "Desktop"), { recursive: true });
  const { registry, tools } = await configuredProviders(
    { ENABLE_DESKTOP: "true", USERPROFILE: profile },
    secrets,
  );
  const spec = TaskSpecSchema.parse({
    objective: "windows",
    capability: "desktop.act",
    input: { action: "window.list", args: {} },
    providers: ["windows-mcp"],
    deadline: new Date(Date.now() + 60000).toISOString(),
    verification: { kind: "non-empty" },
  });
  const provider = registry.select({ spec } as Task, []);
  const configured = JSON.parse(provider.configuration!);
  expect(configured.command).toBe("uvx");
  expect(configured.args).toEqual(["windows-mcp@0.8.8", "serve"]);
  expect(configured.roots[0]).toBe(path.join(profile, "OneDrive", "Desktop"));
  expect(configured.env.ANONYMIZED_TELEMETRY).toBe("false");
  expect(configured.allow).not.toContain("Shell");
  expect(configured.env.WINDOWS_MCP_TOOLS.split(",")).toEqual(configured.allow);
  expect(provider.outcomeObservable).toBe(true);
  expect(tools).toBeDefined();
  await tools?.close();
});

it("desktop refuses roots outside the operator profile", async () => {
  const profile = await mkdtemp(path.resolve("data/profile-test-"));
  paths.push(profile);
  await expect(
    configuredProviders(
      {
        ENABLE_DESKTOP: "true",
        USERPROFILE: profile,
        JARVIS_FILE_ROOTS: JSON.stringify([path.dirname(profile)]),
      },
      secrets,
    ),
  ).rejects.toThrow("PATH_OUTSIDE_ROOTS");
});

it("news can be enabled independently of desktop tools", async () => {
  const { registry, tools } = await configuredProviders({ ENABLE_NEWS: "true" }, secrets);
  expect(registry.list()).toMatchObject([{ id: "news", capability: "info.fetch" }]);
  expect(tools).toBeUndefined();
});

it("Claude agent registers independently of conversation, with HIGH risk", async () => {
  const { registry, integrations } = await configuredProviders(
    { ...claude, ENABLE_CLAUDE_AGENT: "true", CLAUDE_AGENT_PERMISSION_MODE: "auto" },
    secrets,
  );
  expect(registry.list()).toEqual([
    expect.objectContaining({ id: "claude-code", retrySafe: true }),
    expect.objectContaining({ id: "claude-agent", retrySafe: false, riskFloor: "HIGH" }),
  ]);
  expect(integrations.available()).toContain("agent.execute");
});
it("Claude agent refuses missing explicit MCP configuration", async () => {
  await expect(configuredProviders(
    { ...claude, ENABLE_CLAUDE_AGENT: "true", CLAUDE_AGENT_MCP_CONFIG: path.resolve("nonexistent-mcp.json") },
    secrets,
  )).rejects.toThrow();
});
