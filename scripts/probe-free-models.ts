// Live check of configured free models: one short Turkish turn each.
// Prints provider id, outcome and latency only; never keys or replies.
import { configuredProviders } from "../src/app/config.js";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import { EnvSecrets } from "../src/core/security.js";

const { registry } = await configuredProviders(process.env, new EnvSecrets(process.env));
const ids = registry
  .list()
  .map((p) => (p as { id: string }).id)
  .filter((id) => /^(or|nv)-/.test(id));
for (const id of ids) {
  const task = {
    spec: TaskSpecSchema.parse({
      objective: "Kısaca kendini tanıt, tek cümle.",
      capability: "text.generate",
      providers: [id],
      budget: { maxOutputTokens: 400 },
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "non-empty" },
    }),
  } as Task;
  const started = performance.now();
  let status = "ok";
  try {
    await registry.select(task, []).execute(task, AbortSignal.timeout(30_000));
  } catch (error) {
    status = error instanceof ProviderFailure ? error.kind : "error";
  }
  console.log(`${id} ${status} ${Math.round(performance.now() - started)}`);
}
