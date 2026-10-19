import { z } from "zod";
import { invariant } from "../../core/contracts.js";
import type { TaskService } from "../../core/tasks.js";
import { type HttpContext, TaskId } from "../context.js";

// n8n ingress with its own credential: submit an agent task, read only n8n's own tasks.
export function hookRoutes({ app, authenticate, options }: HttpContext, tasks: TaskService): void {
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
}
