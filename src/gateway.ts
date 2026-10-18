import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type Action,
  type Executor,
  fingerprint,
  invariant,
  verified as meetsVerification,
  ResultSchema,
  type Risk,
  RiskSchema,
  type Task,
  type TaskState,
  taskDeadline,
} from "./contracts.js";
import type { Sql } from "./database.js";
import { ProviderFailure } from "./routing.js";
import type { TaskService } from "./tasks.js";

// Failures tied to one provider (revoked key, delisted model): another listed provider may work.
const providerBound = new Set(["authentication-required", "permanent"]);
// One plan tap approves its MEDIUM steps for this long.
export const planApprovalMs = 120_000;

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
    // Deterministic floor: the highest of declared risk, executor floor and policy floor.
    const policyFloor: Risk =
      executor.capability === "workflow.invoke" ||
      (executor.external && claim.spec.privacy === "private" && !executor.trustedForPrivate)
        ? "HIGH"
        : "LOW";
    const risk = [claim.spec.risk, executor.riskFloor ?? "LOW", policyFloor].reduce((a, b) =>
      RiskSchema.options.indexOf(b) > RiskSchema.options.indexOf(a) ? b : a,
    );
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
      invariant(taskDeadline(task) > Date.now(), "DEADLINE_EXPIRED");
      invariant(task.calls < task.spec.budget.maxCalls, "CALL_BUDGET_EXCEEDED");
      let current = (
        await tx.query<Action>("SELECT * FROM actions WHERE task_id=$1 AND hash=$2", [
          task.id,
          hash,
        ])
      ).rows[0];
      if (!current) {
        // Parameters changed (e.g. context expiry, configuration): older proposals are void.
        await tx.query(
          "UPDATE actions SET status='SUPERSEDED' WHERE task_id=$1 AND status='AWAITING_APPROVAL'",
          [task.id],
        );
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
      if (risk !== "LOW") {
        const approval = (
          await tx.query<{ hash: string; expires_at: string; consumed_at: string | null }>(
            "SELECT * FROM approvals WHERE action_id=$1",
            [current.id],
          )
        ).rows[0];
        const exact =
          approval &&
          approval.hash === hash &&
          Number(approval.expires_at) > Date.now() &&
          !approval.consumed_at;
        const viaPlan = !exact && risk === "MEDIUM" && (await this.planApproves(tx, task, risk));
        if (!exact && !viaPlan) {
          await this.tasks.move(tx, task, "WAITING_FOR_APPROVAL", "exact action approval required");
          await this.tasks.event(tx, task, "approval.requested", { actionId: current.id, hash });
          await this.tasks.release(tx, task.id);
          return null;
        }
        if (exact)
          await tx.query("UPDATE approvals SET consumed_at=$2 WHERE action_id=$1", [
            current.id,
            Date.now(),
          ]);
        else
          await this.tasks.event(tx, task, "approval.granted", {
            planId: task.spec.planId ?? null,
            approver: "operator",
            via: "plan",
          });
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
    const executionStarted = Date.now();
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(Math.max(1, taskDeadline(claim) - Date.now())),
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
          const received = ResultSchema.parse(await executor.execute(claim, combined));
          const result = ResultSchema.parse({
            ...received,
            text: this.redact(received.text),
            source: this.redact(received.source),
            ...(received.externalId ? { externalId: this.redact(received.externalId) } : {}),
          });
          combined.throwIfAborted();
          return await this.tasks.locked(async (tx) => {
            const task = await this.tasks.get(claim.id, tx);
            this.tasks.assertLease(task, claim.owner, claim.fence);
            invariant(taskDeadline(task) > Date.now(), "DEADLINE_EXPIRED");
            await this.tasks.move(
              tx,
              task,
              "VERIFYING",
              "executor returned; response is untrusted",
            );
            const verified = meetsVerification(task.spec, result.text);
            // An unverified result from a side-effecting executor proves the action ran, not
            // that it failed: never let FAILED invite a blind resubmission. An executor that
            // observed the outcome itself reports a definite failure.
            const outcome = verified
              ? "COMPLETED"
              : executor.retrySafe || executor.outcomeObservable
                ? "FAILED"
                : null;
            await tx.query("UPDATE actions SET status=$2,result=$3 WHERE id=$1", [
              action.id,
              verified ? "SUCCEEDED" : outcome ? "FAILED" : "EXECUTING",
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
              {
                actionId: action.id,
                evidenceKind: "output-contract",
                source: result.source,
                durationMs: Date.now() - executionStarted,
                traceId: span.spanContext().traceId,
              },
            );
            if (outcome) {
              await this.tasks.move(tx, task, outcome, "deterministic output contract checked");
              await this.tasks.release(tx, task.id);
            } else await this.tasks.quarantine(tx, task, "side effect executed; output unverified");
            return task.status;
          });
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "execution failed; sensitive detail suppressed",
          });
          return await this.tasks.locked(async (tx) => {
            const task = await this.tasks.get(claim.id, tx);
            if (task.fence !== claim.fence || !["RUNNING", "VERIFYING"].includes(task.status))
              return task.status;
            // Definite failure: no side effect possible. A deadline abort of a retry-safe call
            // is definite; operator cancel, shutdown or lease loss stays conservative.
            const safe =
              (error instanceof ProviderFailure && !error.dispatched) ||
              (executor.retrySafe && !signal.aborted);
            const targets = await this.tasks.attemptedTargets(task.id, tx);
            const fallback =
              safe &&
              !combined.aborted &&
              error instanceof ProviderFailure &&
              (error.retryable || providerBound.has(error.kind)) &&
              task.calls < task.spec.budget.maxCalls &&
              task.spec.providers.some((p) => !targets.includes(p));
            if (safe) await tx.query("UPDATE actions SET status='FAILED' WHERE id=$1", [action.id]);
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
            if (!safe) await this.tasks.quarantine(tx, task, "external outcome uncertain");
            else {
              await this.tasks.move(
                tx,
                task,
                fallback ? "READY" : "FAILED",
                fallback
                  ? "bounded fallback; same capability and task policy"
                  : "definite failure; no side effect possible",
              );
              await this.tasks.release(tx, task.id);
            }
            return task.status;
          });
        } finally {
          span.end();
        }
      });
  }

  // A step of an approved, unexpired, running plan whose compiled step is exactly this action.
  private async planApproves(tx: Sql, task: Task, risk: Risk): Promise<boolean> {
    if (!task.spec.planId) return false;
    const plan = (
      await tx.query<{
        steps: { action: string; args: unknown; risk: Risk }[];
        task_ids: string[];
        status: string;
        approved_at: string | null;
      }>("SELECT steps,task_ids,status,approved_at FROM plans WHERE id=$1", [task.spec.planId])
    ).rows[0];
    if (
      plan?.status !== "RUNNING" ||
      plan.approved_at === null ||
      Date.now() > Number(plan.approved_at) + planApprovalMs
    )
      return false;
    const step = plan.steps[plan.task_ids.indexOf(task.id)];
    return (
      step !== undefined &&
      fingerprint({ action: step.action, args: step.args, risk: step.risk }) ===
        fingerprint({ ...task.spec.input, risk })
    );
  }
}
