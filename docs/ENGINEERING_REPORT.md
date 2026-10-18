# Engineering report — JARVIS Core foundation

Date: 2026-10-17. Branch: `engineering/core-foundation`. Host: Windows 11 Pro, Docker Desktop
29.8.2 (WSL2 backend), Node 24.22.0, Python 3.12.10.

This report answers directive §25, maps §21 acceptance criteria to evidence, and records the
§23 review. Every claim is classified:

- **Verified**: implemented and exercised against the real component on this host.
- **Not live-verified**: implemented and tested against local contract servers or fixtures only.
- **Partial**: some of the requirement exists; the gap is stated.
- **Not implemented**: deliberately absent in this release.
- **Blocked**: needs credentials, accounts or infrastructure that were not available.

Passing tests against local HTTP fixtures are not evidence of live provider connectivity.

## 1. Architecture summary

Core is a TypeScript modular monolith and the single authority for tasks, policy, approvals,
execution records, verification and recovery. PostgreSQL is the only queue and state store; a
global scheduler row lock serializes admission, claims, dependency edits and recovery. Workers
claim tasks under fenced leases. The action gateway computes effective risk, enforces exact
single-use approvals, records a durable intent before any I/O, verifies output against the
declared criterion, and quarantines uncertain outcomes for operator reconciliation. Providers
plug in through one `Executor` interface behind a versioned registry with deterministic
routing and a circuit breaker. Browser Use runs in a separate Python worker. Details:
[ARCHITECTURE.md](ARCHITECTURE.md), decisions: [ADR/](ADR/).

## 2. Component responsibility matrix

| Responsibility | Owner | Not owned by |
| --- | --- | --- |
| Task state, DAG, deadlines, leases | Core task service (`src/tasks.ts`) | Providers, n8n, OpenClaw |
| Policy, risk, approvals, call budget | Action gateway (`src/gateway.ts`) | Models, task submitters |
| Provider selection and fallback | Provider registry (`src/routing.ts`) | Models |
| Final verification and result | Action gateway + operator reconciliation | Providers' self-reported success |
| Agent runtime sessions | OpenClaw Gateway | Core (no second session manager) |
| Browser execution | Python Browser Use worker | Core process |
| Triggers and schedules | n8n | Core (n8n cannot reach operator routes) |
| Text proposals | Claude, Gemini, Codex adapters | Authority over actions |
| Durable records | PostgreSQL | Process memory |

## 3. Project structure and implemented modules

| Module | Status | Content |
| --- | --- | --- |
| `src/contracts.ts` | Verified | Task states and transitions, Zod schemas, event envelope and closed event families, canonical fingerprint |
| `src/database.ts` | Verified | Pool, transactions with broken-connection handling, append-only migrations with advisory lock |
| `src/tasks.ts` | Verified | Admission with idempotency and quotas, DAG with cycle checks, claim, lease, cancel, recover, quarantine, approve, reject, reconcile, list |
| `src/gateway.ts` | Verified | Risk floor, exact approval, intent, verification, failure classification, fallback |
| `src/routing.ts`, `src/reliability.ts` | Verified (local) | Registry, measured adaptive routing (`adaptive-v1`), durable circuit breaker, daily call/token budgets |
| `src/memory.ts` | Verified (local) | Operator-approved long-term memory store and executor |
| `src/outbox.ts` | Verified (local) | Transactional outbox pushing n8n task outcomes (contract tests against a local HTTP receiver) |
| `src/worker.ts` | Verified | Claim loop, heartbeat with retry, graceful drain |
| `src/server.ts`, `src/cli.ts` | Verified | Authenticated loopback API and CLI (live in Docker) |
| `src/context.ts` | Verified (local) | Bounded, redacted, expiring context with provenance |
| `src/security.ts`, `src/telemetry.ts` | Verified (local) | Secret references and redaction, path containment, OpenTelemetry spans |
| `src/integrations/http.ts` | Verified (local) | Bounded HTTP with undici keep-alive dispatcher and dispatch classification |
| `src/integrations/models.ts` | Partial live | Codex ChatGPT subscription and Gemini API (`gemini-3.5-flash`) completed; Claude Messages API not live-verified (no API key by design) |
| `src/integrations/claude-code.ts` | Verified live | Official CLI subscription harness, 15 subprocess tests; live Core tasks COMPLETED without git, hook or CLAUDE.md context |
| `src/integrations/services.ts` | Partial live | OpenClaw (live), Browser Use (live readback), n8n webhook (live); API client multi-page discovery + waitExecution (contract tests) |
| `packages/integration-hub` | Verified (local) | Voice recipes for OpenClaw / Browser / n8n including `browser.read_many` |
| `scripts/browser-native.ps1`, `scripts/integrations-native.ps1` | Verified (local) | Native Windows launchers; n8n remains Compose-only |
| `workers/browser/worker.py` | Verified (native) | Authenticated worker, exact URL allowlist, single or multi-page Actor DOM readback |
| `schemas/` | Verified | JSON Schemas generated from runtime contracts; drift test |
| `compose.yaml`, `Dockerfile` | Verified | Pinned images, segmented networks, hardened Core container |

## 4. Verified dependency versions

Node 24.22.0, TypeScript 7.0.2, Fastify 5.12.7, Zod 4.6.7, pg 8.23.1, PGlite 0.5.10,
OpenTelemetry API 1.9.1 / SDK 2.12.0, `@anthropic-ai/sdk` 0.135.0, `@google/genai` 2.30.0,
`@openai/codex-sdk` 0.163.0, browser-use 0.13.11, PostgreSQL 18.3 (digest pinned), n8n 2.43.7.
Locks: `package-lock.json`, `workers/browser/uv.lock`. Source and release research:
[RESEARCH_AND_COMPATIBILITY.md](RESEARCH_AND_COMPATIBILITY.md).

## 5. Integration paths

| Integration | Path | Status | Evidence |
| --- | --- | --- | --- |
| PostgreSQL | `pg` pool, migrations, row locks | **Verified** | Live suite on 18.3: concurrent migrate, competing claims, reconnect after `pg_terminate_backend`; benchmark |
| n8n → Core | Scoped webhook, status read | **Verified** | n8n 2.43.7 roundtrip: 202, polling, BLOCKED (OpenClaw absent at the time), safe stop branch |
| Core → n8n | Registered published webhook | **Verified** | HIGH approval, COMPLETED with n8n execution ID; `taskId` replay returned empty body without re-execution; wrong token 403 |
| n8n API client | `X-N8N-API-KEY` discovery (≤5×50 pages) and `waitExecution` | Not live-verified | Contract tests only; needs an owner API key |
| Browser Use | Python worker, Actor DOM readback (1–4 allowlisted URLs) | **Verified** (native) / Not live-verified (container) | Real ephemeral Chromium read example.com; multi-page contract tests; container needs egress attestation |
| OpenClaw | OpenResponses `POST /v1/responses`, plan-scoped `user` | **Verified (native)** | 2026.10.4 Gateway, ChatGPT OAuth via `@openclaw/codex`, denial probes, approved task COMPLETED, stopped Gateway FAILED not dispatched; tools remain denied |
| Claude | Messages SDK | Not live-verified, **Blocked** | No API key; 529 to Gemini fallback tested end to end against fixtures |
| Gemini | GenAI SDK | **Verified** | Operator free-tier key; `gemini-3.5-flash` task COMPLETED |
| Claude Code | Official CLI, subscription | **Verified** | Subscription login; Core tasks COMPLETED. Earlier organization 403 did not recur |
| Codex | Codex SDK, ChatGPT login in isolated home | **Verified (native)** | HIGH approval then COMPLETED; host-read isolation remains a documented residual |

### Subscription follow-up evidence, first run (2026-10-17)

Superseded where the resumed-session table below differs.

| Gate | Evidence / result |
| --- | --- |
| Runtime | Existing portable Node 24.22.0 ZIP freshly matched official SHA256; system MSI execution denied, system Node unchanged |
| Claude Code (superseded) | CLI 2.1.281, `sonnet`; task `c32a62e3-0288-46da-87e3-bceaae52f3c9` FAILED in 4.4 s. Probe returned 403 `oauth_not_allowed_for_organization`; provider disabled pending entitlement |
| Codex | `gpt-5.6-sol`, task `3d7c1035-c08f-437f-9cdc-c7c6d76bb1b4` COMPLETED. Durable `approval.requested`, `approval.granted`, `action.intended`, `verification.succeeded`; no API key supplied |
| OpenClaw (superseded) | CLI 2026.10.4, config validates loopback/token/Responses and global + agent deny `*`; URL file/image fetching disabled. Startup fails on SQLite state ownership; read-only doctor reproduces offline-maintenance errors in temporary state. Browser login completed by operator, CLI failed before confirmation |
| OpenClaw live gates (superseded) | Authenticated models endpoint, adversarial denial, session-log inspection, successful Core task and stopped-Gateway live task remain unverified. `ENABLE_OPENCLAW=false`, `OPENCLAW_POLICY_VERIFIED=false` |
| Gemini (superseded) | Blocked: operator key absent; left disabled |

Evidence files under ignored `artifacts/subscription-setup/` contain live task/events/actions,
official checksums, installation logs, Gateway startup and read-only doctor diagnostics.
No OAuth credential file was read. Native Codex still saw machine-wide skill guidance;
read-only and isolated home are not claimed to prevent host reads. Claude Code's live
instruction-isolation gate passed after the git/CLAUDE.md fix below.

### Live verification, resumed session (2026-10-17)

| Gate | Evidence / result |
| --- | --- |
| Claude Code | Task `fbb9d854-778d-4ce2-8bfe-d67cc9599cda` COMPLETED but exposed the repo's git status (workdir sits inside the repo). Fix: `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (RED then GREEN). Re-run `8ccf23f2-2c8c-44d5-b80e-ee21f38900bc` COMPLETED in 17.9 s; asked to echo its context, it reported no git, hook, CLAUDE.md, caveman or Ponytail text. Claude Code's built-in prompt still carries the account e-mail and an environment block |
| Gemini | `gemini-3.5-flash` from the live model list; task `b15c9496-5215-4c4a-a0fe-78ffd64f15c6` COMPLETED |
| OpenClaw login | Default login always fails on Windows ("Codex credential reader could not stop": transport close is never reported closed on win32). `--profile-id openai:default` skips the import; operator browser OAuth completed |
| OpenClaw denial | Codex harness exposes code-mode `exec`/`wait` despite deny-all; `exec` was observed as a V8 isolate with an empty nested `tools` object and no `fetch`/`require`. No leak of a random canary in 2 rounds of shell, file and web probes plus explicit `exec`/`wait` probes. Gateway log showed only agent runs ending `stopReason=stop`; Codex session rollouts showed no calls beyond the probed `exec`/`wait`. Codex sandbox set `read-only` (default `danger-full-access`) |
| OpenClaw tasks | `fba47b23-fda4-4722-8aa2-c6a8b07b95ae` approval → COMPLETED in 23 s. Gateway stopped: `5fb70817-3799-4910-a497-37dc2a2ad14f` FAILED `provider-unavailable`, no RECOVERY_REQUIRED |

## 6. Local Windows installation

See [README.md](../README.md#windows-quick-start): `npm ci --ignore-scripts`,
`scripts/bootstrap.ps1` (random secrets in `.env`), `docker compose up -d --build`. Verified on
this host, including the non-default PostgreSQL host port needed when a native Windows
PostgreSQL holds 5432.

## 7. Startup and shutdown

| Action | Command | Verified |
| --- | --- | --- |
| Start | `docker compose up -d --build` | Yes |
| Add n8n | `docker compose --profile automations up -d` | Yes |
| Host access to PostgreSQL | `docker compose -f compose.yaml -f compose.dev.yaml up -d postgres` | Yes |
| Stop (drain) | `docker compose stop` | Yes: SIGTERM, exit 0 in about 1 s with no in-flight work |
| Keep data | `docker compose down` (never `down -v`) | Yes |

## 8. Environment variables

Listed in [README.md](../README.md#configuration) and `.env.example`. Core refuses to start
with copied `REPLACE_` placeholders or a non-local `DATABASE_URL` (tested; startup reports the
failing setting without its value).

## 9. Test commands

`npm run check`, `npm run test:postgres`, `npm audit --audit-level=high`, the `uv run` ruff,
mypy and unittest commands for the worker, `npm run benchmark`. CI runs the same set
(`.github/workflows/ci.yml`); CI itself was not run because nothing was pushed.

## 10. Test results and evidence

| Gate | Result |
| --- | --- |
| Type check, Biome lint, build | Pass |
| Vitest | 94 passed, 1 skipped (the opt-in live PostgreSQL suite); 15 Claude Code, 13 subscription config and 1 OpenClaw launcher tests |
| Live PostgreSQL 18.3 suite | Pass |
| `npm audit` | 0 vulnerabilities |
| Python ruff, mypy, unittest | Pass, 7 tests |
| `docker compose config` | Valid |
| Live Docker run | healthz, readyz, CLI submit/list/get/events/cancel, idempotent resubmit, restart persistence, 401 without auth, metrics |
| Network segmentation | n8n cannot resolve `postgres`; connection by IP times out with PostgreSQL unpublished |

Test areas: state machine and property tests (fast-check), DAG cycles, competing claims, stale
fences, exact approval mutation and reuse, expiry, restart recovery, idempotent ingress,
cancellation races, dispatch classification, circuit breaker, heartbeat retry, drain, quotas,
schema drift, cross-language browser contract, secret redaction, path traversal and junctions,
unauthorized and replayed requests, local end-to-end flows with fallback.

## 11. Security controls

Bearer authentication with constant-time comparison on every route except `/healthz`;
separate n8n ingress token restricted to one task shape; loopback-only publication; segmented
Compose networks with PostgreSQL unpublished; Core container read-only, non-root, all
capabilities dropped, `no-new-privileges`, resource limits; secret references and known-secret
redaction; no request or exception bodies in logs; strict Zod boundaries and size caps; exact
approvals bound to parameter hashes; HIGH risk floors for agentic providers; placeholder
secrets rejected at startup; exact npm and uv locks with install scripts disabled. Full table:
[THREAT_MODEL.md](THREAT_MODEL.md).

## 12. Failure recovery

Durable intent before I/O; quarantine to RECOVERY_REQUIRED for uncertain outcomes; lease
expiry recovery; fenced commits; bounded fallback only after provably safe failures; circuit
breaker; heartbeat retry; graceful drain; transaction rollback with broken-connection
eviction; operator reconciliation with redacted evidence. Procedures:
[RECOVERY_RUNBOOK.md](RECOVERY_RUNBOOK.md).

## 13. Known risks and limitations

- One trusted operator; the operator principal is a fixed literal. No multi-tenancy.
- The circuit breaker and routing measurements are per process; since the follow-up they are
  rebuilt from `provider_observations` at startup instead of resetting.
- Browser 400/429 and n8n timeouts are treated as uncertain and need operator review.
- The Core-to-n8n result text comes from the workflow itself; it proves invocation, not an
  external business outcome.
- n8n retries that re-evaluate `$now` conflict and fail closed.
- A shutdown abort before intent leaves the task BLOCKED; the operator resumes it.
- Docker 28+ accepts loopback-published ports (Core, n8n) from every Compose network.
- The default database role is privileged; separate migration and runtime roles are pending.
- Attestation flags record operator claims; they do not create isolation.
- No money-denominated cost cap for model calls; `PROVIDER_BUDGETS_JSON` caps daily calls or
  provider-reported tokens per provider.
- Claude Code and Codex do not enforce the task output-token cap; readiness explicitly
  reports `outputTokenLimitEnforced: false`. Byte bounds/deadlines do not cap quota usage.

## 14. Unverified external dependencies

Claude API (no API key by design), the n8n public API key path, the
browser-worker container with egress controls, and Gemini CLI harness (not implemented).
OpenClaw, Claude Code and Gemini are live-verified on native Windows only; Core in Compose
cannot reach the loopback Gateway or the subscription CLIs.

## 15. Performance baseline

`npm run benchmark`: 100 full lifecycles (admit, claim, intent, execute, verify, complete) with
a deterministic fixture executor, then 20 claims with 500 blocked tasks queued.

| Database | Lifecycle p50 / p95 | Claim with 500 blocked p50 / p95 | RSS |
| --- | --- | --- | --- |
| PGlite in memory | 12.0 / 14.3 ms | 10.9 / 12.6 ms | 799 MiB |
| PostgreSQL 18.3 (Docker, loopback) | 34.1 / 37.5 ms | 8.3 / 10.6 ms | 170 MiB |

These numbers measure Core overhead only, not provider latency.

## 16. Extension points

New providers implement `Executor` and register in `src/config.ts`; new capabilities extend
`CapabilitySchema` and policy floors; new verification kinds extend the verification schema;
event consumers read the ordered event stream; published JSON Schemas let other languages
integrate; n8n workflows are added by registering webhook URLs.

## 17. Next milestones

1. Re-run the OpenClaw denial probes after every OpenClaw or Codex plugin upgrade.
2. Re-run the live intent eval and the voice desktop scenarios on the operator's laptop with the
   follow-up changes (JSON mode, `claude-live`, spoken stop and choice, memory).
3. Browser-worker container with an enforced egress proxy, then live failure injection.
4. Separate PostgreSQL migration and runtime roles; backup and restore drill.
5. Money-denominated budgets from per-model prices, on top of the token budgets.
6. Authoritative read-after-write verifiers for each side-effecting integration.

Done since the first report: free-model routing (OpenRouter, NVIDIA) and the voice interface;
model-proposed plans converted to typed tasks by deterministic policy (ADR 0010); measured
adaptive routing with durable circuits and usage budgets (ADR 0011).

## Follow-up, 2026-10-18 (branch `feature/jarvis-latest-v2`)

Debug first: the merge `9b2d101` had left conflict markers in
`packages/action-engine/src/guards.ts` and `packages/integration-hub/src/index.ts`, so type
check, lint and build failed. `containedPath` now keeps both sides (lexical root check before
any filesystem call, real-path check for junctions, the caller's spelling returned for Windows
8.3 aliases).

| Change | Evidence | Class |
| --- | --- | --- |
| Measured adaptive routing, durable circuits, daily budgets ([ADR 0011](ADR/0011-measured-adaptive-routing.md)) | `tests/reliability.test.ts` (Wilson bound, window, demotion, latency, budgets, restart replay, gateway observations, worker explanation) | tested only |
| Claude adapter: stop reasons, effort, refusal fallback, served model, token usage, `claude-live` | `tests/model-contracts.test.ts`, `tests/gemini-live.test.ts` against local fixture servers | tested only; Claude Messages API still not live-verified |
| Native JSON mode for turns, repairs and replans | Gemini and OpenAI-compatible request contract tests | tested only |
| Spoken stop and candidate choice without a model call | engine parser tests, `tests/conversation-intent.test.ts` | tested only |
| Event-driven task coordination | `tests/worker-wake.test.ts` (commit-only, rollback, listener isolation, sub-poll latency) | tested only |
| Replan screen summary, Windows-MCP pre-warm, self-healing restarts | snapshot and MCP stdio tests | tested only |
| Screen text discarded after use | `tests/plans.test.ts` | tested only |
| Operator-approved long-term memory ([ADR 0012](ADR/0012-operator-approved-memory.md)) | `tests/memory.test.ts`, guard and catalog tests | tested only |
| n8n outcome push through a transactional outbox ([ADR 0013](ADR/0013-n8n-outcome-outbox.md)) | `tests/outbox.test.ts` against a local HTTP receiver | tested only; example workflow not live-verified |
| Voice client returns an apology for malformed Core replies | `workers/voice/tests/test_core_client.py` | tested only |

Gates on the cloud host (Node 22.22, so outside the declared engine range; CI pins 24.22.0):
type check, Biome lint (8 existing CSS warnings), Vitest, build, contract drift, desktop type
check, browser worker unittest/ruff, voice `test_core_client` with ruff and mypy. The full voice
suite needs the CUDA torch wheels, which this host could not download.

## §21 acceptance matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| One authoritative owner per responsibility | Verified | Matrix above; ADR 0001 |
| No conflicting orchestration loops | Verified | One PostgreSQL scheduler; n8n queue mode off |
| Boundaries documented and enforced in code | Verified | Strict schemas, risk floors, scoped ingress tests |
| Stable provider interface | Verified | `Executor` with seven adapters |
| Valid persistent transitions | Verified | Transition table plus property tests |
| No double claims | Verified | Competing-claim tests on PGlite and live PostgreSQL |
| Unauthorized actions denied | Verified | Capability, privacy, approval and auth tests |
| Explainable provider selection | Verified | `provider.selected` event with reason; deterministic order |
| Bounded failure recovery | Verified | Call budget, deadline, quarantine, circuit breaker tests |
| Defined cancellation | Verified | Cancel race and RECOVERY_REQUIRED 409 tests |
| Side-effect idempotency or reconciliation | Verified | Durable intent, reconciliation tests; n8n dedup live |
| OpenClaw genuinely integrated | Verified (native) | Live Gateway, denial probes, approved task COMPLETED, stopped Gateway classified not dispatched |
| Browser Use genuinely integrated | Verified (native) | Live DOM readback; container pending |
| n8n genuinely integrated | Verified | Both directions live on 2.43.7 |
| Claude, Codex, Gemini execution paths tested | Verified | Codex, Claude Code and Gemini live COMPLETED; Claude Messages API path tested with fixtures only |
| Provider limitations explicit | Verified | Registry fields, attestation flags, this report |
| Unsupported capabilities rejected | Verified | `NO_COMPATIBLE_PROVIDER`, `policy-denied` tests |
| No hardcoded production credentials | Verified | Placeholder rejection; `.env` ignored |
| No unauthenticated privileged endpoints | Verified | Auth tests; live 401 |
| No unrestricted agent escalation | Verified | HIGH floors and exact approvals |
| No credentials in logs | Verified | Redaction tests |
| Approval enforced in code | Verified | Gateway tests |
| Untrusted content cannot override policy | Verified | Models have no tools; strict output schema |
| Build, lint, typing, tests, contracts | Verified | Gate table above |
| Relevant integration tests | Partial | Live for PostgreSQL, n8n, Browser Use, Codex, Claude Code, Gemini and OpenClaw; Claude Messages API and n8n API client not live |
| Known limitations documented | Verified | Section 13, threat model |
| Reproducible local startup | Verified | Docker run on this host |

## §23 review

An independent subagent review (fresh context, no session history) examined the code
after the hardening work. It found 12 issues, including a reproducible stranded-task state.
All high and medium findings were fixed with regression tests in `tests/review-fixes.test.ts`
and `tests/hardening.test.ts`. Live runs during documentation found two more issues: PostgreSQL's published port was
reachable from the n8n network, and native startup would use an inherited remote
`DATABASE_URL`. Both are fixed and verified.

| Perspective | Findings and resolution | Residual |
| --- | --- | --- |
| Principal architect | Docs claimed one action per task; corrected to one per provider attempt. Event families mapped to §11 | Model-proposed planning absent by design |
| Distributed systems | Stranded task when cancel raced an executing action; heartbeat aborted on transient errors; no drain on shutdown; claim made N+2 queries under the lock. All fixed | Single global lock; per-process circuits |
| Application security | Agentic providers could run at LOW risk; unknown workflows reached the network; prototype keys in workflow lookup; stale approvals survived new actions; PostgreSQL reachable across networks. All fixed | Published ports reachable across Docker networks; shared ingress token |
| Agent reliability | Unverified side-effect output marked FAILED and resubmittable; aborted retry-safe calls retried. Fixed: quarantine | Webhook result text is self-reported |
| Performance | Batched claim queries; benchmark added | No multi-host load test |
| Windows deployment | Port 5432 conflict with native PostgreSQL; CRLF in Python edits; Luxon offset timestamps rejected; an inherited shell `DATABASE_URL` (a remote Supabase pooler on this host) silently took precedence over `.env`. All fixed: Core now refuses non-local databases and names the failing setting | Docker Desktop required |
| Maintainability | Closed event enum; contract drift test; cross-language browser fixture | `src/tasks.ts` is 421 lines; split when it grows |

Self-review is not proof of correctness; the executable tests and live runs above are the
evidence.

### Subscription follow-up review

A fresh-context read-only review of the changes since `bcbe124` found one Important
issue: the Claude CLI cannot enforce the task's requested output-token ceiling. The
required CLI/environment contract exposes no supported token-cap flag. Readiness now
reports `outputTokenLimitEnforced: false` for Claude Code and Codex, and integration docs
state the quota limitation. Two readiness assertions failed before the change and passed
after it; the full 92-test suite, type check, lint and build passed. No minor findings.
External live gates remain pending as listed above; review does not establish connectivity.
