# Snapshot error E2E repair plan

**Goal:** Keep failed Windows-MCP snapshots from becoming successful observations.

**Scope:** `packages/action-engine/src/run.ts` and its existing tests. Preserve transport-error propagation, cancellation, guards, approvals, settings and credentials.

- [x] Replay the observed `USER_CONTROL` response for snapshot-dependent actions; verify failing regression tests.
- [x] Reject failed snapshot responses at the shared reader and return observed-failure evidence at the action boundary.
- [x] Run Action Engine tests, affected Core adapter tests, typecheck and lint; rerun a real JARVIS desktop observation.
- [x] Refresh graphify and record evidence and remaining E2E blockers in `E2E_REPORT.md`.
