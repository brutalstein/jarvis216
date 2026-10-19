import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { CoreError, invariant } from "../core/contracts.js";
import type { ProviderRegistry } from "../core/routing.js";
import type { TaskService } from "../core/tasks.js";
import type { HttpContext, ServerOptions } from "./context.js";
import { conversationRoutes } from "./routes/conversation.js";
import { healthRoutes } from "./routes/health.js";
import { hookRoutes } from "./routes/hooks.js";
import { planRoutes } from "./routes/plans.js";
import { settingsRoutes } from "./routes/settings.js";
import { taskRoutes } from "./routes/tasks.js";

export type { HttpContext, ServerOptions };
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
  app.setErrorHandler((error, request, reply) => {
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
    // A server fault is logged by route only: messages may carry prompts or results.
    if (status >= 500)
      process.stderr.write(
        `${JSON.stringify({ level: "error", code: "HTTP_INTERNAL_ERROR", method: request.method, route: request.routeOptions.url ?? "unknown", ...(error instanceof CoreError && { error: error.code }) })}\n`,
      );
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
  const http: HttpContext = { app, authenticate, options };
  healthRoutes(http, tasks, registry);
  taskRoutes(http, tasks);
  hookRoutes(http, tasks);
  if (options.plans) planRoutes(http, tasks, options.plans);
  settingsRoutes(http, {
    ...(options.permissions && { permissions: options.permissions }),
    ...(options.brain && { brain: options.brain }),
    ...(options.memory && { memory: options.memory }),
  });
  if (options.conversation) conversationRoutes(http, options.conversation);
  return app;
}
