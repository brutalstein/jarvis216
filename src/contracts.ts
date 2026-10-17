import { createHash } from "node:crypto";
import { z } from "zod";

export const states = [
  "CREATED",
  "VALIDATING",
  "PLANNING",
  "READY",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_DEPENDENCY",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
  "RECOVERY_REQUIRED",
] as const;
export type TaskState = (typeof states)[number];
export const terminal = new Set<TaskState>(["COMPLETED", "FAILED", "CANCELLED"]);
const transitions: Record<TaskState, readonly TaskState[]> = {
  CREATED: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: ["READY", "BLOCKED", "FAILED", "CANCELLED"],
  READY: ["RUNNING", "WAITING_FOR_DEPENDENCY", "CANCELLED", "FAILED", "BLOCKED"],
  RUNNING: [
    "VERIFYING",
    "WAITING_FOR_APPROVAL",
    "READY",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
    "BLOCKED",
  ],
  WAITING_FOR_APPROVAL: ["READY", "CANCELLED", "FAILED"],
  WAITING_FOR_DEPENDENCY: ["READY", "BLOCKED", "CANCELLED", "FAILED"],
  VERIFYING: ["COMPLETED", "FAILED", "RECOVERY_REQUIRED", "CANCELLED"],
  RECOVERY_REQUIRED: ["COMPLETED", "FAILED", "CANCELLED"],
  BLOCKED: ["READY", "CANCELLED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};
export function canTransition(from: TaskState, to: string): boolean {
  return transitions[from].includes(to as TaskState);
}
export class CoreError extends Error {
  constructor(
    public code: string,
    public httpStatus = 409,
  ) {
    super(code);
  }
}
export function invariant(condition: unknown, code: string, httpStatus = 409): asserts condition {
  if (!condition) throw new CoreError(code, httpStatus);
}

export const CapabilitySchema = z.enum(["text.generate", "browser.extract", "workflow.invoke"]);
export type Capability = z.infer<typeof CapabilitySchema>;
export const RiskSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type Risk = z.infer<typeof RiskSchema>;
export const ContextEntrySchema = z.strictObject({
  source: z.string().min(1).max(256),
  text: z.string().min(1).max(16_000),
  expiresAt: z.number().int().positive(),
});
export const BrowserInputSchema = z.strictObject({
  url: z.url(),
  expectedText: z.string().min(1).max(4096),
});
export const WorkflowInputSchema = z.strictObject({
  workflow: z.string().min(1).max(100),
  payload: z.record(z.string(), z.json()),
});
export const TaskSpecSchema = z
  .strictObject({
    objective: z.string().trim().min(1).max(16_000),
    capability: CapabilitySchema,
    input: z.record(z.string(), z.json()).default({}),
    providers: z
      .array(z.string().regex(/^[a-z0-9-]{1,40}$/))
      .min(1)
      .max(8),
    risk: RiskSchema.default("LOW"),
    privacy: z.enum(["public", "private", "local-only"]).default("public"),
    budget: z
      .strictObject({
        maxCalls: z.number().int().min(1).max(5).default(2),
        maxDurationMs: z.number().int().min(100).max(300_000).default(60_000),
        maxOutputTokens: z.number().int().min(1).max(8192).default(1024),
      })
      .default({ maxCalls: 2, maxDurationMs: 60_000, maxOutputTokens: 1024 }),
    deadline: z.iso.datetime(),
    parentId: z.uuid().optional(),
    dependencies: z.array(z.uuid()).max(32).default([]),
    context: z.array(ContextEntrySchema).max(8).default([]),
    verification: z.strictObject({
      kind: z.literal("contains"),
      value: z.string().min(1).max(4096),
    }),
  })
  .superRefine((task, ctx) => {
    const schema =
      task.capability === "text.generate"
        ? z.strictObject({})
        : task.capability === "browser.extract"
          ? BrowserInputSchema
          : WorkflowInputSchema;
    if (!schema.safeParse(task.input).success)
      ctx.addIssue({
        code: "custom",
        path: ["input"],
        message: "Invalid parameters for capability",
      });
  });
export type TaskSpec = z.infer<typeof TaskSpecSchema>;
export const ResultSchema = z.strictObject({
  text: z.string().min(1).max(64_000),
  source: z.string().min(1).max(512),
  externalId: z.string().max(256).optional(),
});
export type ExecutionResult = z.infer<typeof ResultSchema>;
export interface Executor {
  id: string;
  capability: Capability;
  external: boolean;
  retrySafe: boolean;
  configuration?: string;
  execute(task: Task, signal: AbortSignal): Promise<ExecutionResult>;
}
export interface Task {
  id: string;
  correlation_id: string;
  principal: string;
  spec: TaskSpec;
  status: TaskState;
  fence: number;
  owner: string | null;
  lease_until: string | number | null;
  calls: number;
  attempt: number;
  result: ExecutionResult | null;
  created_at: string | number;
}
export interface Action {
  id: string;
  task_id: string;
  hash: string;
  target: string;
  risk: Risk;
  status: string;
  parameters: unknown;
  result: ExecutionResult | null;
}
export function fingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          // Code-unit order: localeCompare would make hashes depend on the process locale.
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function taskDeadline(task: Task): number {
  return Math.min(
    Date.parse(task.spec.deadline),
    Number(task.created_at) + task.spec.budget.maxDurationMs,
  );
}
// Declared event families. Consumers may rely on this closed set; extend it deliberately.
export const EventTypeSchema = z.enum([
  "task.transition",
  "provider.selected",
  "context.added",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  "action.intended",
  "execution.failed",
  "verification.succeeded",
  "verification.failed",
  "cancellation.requested",
  "action.reconciled",
]);
export type EventType = z.infer<typeof EventTypeSchema>;
export const EnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(1),
  messageId: z.uuid(),
  correlationId: z.uuid(),
  causationId: z.uuid().nullable(),
  taskId: z.uuid(),
  sender: z.literal("jarvis-core"),
  recipient: z.literal("task-events"),
  type: EventTypeSchema,
  schemaVersion: z.literal(1),
  timestamp: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  capabilities: z.array(CapabilitySchema),
  idempotencyKey: z.string(),
  payload: z.record(z.string(), z.json()),
});
