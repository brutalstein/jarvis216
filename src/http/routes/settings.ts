import type { Brain } from "@jarvis/brain";
import { z } from "zod";
import { invariant } from "../../core/contracts.js";
import type { MemoryStore } from "../../services/memory.js";
import { maxGrantMs, type PermissionService } from "../../services/permissions.js";
import { type HttpContext, TaskId } from "../context.js";

// What the desktop Settings manage: permissions (audited), what JARVIS learned, its notes.
export function settingsRoutes(
  { app, authenticate }: HttpContext,
  services: { permissions?: PermissionService; brain?: Brain; memory?: MemoryStore },
): void {
  const { permissions, brain, memory } = services;
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
}
