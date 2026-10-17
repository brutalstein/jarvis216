import { z } from "zod";
import { ConfigSchema, configuredProviders } from "./config.js";
import { migrate, postgres } from "./database.js";
import { EnvSecrets } from "./security.js";
import { buildServer } from "./server.js";
import { TaskService } from "./tasks.js";
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
  const registry = await configuredProviders(process.env, secrets);
  const db = postgres(config.DATABASE_URL);
  try {
    await migrate(db);
    const tasks = new TaskService(db, {
      concurrency: config.WORKER_CONCURRENCY,
      limits: {
        "text.generate": config.MODEL_CONCURRENCY,
        "browser.extract": config.BROWSER_CONCURRENCY,
        "workflow.invoke": config.WORKFLOW_CONCURRENCY,
      },
      redact: (text) => secrets.redact(text),
    });
    await tasks.recover();
    const workers = Array.from(
      { length: config.WORKER_CONCURRENCY },
      () => new Worker(tasks, registry, (text) => secrets.redact(text)),
    );
    const server = buildServer(tasks, registry, {
      operatorToken: config.JARVIS_TOKEN,
      webhookToken: config.N8N_INGRESS_TOKEN,
      onCancel: (id) => {
        for (const worker of workers) worker.cancel(id);
      },
      onAdmit: () => {
        for (const worker of workers) worker.wake();
      },
    });
    // Container publication is still loopback-only in Compose; native execution is loopback.
    const host = process.env.JARVIS_CONTAINER === "true" ? "0.0.0.0" : "127.0.0.1";
    await server.listen({ host, port: config.PORT });
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
    try {
      await Promise.all(workers.map((worker) => worker.run(stop.signal)));
    } finally {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
      await server.close();
    }
  } finally {
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
