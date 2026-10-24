import { z } from "zod";
import type { ConversationService } from "../../services/conversation.js";
import type { HttpContext } from "../context.js";

// Spoken turns from the voice service, transcript export and deletion.
export function conversationRoutes(
  { app, authenticate }: HttpContext,
  conversation: ConversationService,
): void {
  app.post("/v1/conversation/turns", async (request, reply) => {
    authenticate(request, "operator");
    const body = z
      .strictObject({
        utterance: z.string().trim().min(1).max(4000),
        followUp: z.boolean().default(false),
        // Speech recognition doubted the words; JARVIS confirms its reading before acting.
        uncertain: z.boolean().default(false),
      })
      .parse(request.body);
    // A turn may wait longer than the server-wide 10 s socket idle limit (injected test
    // requests have no real socket).
    request.raw.socket.setTimeout?.(conversation.deadlineMs * 2 + 10000);
    const abort = new AbortController();
    const disconnected = () => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.on("close", disconnected);
    try {
      return await conversation.turn(body, abort.signal);
    } finally {
      reply.raw.off("close", disconnected);
    }
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
