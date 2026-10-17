import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { CoreError, invariant, TaskSpecSchema } from "./contracts.js";
import type { ProviderRegistry } from "./routing.js";
import type { TaskService } from "./tasks.js";

export interface ServerOptions {
  operatorToken: string;
  webhookToken: string;
  onCancel(id: string): void;
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
    const status =
      error instanceof CoreError
        ? error.httpStatus
        : error instanceof z.ZodError
          ? 400
          : typeof error === "object" &&
              error &&
              "statusCode" in error &&
              Number(error.statusCode) === 413
            ? 413
            : 500;
    reply.code(status).send({
      error:
        error instanceof CoreError
          ? error.code
          : status === 400
            ? "INVALID_REQUEST"
            : status === 413
              ? "BODY_TOO_LARGE"
              : "INTERNAL_ERROR",
    });
  });
  app.get("/healthz", async () => ({ status: "alive" }));
  app.get("/readyz", async (request) => {
    authenticate(request, "operator");
    await tasks.db.query("SELECT 1");
    return { database: "ready", providers: registry.list(), liveConnectivity: "not-checked" };
  });
  app.post("/v1/tasks", async (request, reply) => {
    authenticate(request, "operator");
    const key = z.string().min(1).max(200).parse(request.headers["idempotency-key"]);
    return reply
      .code(201)
      .send(await tasks.create(TaskSpecSchema.parse(request.body), key, "operator"));
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
        sentAt: z.iso.datetime(),
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
        verification: { kind: "contains", value: body.verificationText },
      },
      `n8n:${body.eventId}`,
      "n8n",
    );
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
