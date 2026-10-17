import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { CoreError, invariant, states, TaskSpecSchema } from "./contracts.js";
import type { ProviderRegistry } from "./routing.js";
import type { TaskService } from "./tasks.js";

export interface ServerOptions {
  operatorToken: string;
  webhookToken: string;
  onCancel(id: string): void;
  // Called after a task is admitted so idle workers can claim it without waiting.
  onAdmit?(): void;
}
const TaskId = z.strictObject({ id: z.uuid() });
export function buildServer(
  tasks: TaskService,
  registry: ProviderRegistry,
  options: ServerOptions,
) {
  invariant(
    options.operatorToken.length >= 32 &&
      options.webhookToken.length >= 32 &&
      options.operatorToken !== options.webhookToken,
    "STRONG_DISTINCT_TOKENS_REQUIRED",
    500,
  );
  const app = Fastify({
    bodyLimit: 32_768,
    requestTimeout: 10_000,
    connectionTimeout: 10_000,
    logger: false,
    trustProxy: false,
  });
  const bucket = new Map<string, { count: number; since: number }>();
  function authenticate(request: FastifyRequest, role: "operator" | "webhook") {
    const expected = role === "operator" ? options.operatorToken : options.webhookToken;
    const actual = request.headers.authorization ?? "";
    const digest = (v: string) => createHash("sha256").update(v).digest();
    invariant(timingSafeEqual(digest(actual), digest(`Bearer ${expected}`)), "UNAUTHORIZED", 401);
    const now = Date.now();
    let item = bucket.get(role);
    if (!item || now - item.since > 60_000) {
      item = { count: 0, since: now };
      bucket.set(role, item);
    }
    item.count++;
    invariant(item.count <= 120, "RATE_LIMITED", 429);
  }
  app.setErrorHandler((error, _request, reply) => {
    // Fastify's own client errors (malformed JSON, media type, size) keep their 4xx status.
    const framework =
      typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
    const status =
      error instanceof CoreError
        ? error.httpStatus
        : error instanceof z.ZodError
          ? 400
          : framework >= 400 && framework < 500
            ? framework
            : 500;
    reply.code(status).send({
      error:
        error instanceof CoreError
          ? error.code
          : status === 400
            ? "INVALID_REQUEST"
            : status === 413
              ? "BODY_TOO_LARGE"
              : status < 500
                ? "INVALID_REQUEST"
                : "INTERNAL_ERROR",
    });
  });
  app.get("/healthz", async () => ({ status: "alive" }));
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
    const retries = await tasks.db.query<{ retries: number }>(
      "SELECT count(*)::int AS retries FROM events WHERE envelope->>'type'='execution.failed' AND envelope->'payload'->>'retryEligible'='true'",
    );
    return {
      taskStates: taskStates.rows,
      providerActions: providers.rows,
      usage: usage.rows[0],
      completedDurationMs: durations.rows[0],
      retries: retries.rows[0]?.retries ?? 0,
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
  app.post("/v1/tasks", async (request, reply) => {
    authenticate(request, "operator");
    const key = z.string().min(1).max(200).parse(request.headers["idempotency-key"]);
    const task = await tasks.create(TaskSpecSchema.parse(request.body), key, "operator");
    options.onAdmit?.();
    return reply.code(201).send(task);
  });
  app.get("/v1/tasks", async (request) => {
    authenticate(request, "operator");
    const query = z
      .strictObject({
        status: z.enum(states).optional(),
        before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return tasks.list(query);
  });
  app.get("/v1/tasks/:id", async (request) => {
    authenticate(request, "operator");
    return tasks.get(TaskId.parse(request.params).id);
  });
  app.get("/v1/tasks/:id/events", async (request) => {
    authenticate(request, "operator");
    const query = z
      .object({
        after: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
      })
      .parse(request.query);
    return tasks.events(TaskId.parse(request.params).id, query.after);
  });
  app.get("/v1/tasks/:id/actions", async (request) => {
    authenticate(request, "operator");
    return tasks.actions(TaskId.parse(request.params).id);
  });
  app.post("/v1/tasks/:id/cancel", async (request) => {
    authenticate(request, "operator");
    const id = TaskId.parse(request.params).id;
    const result = await tasks.cancel(id);
    options.onCancel(id);
    return result;
  });
  app.post("/v1/tasks/:id/dependencies", async (request, reply) => {
    authenticate(request, "operator");
    const body = z.strictObject({ dependencyId: z.uuid() }).parse(request.body);
    await tasks.addDependency(TaskId.parse(request.params).id, body.dependencyId);
    return reply.code(204).send();
  });
  app.post("/v1/tasks/:id/resume", async (request, reply) => {
    authenticate(request, "operator");
    await tasks.resume(TaskId.parse(request.params).id);
    return reply.code(204).send();
  });
  app.post("/v1/actions/:id/reject", async (request, reply) => {
    authenticate(request, "operator");
    await tasks.reject(TaskId.parse(request.params).id, "operator");
    return reply.code(204).send();
  });
  app.post("/v1/actions/:id/approve", async (request, reply) => {
    authenticate(request, "operator");
    const body = z.strictObject({ expiresAt: z.iso.datetime() }).parse(request.body);
    await tasks.approve(TaskId.parse(request.params).id, "operator", Date.parse(body.expiresAt));
    return reply.code(204).send();
  });
  app.post("/v1/actions/:id/reconcile", async (request, reply) => {
    authenticate(request, "operator");
    const body = z
      .strictObject({
        outcome: z.enum(["FAILED", "COMPLETED"]),
        evidence: z.string().min(10).max(4096),
      })
      .parse(request.body);
    await tasks.reconcile(TaskId.parse(request.params).id, body.outcome, body.evidence, "operator");
    return reply.code(204).send();
  });
  app.post("/v1/hooks/n8n", async (request, reply) => {
    authenticate(request, "webhook");
    const body = z
      .strictObject({
        eventId: z.string().regex(/^[\w-]{1,100}$/),
        // n8n (Luxon) emits local offsets such as +03:00; Date.parse normalizes them.
        sentAt: z.iso.datetime({ offset: true }),
        objective: z.string().min(1).max(16_000),
        verificationText: z.string().min(1).max(4096),
      })
      .parse(request.body);
    const sent = Date.parse(body.sentAt);
    invariant(Math.abs(Date.now() - sent) < 300_000, "WEBHOOK_EXPIRED", 400);
    const task = await tasks.create(
      {
        objective: body.objective,
        capability: "text.generate",
        providers: ["openclaw"],
        deadline: new Date(sent + 300_000).toISOString(),
        privacy: "private",
        budget: { maxCalls: 1, maxDurationMs: 300_000, maxOutputTokens: 1024 },
        verification: { kind: "contains", value: body.verificationText },
      },
      `n8n:${body.eventId}`,
      "n8n",
    );
    options.onAdmit?.();
    return reply.code(202).send({ id: task.id, status: task.status });
  });
  app.get("/v1/hooks/n8n/tasks/:id", async (request) => {
    authenticate(request, "webhook");
    const task = await tasks.get(TaskId.parse(request.params).id);
    invariant(task.principal === "n8n", "FORBIDDEN", 403);
    return { id: task.id, status: task.status, result: task.result };
  });
  return app;
}
