import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type Action,
  type Executor,
  fingerprint,
  invariant,
  ResultSchema,
  type Risk,
  type Task,
  type TaskState,
} from "./contracts.js";
import { ProviderFailure } from "./routing.js";
import type { TaskService } from "./tasks.js";

export class ActionGateway {
  constructor(
    private tasks: TaskService,
    private redact: (text: string) => string = (text) => text,
  ) {}

  async run(claim: Task, executor: Executor, signal: AbortSignal): Promise<TaskState> {
    invariant(
      executor.capability === claim.spec.capability && claim.spec.providers.includes(executor.id),
      "CAPABILITY_DENIED",
      403,
    );
    invariant(!(claim.spec.privacy === "local-only" && executor.external), "PRIVACY_DENIED", 403);
    const risk: Risk =
      claim.spec.risk === "CRITICAL"
        ? "CRITICAL"
        : executor.capability === "workflow.invoke" ||
            (executor.external && claim.spec.privacy === "private")
          ? "HIGH"
          : claim.spec.risk;
    const parameters = {
      capability: claim.spec.capability,
      target: executor.id,
      input: claim.spec.input,
      objective: claim.spec.objective,
      privacy: claim.spec.privacy,
      budget: claim.spec.budget,
      verification: claim.spec.verification,
      configuration: executor.configuration ?? "v1",
      risk,
      taskId: claim.id,
    };
    const hash = fingerprint(parameters);
    const action = await this.tasks.locked(async (tx) => {
      const task = await this.tasks.get(claim.id, tx);
      this.tasks.assertLease(task, claim.owner, claim.fence);
      invariant(Date.parse(task.spec.deadline) > Date.now(), "DEADLINE_EXPIRED");
      invariant(task.calls < task.spec.budget.maxCalls, "CALL_BUDGET_EXCEEDED");
      let current = (
        await tx.query<Action>("SELECT * FROM actions WHERE task_id=$1 AND hash=$2", [
          task.id,
          hash,
        ])
      ).rows[0];
      if (!current) {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO actions(id,task_id,hash,target,risk,parameters,status) VALUES($1,$2,$3,$4,$5,$6,'AWAITING_APPROVAL')",
          [id, task.id, hash, executor.id, risk, JSON.stringify(parameters)],
        );
        current = {
          id,
          task_id: task.id,
          hash,
          target: executor.id,
          risk,
          parameters,
          status: "AWAITING_APPROVAL",
          result: null,
        };
      }
      invariant(current.status === "AWAITING_APPROVAL", "ACTION_ALREADY_ATTEMPTED");
      if (["HIGH", "CRITICAL"].includes(risk)) {
        const approval = (
          await tx.query<{ hash: string; expires_at: string; consumed_at: string | null }>(
            "SELECT * FROM approvals WHERE action_id=$1",
            [current.id],
          )
        ).rows[0];
        if (
          !approval ||
          approval.hash !== hash ||
          Number(approval.expires_at) <= Date.now() ||
          approval.consumed_at
        ) {
          await this.tasks.move(tx, task, "WAITING_FOR_APPROVAL", "exact action approval required");
          await this.tasks.event(tx, task, "approval.requested", { actionId: current.id, hash });
          await this.tasks.release(tx, task.id);
          return null;
        }
        await tx.query("UPDATE approvals SET consumed_at=$2 WHERE action_id=$1", [
          current.id,
          Date.now(),
        ]);
      }
      invariant(!signal.aborted, "CANCELLED");
      await tx.query("UPDATE actions SET status='EXECUTING' WHERE id=$1", [current.id]);
      await tx.query("UPDATE tasks SET calls=calls+1 WHERE id=$1", [task.id]);
      await this.tasks.event(tx, task, "action.intended", {
        actionId: current.id,
        hash,
        target: executor.id,
      });
      return current;
    });
    if (!action) return "WAITING_FOR_APPROVAL";
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(
        Math.max(
          1,
          Math.min(claim.spec.budget.maxDurationMs, Date.parse(claim.spec.deadline) - Date.now()),
        ),
      ),
    ]);
    return trace
      .getTracer("jarvis-core", "0.1.0")
      .startActiveSpan("action.execute", async (span) => {
        span.setAttributes({
          "task.id": claim.id,
          "action.id": action.id,
          "provider.id": executor.id,
        });
        try {
          const result = ResultSchema.parse(
            JSON.parse(this.redact(JSON.stringify(await executor.execute(claim, combined)))),
          );
          combined.throwIfAborted();
          return await this.tasks.locked(async (tx) => {
            const task = await this.tasks.get(claim.id, tx);
            this.tasks.assertLease(task, claim.owner, claim.fence);
            invariant(Date.parse(task.spec.deadline) > Date.now(), "DEADLINE_EXPIRED");
            await this.tasks.move(
              tx,
              task,
              "VERIFYING",
              "executor returned; response is untrusted",
            );
            const verified = result.text.includes(task.spec.verification.value);
            await tx.query("UPDATE actions SET status=$2,result=$3 WHERE id=$1", [
              action.id,
              verified ? "SUCCEEDED" : "FAILED",
              JSON.stringify(result),
            ]);
            await tx.query("UPDATE tasks SET result=$2 WHERE id=$1", [
              task.id,
              JSON.stringify(result),
            ]);
            await this.tasks.event(
              tx,
              task,
              verified ? "verification.succeeded" : "verification.failed",
              { actionId: action.id, evidenceKind: "output-contract", source: result.source },
            );
            await this.tasks.move(
              tx,
              task,
              verified ? "COMPLETED" : "FAILED",
              "deterministic output contract checked",
            );
            await this.tasks.release(tx, task.id);
            return task.status;
          });
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "execution failed; sensitive detail suppressed",
          });
          return await this.tasks.locked(async (tx) => {
            const task = await this.tasks.get(claim.id, tx);
            if (task.fence !== claim.fence || task.status === "RECOVERY_REQUIRED")
              return task.status;
            const safe = executor.retrySafe && !combined.aborted;
            const targets = (
              await tx.query<{ target: string }>(
                "SELECT target FROM actions WHERE task_id=$1 AND status<>'AWAITING_APPROVAL'",
                [task.id],
              )
            ).rows.map((a) => a.target);
            const fallback =
              safe &&
              error instanceof ProviderFailure &&
              error.retryable &&
              task.calls < task.spec.budget.maxCalls &&
              task.spec.providers.some((p) => !targets.includes(p));
            const state = fallback ? "READY" : safe ? "FAILED" : "RECOVERY_REQUIRED";
            await tx.query("UPDATE actions SET status=$2 WHERE id=$1", [
              action.id,
              safe ? "FAILED" : "UNCERTAIN",
            ]);
            if (fallback)
              await tx.query("UPDATE tasks SET not_before=$2 WHERE id=$1", [
                task.id,
                Date.now() +
                  Math.min(30_000, 500 * 2 ** task.calls) +
                  Math.floor(Math.random() * 250),
              ]);
            await this.tasks.event(tx, task, "execution.failed", {
              actionId: action.id,
              kind: error instanceof ProviderFailure ? error.kind : "internal-or-transport",
              retryEligible: fallback,
            });
            await this.tasks.move(
              tx,
              task,
              state,
              fallback
                ? "bounded fallback; same capability and task policy"
                : safe
                  ? "retry-safe executor failed"
                  : "external outcome uncertain",
            );
            await this.tasks.release(tx, task.id);
            return task.status;
          });
        } finally {
          span.end();
        }
      });
  }
}
