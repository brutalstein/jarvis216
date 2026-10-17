# ADR 0004: Operators submit typed plans; models only propose

Status: accepted, 2026-10-17

## Context

The directive allows planning by models but requires deterministic authority over execution.
Executable model-generated plans would let untrusted output choose capabilities and targets.

## Decision

Tasks are typed by the operator: objective, capability, provider allowlist, privacy, budget,
deadline, verification and dependencies. Models return text that is checked against the
declared verification. Larger jobs are DAGs of typed tasks. "Plan proposed" events are not
emitted because no model plan is executed.

## Consequences

- Prompt injection cannot add actions or widen permissions.
- Autonomous planning is a future extension: a model may propose a DAG, but an operator or a
  deterministic policy must convert it into typed tasks before admission.
