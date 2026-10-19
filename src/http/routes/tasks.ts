import { z } from "zod";
import { states, TaskSpecSchema } from "../../core/contracts.js";
import type { TaskService } from "../../core/tasks.js";
import { type HttpContext, TaskId } from "../context.js";

// The typed task API: admission, inspection, cancellation, approvals and reconciliation.
export function taskRoutes({ app, authenticate, options }: HttpContext, tasks: TaskService): void {
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
}
