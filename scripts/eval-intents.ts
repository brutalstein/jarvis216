// Live intent eval: every gold command through the production conversation prompt, first shot
// (no repair turn). Prints per-provider accuracy, intent-JSON rate and latency; never keys.
// npx tsx --conditions=jarvis-source --env-file=.env scripts/eval-intents.ts [--providers a,b] [--limit n]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { catalog, readIntent } from "@jarvis/action-engine";
import { EvalCommandSchema, scoreIntent } from "../packages/action-engine/src/eval-score.js";
import { configuredProviders } from "../src/config.js";
import { CoreError, type Task, TaskSpecSchema } from "../src/contracts.js";
import { conversationProviders, parseReply } from "../src/conversation.js";
import { conversationPrompt } from "../src/persona.js";
import { ProviderFailure } from "../src/routing.js";
import { EnvSecrets } from "../src/security.js";

const { values } = parseArgs({
  options: { providers: { type: "string" }, limit: { type: "string" }, pace: { type: "string" } },
});
const rows = readFileSync(
  new URL("../packages/action-engine/eval/commands.jsonl", import.meta.url),
  "utf8",
)
  .trim()
  .split(/\r?\n/)
  .map((line) => EvalCommandSchema.parse(JSON.parse(line)))
  .slice(0, values.limit ? Number(values.limit) : undefined);
// Free tiers allow roughly 15 requests a minute; each provider is paced on its own.
const paceMs = Number(values.pace ?? 4500);
const integrations = Object.values(catalog)
  .filter((def) => def.kind === "integration")
  .map((def) => def.id);

const { registry } = await configuredProviders(process.env, new EnvSecrets(process.env));
const registered = registry.list().map((p) => (p as { id: string }).id);
const ids = values.providers ? values.providers.split(",") : conversationProviders(registered);

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

async function evaluate(id: string): Promise<string> {
  let correct = 0;
  let json = 0;
  const failures = new Map<string, number>();
  const latencies: number[] = [];
  const byKind = new Map<string, [number, number]>();
  for (const row of rows) {
    const task = {
      spec: TaskSpecSchema.parse({
        objective: conversationPrompt({
          utterance: row.utterance,
          followUp: false,
          history: [],
          now: new Date(),
          enabledIntegrations: integrations,
        }),
        capability: "text.generate",
        providers: [id],
        privacy: "personal",
        // Same as production turns: providers with a JSON mode use it.
        responseFormat: "json",
        budget: { maxOutputTokens: 600 },
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "non-empty" },
      }),
    } as Task;
    const started = performance.now();
    let ok = false;
    try {
      const result = await registry.select(task, []).execute(task, AbortSignal.timeout(30_000));
      latencies.push(performance.now() - started);
      const reply = parseReply(result.text);
      if (reply.intent !== undefined) json++;
      const parsed = readIntent(reply.intent);
      ok = "decision" in parsed && scoreIntent(row, parsed.decision);
    } catch (error) {
      // Three outage-class failures open the provider's circuit for 60 s; wait it out.
      const open = error instanceof CoreError && error.code === "NO_COMPATIBLE_PROVIDER";
      if (!(error instanceof ProviderFailure) && !open) throw error;
      const kind = open ? "circuit-open" : (error as ProviderFailure).kind;
      failures.set(kind, (failures.get(kind) ?? 0) + 1);
      if (open) await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    if (ok) correct++;
    const [hit, total] = byKind.get(row.kind) ?? [0, 0];
    byKind.set(row.kind, [hit + (ok ? 1 : 0), total + 1]);
    await new Promise((resolve) => setTimeout(resolve, paceMs));
  }
  latencies.sort((a, b) => a - b);
  const kinds = [...byKind].map(([kind, [hit, total]]) => `${kind}=${hit}/${total}`).join(" ");
  return [
    id,
    `accuracy=${correct}/${rows.length} (${Math.round((100 * correct) / rows.length)}%)`,
    `intentJson=${Math.round((100 * json) / rows.length)}%`,
    `p50=${Math.round(percentile(latencies, 0.5))}ms p95=${Math.round(percentile(latencies, 0.95))}ms`,
    `failures=${[...failures].map(([kind, n]) => `${kind}:${n}`).join(",") || 0}`,
    kinds,
  ].join(" ");
}

// Providers have independent rate limits, so they run side by side.
for (const line of await Promise.all(ids.filter((id) => registered.includes(id)).map(evaluate)))
  console.log(line);
