import { z } from "zod";
import { ConfigSchema } from "./app/config.js";
import { createCore } from "./app/core.js";
import { postgres } from "./core/database.js";
import { initTracing } from "./core/telemetry.js";

const log = (entry: Record<string, unknown>) => process.stderr.write(`${JSON.stringify(entry)}\n`);
// Where it failed without what it said: messages may quote secrets or the operator's words,
// stack frames only name code.
const origin = (error: unknown) =>
  error instanceof Error
    ? {
        error: error.name,
        at: (error.stack ?? "")
          .split("\n")
          .filter((line) => line.trimStart().startsWith("at "))
          .slice(0, 6)
          .map((line) => line.trim()),
      }
    : { error: typeof error };

// A stray rejection is logged and the assistant keeps serving; an uncaught exception means
// state may be inconsistent, so the process exits for its supervisor to restart it.
process.on("unhandledRejection", (reason) =>
  log({ level: "error", code: "UNHANDLED_REJECTION", ...origin(reason) }),
);
process.on("uncaughtException", (error) => {
  log({ level: "fatal", code: "UNCAUGHT_EXCEPTION", ...origin(error) });
  process.exit(1);
});

async function main() {
  const shutdownTracing = initTracing();
  const config = ConfigSchema.parse(process.env);
  const db = postgres(config.DATABASE_URL);
  try {
    const core = await createCore(config, { db, env: process.env });
    // Container publication is still loopback-only in Compose; native execution is loopback.
    const host = process.env.JARVIS_CONTAINER === "true" ? "0.0.0.0" : "127.0.0.1";
    const stopped = new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await core.start({ host, port: config.PORT });
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        event: "core.started",
        host,
        port: config.PORT,
        configuredProviders: core.registry.list(),
        liveConnectivity: "unverified",
      })}\n`,
    );
    await stopped;
    await core.stop();
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
  log({
    level: "fatal",
    code: "STARTUP_OR_RUNTIME_FAILED",
    detail: "Check local configuration and service readiness; sensitive details suppressed",
    ...(config ? { config } : {}),
  });
  process.exitCode = 1;
});
