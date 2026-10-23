import { z } from "zod";

/** Pure task recipes; Core retains policy, scheduling, credentials, execution and recovery. */
export type HubTask = {
  capability: "text.generate" | "browser.extract" | "workflow.invoke" | "tool.execute";
  providers: string[];
  objective: string;
  input: Record<string, unknown>;
  risk: "LOW" | "MEDIUM" | "HIGH";
  privacy: "public" | "private";
  budget: { maxCalls: 1; maxDurationMs: number; maxOutputTokens: number };
  verification: { kind: "non-empty" | "postcondition" } | { kind: "contains"; value: string };
};
export class IntegrationError extends Error {
  constructor(readonly code: "INTEGRATION_DISABLED" | "INTEGRATION_DENIED") {
    super(code);
  }
}
export class IntegrationHub {
  private recipes = new Map<string, (args: Record<string, unknown>) => HubTask>();
  constructor(readonly browserUrls: readonly string[] = []) {}
  register(action: string, recipe: (args: Record<string, unknown>) => HubTask): void {
    if (!/^[a-z][a-z0-9_-]+\.[a-z][a-z0-9_-]+$/.test(action) || this.recipes.has(action))
      throw new Error("INVALID_RECIPE");
    this.recipes.set(action, recipe);
  }
  available(): string[] {
    return [...this.recipes.keys()].sort();
  }
  compile(action: string, args: Record<string, unknown>): HubTask {
    const recipe = this.recipes.get(action);
    if (!recipe) throw new IntegrationError("INTEGRATION_DISABLED");
    return recipe(args);
  }
}
const agent = z.strictObject({ instruction: z.string().trim().min(1).max(2000) });
const claudeAgent = z.strictObject({ instruction: z.string().trim().min(1).max(8000) });
const browser = z.strictObject({
  url: z.url({ protocol: /^https$/ }).max(2000),
  expectedText: z.string().trim().min(1).max(4096),
});
const browserMany = z.strictObject({
  pages: z
    .array(
      z.strictObject({
        url: z.url({ protocol: /^https$/ }).max(2000),
        expectedText: z.string().trim().min(1).max(4096),
      }),
    )
    .min(1)
    .max(4),
});
const workflow = z.strictObject({
  workflow: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
  payload: z.record(z.string(), z.json()).default({}),
});
function read<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new IntegrationError("INTEGRATION_DENIED");
  return parsed.data;
}
function exactUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("INVALID_BROWSER_ALLOWLIST");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.href !== value ||
    !parsed.hostname
  )
    throw new Error("INVALID_BROWSER_ALLOWLIST");
  return value;
}
export function createIntegrationHub(settings: {
  openclaw?: boolean;
  claudeAgent?: boolean;
  browserUrls?: readonly string[];
  workflows?: readonly string[];
}): IntegrationHub {
  const urls = new Set((settings.browserUrls ?? []).map(exactUrl));
  const hub = new IntegrationHub([...urls]);
  if (settings.openclaw)
    hub.register("agent.delegate", (args) => {
      const { instruction } = read(agent, args);
      return {
        capability: "text.generate",
        providers: ["openclaw"],
        objective: instruction,
        input: {},
        risk: "HIGH",
        privacy: "private",
        budget: { maxCalls: 1, maxDurationMs: 86_400_000, maxOutputTokens: 4096 },
        verification: { kind: "postcondition" },
      };
    });
  if (settings.claudeAgent)
    hub.register("agent.execute", (args) => {
      const { instruction } = read(claudeAgent, args);
      return {
        capability: "text.generate",
        providers: ["claude-agent"],
        objective: instruction,
        input: {},
        risk: "HIGH",
        privacy: "private",
        budget: { maxCalls: 1, maxDurationMs: 86_400_000, maxOutputTokens: 8192 },
        verification: { kind: "postcondition" },
      };
    });
  if (urls.size) {
    hub.register("browser.read", (args) => {
      const { url, expectedText } = read(browser, args);
      if (!urls.has(url)) throw new IntegrationError("INTEGRATION_DENIED");
      return {
        capability: "browser.extract",
        providers: ["browser-use"],
        objective: "Read the exact allowlisted public page and verify its content.",
        input: { url, expectedText },
        risk: "LOW",
        privacy: "public",
        budget: { maxCalls: 1, maxDurationMs: 60000, maxOutputTokens: 1024 },
        verification: { kind: "contains", value: expectedText },
      };
    });
    hub.register("browser.read_many", (args) => {
      const { pages } = read(browserMany, args);
      const [first, ...rest] = pages;
      if (!first) throw new IntegrationError("INTEGRATION_DENIED");
      for (const page of [first, ...rest])
        if (!urls.has(page.url)) throw new IntegrationError("INTEGRATION_DENIED");
      return {
        capability: "browser.extract",
        providers: ["browser-use"],
        objective: `Read ${pages.length} allowlisted public pages and verify each.`,
        input: { pages },
        risk: "LOW",
        privacy: "public",
        budget: { maxCalls: 1, maxDurationMs: 120000, maxOutputTokens: 4096 },
        verification: { kind: "contains", value: first.expectedText },
      };
    });
  }
  const names = new Set(settings.workflows ?? []);
  for (const name of names)
    if (!/^[a-z][a-z0-9_-]{0,99}$/.test(name)) throw new Error("INVALID_WORKFLOW_NAME");
  if (names.size)
    hub.register("automation.invoke", (args) => {
      const { workflow: id, payload } = read(workflow, args);
      if (!names.has(id) || new TextEncoder().encode(JSON.stringify(payload)).byteLength > 8192)
        throw new IntegrationError("INTEGRATION_DENIED");
      return {
        capability: "workflow.invoke",
        providers: ["n8n"],
        objective: `Invoke registered n8n workflow ${id}`,
        input: { workflow: id, payload },
        risk: "HIGH",
        privacy: "private",
        budget: { maxCalls: 1, maxDurationMs: 120000, maxOutputTokens: 1024 },
        verification: { kind: "non-empty" },
      };
    });
  return hub;
}
