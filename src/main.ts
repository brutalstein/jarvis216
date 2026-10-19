import { catalog, parseSnapshot, screenSummary } from "@jarvis/action-engine";
import { Brain } from "@jarvis/brain";
import { z } from "zod";
import { ConfigSchema, configuredProviders } from "./app/config.js";
import { terminal } from "./core/contracts.js";
import { migrate, postgres } from "./core/database.js";
import { loadObservations, purgeObservations } from "./core/reliability.js";
import { EnvSecrets } from "./core/security.js";
import { type Lane, type TaskChange, TaskService } from "./core/tasks.js";
import { initTracing } from "./core/telemetry.js";
import { Worker } from "./core/worker.js";
import { buildServer } from "./http/server.js";
import { geminiEmbedder } from "./integrations/models.js";
import { PostgresBrainStore } from "./services/brain-store.js";
import { ConversationService, conversationProviders } from "./services/conversation.js";
import { Durations } from "./services/eta.js";
import { MemoryStore } from "./services/memory.js";
import { Narrator } from "./services/narrator.js";
import { Outbox } from "./services/outbox.js";
import { type BrainSettings, PermissionService } from "./services/permissions.js";
import { PlanService } from "./services/plans/index.js";

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
  const embeddings =
    process.env.BRAIN_EMBEDDINGS === "gemini" && process.env.ENABLE_GEMINI === "true"
      ? geminiEmbedder(
          secrets.resolve("GEMINI_API_KEY"),
          process.env.BRAIN_EMBEDDING_MODEL?.trim() || "gemini-embedding-001",
        )
      : undefined;
  // Learning stays local; transcripts' 30-day retention bounds the experiences it keeps.
  const brain = new Brain(new PostgresBrainStore(db), {
    retentionDays: 30,
    ...(embeddings && { embed: embeddings }),
  });
  let brainSettings: () => BrainSettings = () => ({ learning: true, reflexes: true });
  const { registry, tools, integrations } = await configuredProviders(process.env, secrets, {
    memory,
    // Learned picks among on-screen candidates count as learned shortcuts (Settings: reflexes).
    prefer: (target, candidates) =>
      brainSettings().reflexes ? brain.preferredChoice(target, candidates) : undefined,
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
    brainSettings = () => permissions.settings();
    await brain.load();
    await brain.consolidate();
    // How long steps take on this computer: ETAs and pacing what JARVIS says while it works.
    const durations = new Durations(db);
    await durations.load();
    const outbox =
      config.N8N_CALLBACK_URL && config.N8N_CALLBACK_TOKEN
        ? new Outbox(db, { url: config.N8N_CALLBACK_URL, token: config.N8N_CALLBACK_TOKEN })
        : undefined;
    // Health, usage budgets and open circuits survive a restart: replay the last day.
    await purgeObservations(db, Date.now() - 30 * 86_400_000);
    registry.hydrate(await loadObservations(db, Date.now() - 86_400_000));
    const tasks = new TaskService(db, {
      concurrency: config.WORKER_CONCURRENCY,
      interactive: config.INTERACTIVE_CONCURRENCY,
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
    const worker = (serve?: readonly Lane[]) =>
      new Worker(tasks, registry, (text) => secrets.redact(text), {}, permissions, serve);
    // General workers take either lane; the interactive ones stay free for spoken turns.
    const workers = [
      ...Array.from({ length: config.WORKER_CONCURRENCY }, () => worker()),
      ...Array.from({ length: config.INTERACTIVE_CONCURRENCY }, () => worker(["interactive"])),
    ];
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
      available: () =>
        permissions
          .view()
          .actions.reduce(
            (set, action) => (action.available ? set.add(action.id) : set),
            new Set<string>(),
          ),
      durations,
      onChoice: (target, candidates, chosen) => {
        if (permissions.settings().learning)
          void brain.learnChoice(target, candidates, chosen).catch(() => {});
      },
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
      brain,
      settings: () => permissions.settings(),
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
      brain,
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
    new Narrator(plans).start(stop.signal);
    // "Sleep" every half hour: consolidate experiences into skills and let unused ones fade.
    const sleep = setInterval(() => {
      void brain.consolidate().catch(() => {
        process.stderr.write('{"level":"error","code":"BRAIN_CONSOLIDATION_FAILED"}\n');
      });
    }, 30 * 60_000);
    sleep.unref();
    stop.signal.addEventListener("abort", () => clearInterval(sleep), { once: true });
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
