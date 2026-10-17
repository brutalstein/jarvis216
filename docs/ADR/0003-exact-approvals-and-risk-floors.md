# ADR 0003: Exact approvals and deterministic risk floors

Status: accepted, 2026-10-17

## Context

Models and task submitters cannot be trusted to classify their own risk. Approvals must not be
reusable for a changed action.

## Decision

- Effective risk = max(declared risk, executor floor, policy floor). Executors that can act
  beyond Core's observation (OpenClaw, Codex, n8n) have a HIGH floor. `workflow.invoke`, and any
  external provider on a private task, are HIGH by policy.
- HIGH and CRITICAL need an approval bound to the canonical hash of the full action parameters
  and executor configuration. Approvals expire and are consumed atomically with the intent.
- Creating a new action supersedes earlier actions still awaiting approval.
- Rejection denies the action and cancels the task.

## Consequences

- An operator approves exactly what will run; any parameter or configuration change needs a
  new approval.
- Agentic providers always need a human in the loop in this release.
