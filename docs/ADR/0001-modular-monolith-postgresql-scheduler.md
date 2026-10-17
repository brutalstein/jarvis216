# ADR 0001: Modular monolith with PostgreSQL as the only scheduler

Status: accepted, 2026-10-17

## Context

The directive requires one authoritative owner for tasks, policy, approvals, verification and
recovery, and forbids conflicting global orchestration loops. The deployment target is one
operator on a Windows laptop with small concurrency.

## Decision

Core is one TypeScript process with clear modules (contracts, tasks, gateway, routing, worker,
server). Browser Use runs in a separate Python process because it is a Python library and runs
untrusted pages. PostgreSQL is the only queue and the only state store. A global scheduler row
lock serializes admission, claims, dependency edits and recovery. Workers hold fenced leases.
No Redis, no message broker, no second scheduler. External I/O never happens inside a
transaction.

## Consequences

- One source of truth; crash recovery reads one database.
- Claims serialize. The benchmark measures claim latency with a 500-task blocked backlog
  (PostgreSQL 18.3: p95 10.6 ms). Revisit with `SKIP LOCKED` partitioning only when measured
  contention requires it.
- n8n queue mode, which needs Redis, stays disabled; n8n is a trigger and a callee, not a scheduler.
