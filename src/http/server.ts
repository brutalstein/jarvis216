import { createHash, timingSafeEqual } from "node:crypto";
import type { Brain } from "@jarvis/brain";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { CoreError, invariant, states, TaskSpecSchema } from "../core/contracts.js";
import type { ProviderRegistry } from "../core/routing.js";
import type { TaskService } from "../core/tasks.js";
import type { ConversationService } from "../services/conversation.js";
import type { MemoryStore } from "../services/memory.js";
import { maxGrantMs, type PermissionService } from "../services/permissions.js";
import type { PlanService, PlanView } from "../services/plans/index.js";

export interface ServerOptions {
  operatorToken: string;
  webhookToken: string;
  onCancel(id: string): void;
  // Called after a task is admitted so idle workers can claim it without waiting.
  onAdmit?(): void;
  conversation?: ConversationService;
  plans?: PlanService;
  memory?: MemoryStore;
  permissions?: PermissionService;
  brain?: Brain;
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
  const { plans } = options;
  if (plans) {
    app.get("/v1/plans/:id", async (request) => {
      authenticate(request, "operator");
      return plans.get(TaskId.parse(request.params).id);
    });
    app.post("/v1/plans/:id/approve", async (request, reply) => {
      authenticate(request, "operator");
      const { hash } = z.strictObject({ hash: z.string().min(1).max(128) }).parse(request.body);
      await plans.approve(TaskId.parse(request.params).id, hash);
      return reply.code(204).send();
    });
    for (const method of ["reject", "cancel"] as const) {
      app.post(`/v1/plans/:id/${method}`, async (request, reply) => {
        authenticate(request, "operator");
        await plans[method](TaskId.parse(request.params).id);
        return reply.code(204).send();
      });
    }
    app.post("/v1/plans/:id/choose", async (request) => {
      authenticate(request, "operator");
      const { index } = z
        .strictObject({ index: z.number().int().min(1).max(20) })
        .parse(request.body);
      return plans.choose(TaskId.parse(request.params).id, index);
    });
    const streams = new Set<() => void>();
    app.addHook("preClose", async () => {
      for (const close of streams) close();
    });
    app.get("/v1/stream", async (request, reply) => {
      authenticate(request, "operator");
      invariant(streams.size < 8, "TOO_MANY_STREAMS", 429);
      request.raw.socket.setTimeout(0);
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        plans.off("plan", onPlan);
        plans.off("announce", onAnnounce);
        streams.delete(close);
        raw.end();
      };
      const send = (frame: string) => {
        // A stalled renderer reconnects; never retain an unbounded stream queue. The cap bounds
        // the backlog only: one news view with thumbnails may itself exceed 2 MB.
        if (closed) return;
        if (raw.writableLength > 4_000_000) close();
        else raw.write(frame);
      };
      const onPlan = (view: PlanView) => send(`event: plan\ndata: ${JSON.stringify(view)}\n\n`);
      const onAnnounce = (value: { text: string; lang: string }) =>
        send(`event: announce\ndata: ${JSON.stringify(value)}\n\n`);
      const ping = setInterval(() => send(": ping\n\n"), 5000);
      streams.add(close);
      plans.on("plan", onPlan);
      plans.on("announce", onAnnounce);
      raw.once("close", close);
      raw.once("error", close);
      send(": connected\n\n");
      // Restore cards after a desktop reconnect without replaying spoken announcements.
      const recent = await tasks.db.query<{ id: string }>(
        "SELECT id FROM plans ORDER BY created_at DESC LIMIT 8",
      );
      for (const { id } of recent.rows) if (!closed) onPlan(await plans.get(id));
    });
  }
  const { permissions } = options;
  if (permissions) {
    // The desktop Settings manage these; every change is audited.
    app.get("/v1/permissions", async (request) => {
      authenticate(request, "operator");
      return permissions.view();
    });
    app.put("/v1/permissions", async (request) => {
      authenticate(request, "operator");
      return permissions.update(request.body, "operator");
    });
    app.post("/v1/permissions/preset", async (request) => {
      authenticate(request, "operator");
      const { preset, expiresInMs } = z
        .strictObject({
          preset: z.enum(["guarded", "trusted", "autonomous"]),
          expiresInMs: z.number().int().min(60_000).max(maxGrantMs).optional(),
        })
        .parse(request.body);
      return permissions.preset(preset, "operator", expiresInMs);
    });
    app.get("/v1/permissions/audit", async (request) => {
      authenticate(request, "operator");
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
        .parse(request.query);
      return { entries: await permissions.audit(limit) };
    });
  }
  const { brain } = options;
  if (brain) {
    // What JARVIS has learned: statistics and skills, a manual "sleep", and forgetting.
    app.get("/v1/brain", async (request) => {
      authenticate(request, "operator");
      return {
        stats: brain.stats(),
        skills: brain.skills().map((skill) => ({
          id: skill.id,
          goal: skill.goal,
          phrases: skill.phrases,
          steps: skill.steps.map((step) => step.action),
          strength: Math.round(skill.effective * 1000) / 1000,
          successes: skill.successes,
          failures: skill.failures,
          uses: skill.uses,
          lastUsedAt: skill.lastUsedAt,
        })),
      };
    });
    app.post("/v1/brain/consolidate", async (request) => {
      authenticate(request, "operator");
      return brain.consolidate();
    });
    app.delete("/v1/brain/skills/:id", async (request, reply) => {
      authenticate(request, "operator");
      invariant(await brain.forgetSkill(TaskId.parse(request.params).id), "SKILL_NOT_FOUND", 404);
      return reply.code(204).send();
    });
    app.delete("/v1/brain", async (request, reply) => {
      authenticate(request, "operator");
      await brain.forgetAll();
      return reply.code(204).send();
    });
  }
  const { memory } = options;
  if (memory) {
    // Operator-approved long-term memory: review, forget one note, or forget everything.
    app.get("/v1/memories", async (request) => {
      authenticate(request, "operator");
      return { memories: await memory.list() };
    });
    app.delete("/v1/memories/:id", async (request, reply) => {
      authenticate(request, "operator");
      invariant(await memory.delete(TaskId.parse(request.params).id), "MEMORY_NOT_FOUND", 404);
      return reply.code(204).send();
    });
    app.delete("/v1/memories", async (request, reply) => {
      authenticate(request, "operator");
      await memory.deleteAll();
      return reply.code(204).send();
    });
  }
  const { conversation } = options;
  if (conversation) {
    app.post("/v1/conversation/turns", async (request) => {
      authenticate(request, "operator");
      const body = z
        .strictObject({
          utterance: z.string().trim().min(1).max(4000),
          followUp: z.boolean().default(false),
        })
        .parse(request.body);
      // A turn may wait longer than the server-wide 10 s socket idle limit (injected test
      // requests have no real socket).
      request.raw.socket.setTimeout?.(conversation.deadlineMs * 2 + 10000);
      return conversation.turn(body);
    });
    app.get("/v1/conversation/turns", async (request) => {
      authenticate(request, "operator");
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(request.query);
      return { turns: await conversation.list(limit) };
    });
    app.delete("/v1/conversation/turns", async (request, reply) => {
      authenticate(request, "operator");
      await conversation.deleteAll();
      return reply.code(204).send();
    });
  }
  return app;
}
