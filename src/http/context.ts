import type { Brain } from "@jarvis/brain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ConversationService } from "../services/conversation.js";
import type { MemoryStore } from "../services/memory.js";
import type { PermissionService } from "../services/permissions.js";
import type { PlanService } from "../services/plans/index.js";

// What every route module receives: the app, the authentication check and the services.
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
  capabilities?(): Promise<unknown>;
}
export const TaskId = z.strictObject({ id: z.uuid() });
export type HttpContext = {
  app: FastifyInstance;
  authenticate(request: FastifyRequest, role: "operator" | "webhook"): void;
  options: ServerOptions;
};
