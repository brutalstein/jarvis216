# ADR 0014: Operator-managed standing permissions

Status: accepted, 2026-10-18. Amends [ADR 0003](0003-exact-approvals-and-risk-floors.md) and
[ADR 0010](0010-model-proposed-typed-plans.md) and
[ADR 0012](0012-operator-approved-memory.md).

## Context

Every MEDIUM step waited for a tap and every HIGH step for its own exact approval. For the one
trusted operator this made routine voice work slow: they asked to decide once, in Settings, what
JARVIS may do on its own, after which a spoken command should simply run.

## Decision

1. Each catalog action has an operator decision: `ask`, `allow` (optionally expiring, up to 30
   days) or `deny`. Defaults reproduce the previous rules (`guarded`: LOW allow, MEDIUM and HIGH
   ask). Levels set every action at once: `trusted` allows everything but HIGH, `autonomous`
   allows everything.
2. A plan waits for the operator's tap when any of its steps is `ask`. With `allow`, the gateway
   treats the standing decision as the operator's approval: it records `approval.granted` with
   `via: "standing-grant"`, the action and the policy version. It applies only to a step of a
   running plan, bound to the task by the plan's own task list (and, for desktop, info and memory
   steps, by the exact compiled step), and never to CRITICAL risk.
3. `deny` hides the action from every prompt, refuses a plan that contains it and is re-checked by
   the gateway at run time, so turning an action off mid-plan stops it before execution.
4. Decisions are changed only through Core's authenticated operator API (the desktop Settings call
   it from the main process). Every change is written to `permission_audit`; its id is the policy
   version.
5. Unchanged in every mode: engine guards (shells, the Run dialog, password fields, folders outside
   the roots), catalog-only actions, schema validation, durable intent, verification and
   uncertainty handling. Voice still never approves anything; it can only trigger what the
   operator already allowed.

## Consequences

- With `trusted` or `autonomous`, a misheard or injected utterance that compiles to an allowed
  action runs without a card. That is the operator's explicit trade; time-limited grants and the
  audit trail bound it.
- Direct API tasks (outside plans) are unaffected and keep exact approvals.
- Permission state is per Core process, loaded from PostgreSQL at startup and after each change.
