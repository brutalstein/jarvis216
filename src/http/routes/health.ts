import type { ProviderRegistry } from "../../core/routing.js";
import type { TaskService } from "../../core/tasks.js";
import type { HttpContext } from "../context.js";

// Liveness (unauthenticated), readiness and operational metrics (operator).
export function healthRoutes(
  { app, authenticate, options }: HttpContext,
  tasks: TaskService,
  registry: ProviderRegistry,
): void {
  app.get("/healthz", async () => ({ status: "alive" }));
  app.get("/v1/capabilities", async (request) => {
    authenticate(request, "operator");
    return options.capabilities
      ? options.capabilities()
      : { providers: registry.list(), liveConnectivity: "not-checked" };
  });
  app.get("/v1/metrics", async (request) => {
    authenticate(request, "operator");
    // Sequential on purpose: metrics must never hold the whole pool and starve heartbeats.
    const taskStates = await tasks.db.query(
      "SELECT status,count(*) AS count FROM tasks GROUP BY status ORDER BY status",
    );
    const providers = await tasks.db.query(
      "SELECT target,status,count(*) AS count FROM actions GROUP BY target,status ORDER BY target,status",
    );
    const usage = await tasks.db.query(
      "SELECT COALESCE(sum(calls),0) AS reserved_calls FROM tasks",
    );
    // Admission-to-completion wall time, from the authoritative event timestamps.
    const durations = await tasks.db.query<{
      count: number;
      p50: number | null;
      p95: number | null;
    }>(
      `SELECT count(*)::int AS count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY d) AS p95
         FROM (SELECT (max(extract(epoch FROM (e.envelope->>'timestamp')::timestamptz))*1000 - t.created_at)::float8 AS d
               FROM tasks t JOIN events e ON e.task_id=t.id
               WHERE t.status='COMPLETED' GROUP BY t.id,t.created_at) completed`,
    );
    // Measured outcomes behind adaptive routing and usage budgets, last 24 hours.
    const observations = await tasks.db.query(
      `SELECT provider,outcome,count(*)::int AS count,round(avg(duration_ms))::int AS avg_ms,
           COALESCE(sum(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0)::float8 AS tokens
         FROM provider_observations WHERE observed_at>$1
         GROUP BY provider,outcome ORDER BY provider,outcome`,
      [Date.now() - 86_400_000],
    );
    const deliveries = await tasks.db.query(
      `SELECT CASE WHEN delivered_at IS NOT NULL THEN 'delivered' WHEN failed_at IS NOT NULL THEN 'failed' ELSE 'pending' END AS state,
           count(*)::int AS count FROM deliveries GROUP BY 1 ORDER BY 1`,
    );
    const retries = await tasks.db.query<{ retries: number }>(
      "SELECT count(*)::int AS retries FROM events WHERE envelope->>'type'='execution.failed' AND envelope->'payload'->>'retryEligible'='true'",
    );
    return {
      taskStates: taskStates.rows,
      providerActions: providers.rows,
      usage: usage.rows[0],
      completedDurationMs: durations.rows[0],
      retries: retries.rows[0]?.retries ?? 0,
      providerObservations24h: observations.rows,
      outboxDeliveries: deliveries.rows,
      rssBytes: process.memoryUsage().rss,
      cpuMicros: process.cpuUsage(),
      observedAt: new Date().toISOString(),
    };
  });
  app.get("/readyz", async (request) => {
    authenticate(request, "operator");
    await tasks.db.query("SELECT 1");
    return { database: "ready", providers: registry.list(), liveConnectivity: "not-checked" };
  });
}
