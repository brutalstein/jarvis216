import { catalog, parseSnapshot, screenSummary } from "@jarvis/action-engine";
import { Brain } from "@jarvis/brain";
import type { FastifyInstance } from "fastify";
import { type Executor, terminal } from "../core/contracts.js";
import { type Database, migrate } from "../core/database.js";
import { loadObservations, purgeObservations } from "../core/reliability.js";
import type { ProviderRegistry } from "../core/routing.js";
import { EnvSecrets } from "../core/security.js";
import { type Lane, type TaskChange, TaskService } from "../core/tasks.js";
import { Worker } from "../core/worker.js";
import { buildServer } from "../http/server.js";
import { geminiEmbedder } from "../integrations/models.js";
import { PostgresBrainStore } from "../services/brain-store.js";
import { ConversationService, conversationProviders } from "../services/conversation.js";
import { Durations } from "../services/eta.js";
import { MemoryStore } from "../services/memory.js";
import { Narrator } from "../services/narrator.js";
import { Outbox } from "../services/outbox.js";
import { type BrainSettings, PermissionService } from "../services/permissions.js";
import { PlanService } from "../services/plans/index.js";
import { type Config, configuredProviders } from "./config.js";

export type CoreOptions = {
  // The caller owns the database: Core never closes it, so a restart can reuse it.
  db: Database;
  env: NodeJS.ProcessEnv;
  // Extra executors registered exactly like configured ones (fake models in end-to-end tests).
  executors?: Executor[];
};
export type Core = {
  server: FastifyInstance;
  tasks: TaskService;
  plans: PlanService;
  conversation: ConversationService;
  permissions: PermissionService;
  brain: Brain;
  memory: MemoryStore;
  durations: Durations;
  registry: ProviderRegistry;
  // Listens, then starts the workers and background loops.
  start(listen: { host: string; port: number }): Promise<{ port: number }>;
  // Stops accepting requests, lets in-flight ones finish, drains the workers. Idempotent.
  stop(): Promise<void>;
  // Retention: transcripts and their tasks past 30 days, old measurements. Runs every 6 hours.
  maintain(): Promise<void>;
};
const retentionMs = 30 * 86_400_000;

// Composition root: every Core service, wired once, in dependency order.
export async function createCore(config: Config, options: CoreOptions): Promise<Core> {
  const { db, env } = options;
  const secrets = new EnvSecrets(
    Object.fromEntries(
      Object.entries(env).filter(([key]) => /TOKEN|KEY|PASSWORD|SECRET|DATABASE_URL/.test(key)),
    ),
  );
  const memory = new MemoryStore(db);
  const embeddings =
    env.BRAIN_EMBEDDINGS === "gemini" && env.ENABLE_GEMINI === "true"
      ? geminiEmbedder(
          secrets.resolve("GEMINI_API_KEY"),
          env.BRAIN_EMBEDDING_MODEL?.trim() || "gemini-embedding-001",
        )
      : undefined;
  // Learning stays local; transcripts' 30-day retention bounds the experiences it keeps.
  const brain = new Brain(new PostgresBrainStore(db), {
    retentionDays: 30,
    ...(embeddings && { embed: embeddings }),
  });
  let brainSettings: () => BrainSettings = () => ({ learning: true, reflexes: true });
  let agentAutonomous = () => false;
  const { registry, tools, integrations } = await configuredProviders(env, secrets, {
    agentAutonomous: () => agentAutonomous(),
    memory,
    // Learned picks among on-screen candidates count as learned shortcuts (Settings: reflexes).
    prefer: (target, candidates) =>
      brainSettings().reflexes ? brain.preferredChoice(target, candidates) : undefined,
    ...(options.executors && { executors: options.executors }),
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
    // Read the live, possibly expiring Full Access preset on each delegated run.
    agentAutonomous = () =>
      permissions.view().preset === "autonomous" && permissions.allows("agent.execute");
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
      retrySafe: (target) => registry.retrySafe(target),
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
    const onChange = ({ status }: TaskChange) => {
      if (status === "READY" || terminal.has(status)) wake();
    };
    tasks.changes.on("change", onChange);
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
    const maintain = async () => {
      await conversation.purge(retentionMs);
      await purgeObservations(db, Date.now() - retentionMs);
      await durations.purge();
    };
    await maintain();
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

    const abort = new AbortController();
    let running: Promise<unknown> = Promise.resolve();
    let stopping: Promise<void> | undefined;
    return {
      server,
      tasks,
      plans,
      conversation,
      permissions,
      brain,
      memory,
      durations,
      registry,
      maintain,
      async start(listen) {
        await server.listen(listen);
        const address = server.server.address();
        // uvx may download Windows-MCP on first use; warm it now so the first step keeps its 15 s.
        tools?.start().catch(() => {
          process.stderr.write('{"level":"warn","code":"WINDOWS_MCP_PREWARM_FAILED"}\n');
        });
        outbox?.start(abort.signal, tasks.changes);
        new Narrator(plans).start(abort.signal);
        // "Sleep" every half hour: consolidate experiences into skills and let unused ones fade.
        const sleep = setInterval(() => {
          void brain.consolidate().catch(() => {
            process.stderr.write('{"level":"error","code":"BRAIN_CONSOLIDATION_FAILED"}\n');
          });
        }, 30 * 60_000);
        sleep.unref();
        // A Core that runs for weeks keeps the 30-day promise without a restart.
        const retention = setInterval(() => {
          void maintain().catch(() => {
            process.stderr.write('{"level":"error","code":"RETENTION_FAILED"}\n');
          });
        }, 6 * 3_600_000);
        retention.unref();
        abort.signal.addEventListener(
          "abort",
          () => {
            clearInterval(sleep);
            clearInterval(retention);
          },
          { once: true },
        );
        plans.start(abort.signal);
        running = Promise.all(workers.map((worker) => worker.run(abort.signal)));
        return { port: typeof address === "object" && address ? address.port : listen.port };
      },
      stop() {
        stopping ??= (async () => {
          // In-flight requests finish while the workers still run; then the workers drain.
          await server.close();
          abort.abort();
          await running;
          tasks.changes.off("change", onChange);
          await tools?.close();
        })();
        return stopping;
      },
    };
  } catch (error) {
    await tools?.close();
    throw error;
  }
}
