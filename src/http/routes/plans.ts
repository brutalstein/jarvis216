import { z } from "zod";
import { invariant } from "../../core/contracts.js";
import type { TaskService } from "../../core/tasks.js";
import type { PlanService, PlanView } from "../../services/plans/index.js";
import { type HttpContext, TaskId } from "../context.js";

// Plan cards: approve, reject, cancel, choose, and the live stream the desktop listens to.
export function planRoutes(
  { app, authenticate }: HttpContext,
  tasks: TaskService,
  plans: PlanService,
): void {
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
    // Restore cards after a desktop reconnect without replaying spoken announcements. The
    // reply is hijacked, so a failure here ends the stream; the desktop reconnects.
    try {
      const recent = await tasks.db.query<{ id: string }>(
        "SELECT id FROM plans ORDER BY created_at DESC LIMIT 8",
      );
      for (const { id } of recent.rows) if (!closed) onPlan(await plans.get(id));
    } catch {
      process.stderr.write('{"level":"error","code":"STREAM_RESTORE_FAILED"}\n');
      close();
    }
  });
}
