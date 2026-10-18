import { catalog, parseSnapshot, screenSummary } from "@jarvis/action-engine";
import { z } from "zod";
import { ConfigSchema, configuredProviders } from "./config.js";
import { terminal } from "./contracts.js";
import { ConversationService, conversationProviders } from "./conversation.js";
import { migrate, postgres } from "./database.js";
import { MemoryStore } from "./memory.js";
import { Outbox } from "./outbox.js";
import { PermissionService } from "./permissions.js";
import { PlanService } from "./plans.js";
import { loadObservations, purgeObservations } from "./reliability.js";
import { EnvSecrets } from "./security.js";
import { buildServer } from "./server.js";
import { type TaskChange, TaskService } from "./tasks.js";
import { initTracing } from "./telemetry.js";
import { Worker } from "./worker.js";

async function main() {
  const shutdownTracing = initTracing();
  const config = ConfigSchema.parse(process.env);
  const secretValues = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /TOKEN|KEY|PASSWORD|SECRET|DATABASE_URL/.test(key),
    ),
  );
  const secrets = new EnvSecrets(secretValues);
  const db = postgres(config.DATABASE_URL);
  const memory = new MemoryStore(db);
  const { registry, tools, integrations } = await configuredProviders(process.env, secrets, {
    memory,
  });
  try {
    await migrate(db);
    // Which catalog actions this configuration can run at all, for the Settings view.
    const providerIds = new Set(registry.list().map((p) => (p as { id: string }).id));
    const permissions = new PermissionService(db, {
      available: () =>
        new Set(
          Object.values(catalog)
            .filter((definition) =>
              definition.kind === "desktop"
                ? providerIds.has("windows-mcp")
                : definition.kind === "info"
                  ? providerIds.has("news")
                  : definition.kind === "memory" ||
                    integrations.available().includes(definition.id),
            )
            .map((definition) => definition.id),
        ),
    });
    await permissions.load();
    const outbox =
      config.N8N_CALLBACK_URL && config.N8N_CALLBACK_TOKEN
        ? new Outbox(db, { url: config.N8N_CALLBACK_URL, token: config.N8N_CALLBACK_TOKEN })
        : undefined;
    // Health, usage budgets and open circuits survive a restart: replay the last day.
    await purgeObservations(db, Date.now() - 30 * 86_400_000);
    registry.hydrate(await loadObservations(db, Date.now() - 86_400_000));
    const tasks = new TaskService(db, {
      concurrency: config.WORKER_CONCURRENCY,
      limits: {
        "text.generate": config.MODEL_CONCURRENCY,
        "browser.extract": config.BROWSER_CONCURRENCY,
        "workflow.invoke": config.WORKFLOW_CONCURRENCY,
        "desktop.act": 1,
        "info.fetch": 2,
        "memory.write": 1,
      },
      redact: (text) => secrets.redact(text),
      ...(outbox && { outbox: { principals: ["n8n"] } }),
    });
    await tasks.recover();
    const workers = Array.from(
      { length: config.WORKER_CONCURRENCY },
      () => new Worker(tasks, registry, (text) => secrets.redact(text), {}, permissions),
    );
    const wake = () => {
      for (const worker of workers) worker.wake();
    };
    const onCancel = (id: string) => {
      for (const worker of workers) worker.cancel(id);
    };
    // A task that became claimable (admitted, approved, resumed) or settled (unblocking its
    // dependents) wakes idle workers at once.
    tasks.changes.on("change", ({ status }: TaskChange) => {
      if (status === "READY" || terminal.has(status)) wake();
    });
    const providers = conversationProviders(registry.list().map((p) => (p as { id: string }).id));
    const plans = new PlanService({
      tasks,
      wake,
      onCancel,
      conversationProviders: providers,
      privateProviders: providers.includes("claude-code") ? ["claude-code"] : [],
      integrations,
      memory: true,
      permissions,
      // A replan sees window and element names from a fresh Snapshot, never field values.
      ...(tools && {
        screen: async () =>
          screenSummary(
            parseSnapshot(
              (
                await tools.call(
                  "Snapshot",
                  { use_vision: false, use_annotation: false },
                  AbortSignal.timeout(10_000),
                )
              ).text,
            ),
          ),
      }),
    });
    const conversation = new ConversationService(tasks, {
      providers,
      wake,
      plans,
      memory,
    });
    await conversation.purge(30 * 86_400_000);
    const server = buildServer(tasks, registry, {
      operatorToken: config.JARVIS_TOKEN,
      webhookToken: config.N8N_INGRESS_TOKEN,
      onCancel,
      onAdmit: wake,
      conversation,
      plans,
      memory,
      permissions,
    });
    // Container publication is still loopback-only in Compose; native execution is loopback.
    const host = process.env.JARVIS_CONTAINER === "true" ? "0.0.0.0" : "127.0.0.1";
    await server.listen({ host, port: config.PORT });
    // uvx may download Windows-MCP on first use; warm it now so the first step keeps its 15 s.
    tools?.start().catch(() => {
      process.stderr.write('{"level":"warn","code":"WINDOWS_MCP_PREWARM_FAILED"}\n');
    });
    const stop = new AbortController();
    const abort = () => stop.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        event: "core.started",
        host,
        port: config.PORT,
        configuredProviders: registry.list(),
        liveConnectivity: "unverified",
      })}\n`,
    );
    outbox?.start(stop.signal, tasks.changes);
    try {
      await Promise.all([
        ...workers.map((worker) => worker.run(stop.signal)),
        plans.start(stop.signal),
      ]);
    } finally {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
      await server.close();
    }
  } finally {
    await tools?.close();
    await db.close();
    await shutdownTracing();
  }
}
main().catch((error: unknown) => {
  // Zod issue paths and messages never contain the rejected values.
  const config =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      : undefined;
  process.stderr.write(
    `${JSON.stringify({
      level: "fatal",
      code: "STARTUP_OR_RUNTIME_FAILED",
      detail: "Check local configuration and service readiness; sensitive details suppressed",
      ...(config ? { config } : {}),
    })}\n`,
  );
  process.exitCode = 1;
});
