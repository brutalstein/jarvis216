# JARVIS Core Implementation Plan

**Goal:** Implement the supplied backend directive incrementally with honest evidence.
**Architecture:** Modular TypeScript core, authoritative PostgreSQL state, separate Python worker.
**Tech Stack:** Node 24, strict TypeScript, Fastify, Zod, PostgreSQL, Browser Use.
**Spec:** docs/MASTER_DIRECTIVE.md; architecture in docs/ARCHITECTURE.md.

User explicitly authorizes implementation without unnecessary confirmation. Execute inline.
The cloned repository is empty; use engineering/core-foundation and checkpoint commits.

## Global constraints

- No frontend. Fail closed. No false live-integration claims. No provider permission escalation.
- Exact dependency locks; no host configuration changes or extension activation.
- Model content is untrusted; deterministic policy and verification remain in Core.

## Review focus

- Simultaneous claims and stale workers must not commit twice.
- Crash after external intention must require reconciliation.
- Approval mutation, expiry and reuse must fail.
- Cancellation racing a remote result must not yield COMPLETED.
- Duplicate ingress with different content must fail, not silently reuse identity.

## Execution gates

1. Persistence and policy: tests for invalid transitions, DAG cycles, competing claims,
   budgets, exact approvals, restart recovery, stale fences and idempotency; implement
   contracts.ts, database.ts, tasks.ts, gateway.ts; verify against PostgreSQL-compatible SQL.
2. Integrations and worker: adapters with bounded I/O, deterministic routing and failure
   classification; contract tests use local HTTP services; add opt-in live checks.
3. Control surface: authenticated HTTP + CLI, restricted webhook ingress, event reads,
   cancellation and reconciliation; verify unauthorized and replay requests.
4. Deployment and hardening: pinned Compose, Windows instructions, Python lock/type/lint,
   CI, threat model, benchmark and acceptance matrix; run all available gates.
5. Fresh-context review, fix significant findings, update graph, commit and create a Git
   bundle backup. Push the implementation branch if repository authentication permits.

## Progress

- Research: upstream releases queried 2026-10-17. Docker daemon unavailable.
- Graphify initial update attempted: no code in empty repository; regenerate after code.
- Codex Max skill located in local backup and read; no extensions re-enabled.
