# ADR 0010: Models propose typed plans; a compiler and the operator admit them

Status: accepted, 2026-10-18. Amends [ADR 0004](0004-operator-typed-plans.md).

## Context

ADR 0004 kept execution authority with the operator: tasks were typed by hand and no model plan
ran. M3 turns speech into work on this computer, so the operator can no longer type every task.
Free-form agent loops would let untrusted model output choose capabilities, targets and risk.

## Decision

A model may propose a plan, but it never becomes executable by itself.

1. One conversation call returns `intent: reply | clarify | plan | cancel`. A plan is a list of
   at most eight `{action, args}` steps naming actions from a fixed catalog
   (`packages/action-engine`).
2. The engine compiles each step against the catalog's Zod schema. One unknown action or invalid
   argument rejects the whole plan. One repair call with the validation errors is allowed; after
   that JARVIS says it did not understand.
3. Risk comes from the catalog, never from the model, and Core's provider floors still apply.
   Desktop and info actions are LOW or MEDIUM. Integration actions (Browser Use, n8n, OpenClaw)
   are HIGH.
4. Core stores the compiled plan with `hash = fingerprint(steps)` and creates one typed task per
   step, chained by dependency.
5. Approval:
   - LOW-only plans run at once.
   - A plan with a MEDIUM step waits for one operator tap bound to the plan hash, valid for two
     minutes. The gateway lets a MEDIUM action through only when its own input and risk match a
     compiled step of that approved, running plan.
   - HIGH steps still need their own exact approval.
   - Voice can cancel, never approve.
6. For a plan, the model's spoken text is discarded. JARVIS speaks templates, and outcomes come
   only from Core records.
7. Screen content reaches only trusted-private providers (Claude Code), for `screen.describe` and
   for one replan after an observed failure. A replanned plan is compiled and approved again.

## Consequences

- Prompt injection can at most propose catalog actions. It cannot add tools, raise risk or skip
  the approval card. A changed step changes the hash, so an approval does not carry over.
- The catalog is the capability boundary. Adding an action means adding a schema, a risk, a
  guard and a postcondition with tests.
- Intent quality depends on the model. It is measured on a fixed TR/EN command set
  (`packages/action-engine/eval/commands.jsonl`, `scripts/eval-intents.ts`). Results are in
  [ACTION_ENGINE_EVIDENCE.md](../ACTION_ENGINE_EVIDENCE.md).
- ADR 0004's operator-typed tasks still work unchanged. Model-proposed plans are a second
  admission path that ends in the same typed tasks and the same gateway.
