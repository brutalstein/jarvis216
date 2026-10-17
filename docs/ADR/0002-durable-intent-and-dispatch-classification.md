# ADR 0002: Durable intent and dispatch classification

Status: accepted, 2026-10-17

## Context

External side effects cannot be rolled back. A crash, timeout or abort after a request leaves
the external outcome unknown. Blind retries can duplicate payments, messages or workflow runs.

## Decision

- Before any I/O, one transaction records the action intent (status EXECUTING) and consumes
  any approval. A lease fence is checked on commit, so a late worker cannot commit.
- A failure is safe only when Core can show nothing happened: the provider was never reached
  (connection refused, DNS failure, HTTP 401/403), or the executor is declared retry-safe and
  the request was not aborted. `ProviderFailure.dispatched` carries this fact from the adapter.
- Safe failures become FAILED or fall back to another allowed provider within the call budget
  and deadline, with bounded backoff and jitter.
- Every other failure, an expired lease with an intent, a cancellation during execution, and
  unverified output from a side-effecting executor quarantine the task: RECOVERY_REQUIRED,
  action UNCERTAIN, lease released. Only operator reconciliation with evidence resolves it.

## Consequences

- No exactly-once claim: at most one dispatch per action, with explicit uncertainty.
- Conservative cases (browser 400/429, n8n timeouts) need operator review even when the
  remote side may have done nothing. This is the intended cost of fail-closed behavior.
