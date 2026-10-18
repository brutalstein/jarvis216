# JARVIS Core architecture

Status: initial backend foundation. The master directive is the target, not a claim of completion.
Single trusted local operator; never expose these services to the public internet.
Decision records live in [ADR/](ADR/); evidence is in [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md).

| Component | Authoritative responsibility |
| --- | --- |
| Core task service | Admission, DAG, state transitions, deadlines, leases, cancellation, recovery |
| Action gateway | Exact typed action, permissions, risk, approval, call budget, durable intent, verification |
| PostgreSQL | Tasks, dependencies, single-use approvals, actions, ordered durable events |
| Provider registry | Versioned capabilities, measured adaptive routing ([ADR 0011](ADR/0011-measured-adaptive-routing.md)), durable circuit state, usage budgets, bounded safe fallback |
| OpenClaw | Delegated agent runtime; OpenResponses HTTP integration; no Core policy ownership |
| Browser Use worker | Isolated deterministic public-page extraction using official Actor API |
| n8n | External triggers and schedules; registered webhook workflows, execution records |
| Claude/Gemini SDKs | Text proposals without tools; API credentials distinct from CLI subscriptions |
| Codex SDK | Explicit opt-in sandboxed analysis; no second OpenClaw-owned session |
| Conversation service | Core-owned persona, bounded provider fallbacks, addressed turns, transcript export/deletion and retention |
| Local voice service | Loopback WebRTC, semantic end-of-turn, local speaker gate/STT/TTS; no action or approval authority |
| Electron desktop | Sandboxed presence, captions, cards, tray/overlay and settings; Core token stays in main |
| Action engine (`packages/action-engine`) | Intent parsing, typed action catalog, compiler, guards, grounding, Windows-MCP bindings, news fetch, narration; imports nothing from Core |
| Integration hub (`packages/integration-hub`) | Typed recipes that turn HIGH integration actions into Core tasks for Browser Use, n8n and OpenClaw |
| Plan service | Model-proposed plans: compile, hash, approval card, one task per step, finishers, replan, voice cancel |
| Windows-MCP | Desktop tools over MCP stdio, child of Core, allowlisted tools only, telemetry off; pre-warmed at boot, restarts age out of a 10-minute crash window |
| Memory store | Operator-approved long-term notes ([ADR 0012](ADR/0012-operator-approved-memory.md)); written only by approved `memory.save` / `memory.forget` steps |
| Outbox | Transactional queue of n8n task outcomes, delivered at least once to a registered webhook ([ADR 0013](ADR/0013-n8n-outcome-outbox.md)) |

Core is a modular monolith with a separate Python browser boundary. A single PostgreSQL
queue avoids two independent global schedulers; Redis is unnecessary at this scale.
Workers acquire fenced leases transactionally. A global scheduler row serializes admission,
claims, dependency changes and recovery; expected laptop concurrency is small. Scale only
after measuring contention (see the benchmark in the engineering report). External I/O
never occurs inside a database transaction.

Each task declares one objective, capability and provider allowlist. Each provider attempt
records one action; a fallback attempt is a new action for a different provider, bounded by
`budget.maxCalls` (1–5, default 2) and the total deadline. DAG dependencies compose larger
jobs. Operators can submit typed plans. Since M3 a model may also propose a plan, but only as
catalog actions: the engine compiles and validates every step, the risk comes from the catalog,
and the operator approves the plan hash before any MEDIUM step runs
([ADR 0010](ADR/0010-model-proposed-typed-plans.md)). There is no free agent loop.

## Model-proposed plans (M3)

```
voice turn ─► ConversationService ─┬─ bare stop / ordinal ─► cancel plan / choose candidate (no model)
                                   └─ one JSON-mode model call ─► intent: reply | clarify | plan | cancel
plan ─► engine.compile (catalog Zod schemas) ─► plans row (hash) ─► one task per step (chain)
  ├─ desktop.act   ─► DesktopExecutor ─► guards ─► grounding ─► Windows-MCP ─► postcondition
  ├─ info.fetch    ─► NewsExecutor    ─► RSS over HTTPS ─► news panel
  ├─ memory.write  ─► MemoryExecutor  ─► secret guard ─► memories table ─► read back
  └─ integration   ─► IntegrationHub  ─► browser.extract / workflow.invoke / agent.delegate
GET /v1/stream (SSE) ─► desktop main ─► renderer cards and panels; announcements ─► voice TTS
```

- LOW-only plans run at once. A plan with a MEDIUM step waits for one tap bound to its hash,
  valid for two minutes (`POST /v1/plans/:id/approve`). HIGH integration steps also need their
  own exact approval. Voice can cancel a plan, never approve one.
- One desktop or integration plan runs at a time; a new one cancels the previous one.
- The model's spoken text is discarded for plans; JARVIS speaks templates and Core outcomes.
- Screen text reaches only trusted-private providers (Claude Code), for `screen.describe` and
  for one replan after an observed failure (window and element names from a fresh Snapshot,
  never field values). A replanned plan is compiled and approved again. Once used, the screen
  text is replaced by a marker in every task and action record.
- A bare spoken stop ("dur", "iptal", "stop") cancels the active plan without a model call. A
  bare ordinal ("ikincisi", "the second one") picks one of the candidates the newest plan
  stopped on: a clarification, never an approval; outside the plan's approval window the
  continued plan asks for a new tap. Anything with extra words goes to the model.
- Conversation turns, repairs and replans request native JSON mode where the provider has one
  (Gemini, OpenRouter). Memory notes, when enabled, enter the prompt as data.

## Risk and approval

Effective risk is the maximum of the declared risk, the executor's floor and the policy
floor. OpenClaw, Codex and n8n executors have a HIGH floor because they can cause side
effects Core cannot observe. `workflow.invoke`, and an external provider on a private task
unless explicitly trusted by `JARVIS_PRIVATE_PROVIDERS`, are HIGH by policy. The `personal`
class records standing consent for non-sensitive personal context; it adds no risk floor.
HIGH requires an exact approval: single use, bound to the action's
parameter and configuration hash, and expiring; CRITICAL is treated the same way. A new action
supersedes any earlier action still awaiting approval, so an old approval cannot be reused.
MEDIUM needs either its own exact approval or membership in an approved, running plan whose
compiled step matches the action's input and risk, within two minutes of the plan approval.
Such a step emits `approval.granted` with `via: "plan"` and consumes no approval row.

## Execution and failure classification

Before I/O, Core persists an action intent and consumes any approval in one transaction.
A failure is retry-safe only if Core can show nothing happened externally: the provider was
never reached (connection refused, DNS failure, HTTP 401/403) or the executor is declared
retry-safe and the request was not aborted. Retry-safe failures may fall back to another
allowed provider with bounded backoff and jitter. Every other failure, and any unverified
output from a side-effecting executor, quarantines the task in RECOVERY_REQUIRED with the
action UNCERTAIN. Recovery never replays it. A lease fence prevents late workers from
committing. Completion requires deterministic declared evidence checks; model text matching
is only evidence of an output contract, never external truth. An executor that observes its
own outcome (`outcomeObservable`, e.g. the desktop executor's postconditions) moves an unmet
result to FAILED instead of RECOVERY_REQUIRED, because the state was seen.

Each provider has a circuit breaker: three outage-class failures (transient, rate limited,
unavailable) open it for 60 seconds; a success closes it; after the cooldown one further outage
reopens it. Routing skips open circuits and `/readyz` reports them.

Every attempt is also recorded in `provider_observations` with the outcome's transaction. Policy
filters still decide who may run; measurements only reorder the eligible: a provider that fails
more often than not with statistical confidence (95% Wilson upper bound below 0.5, at least 8
attempts) or whose p90 latency exceeds the time left moves behind the others but stays a last
resort. Ties fall back to the base order and the id, and `provider.selected` records the
statistics used. Startup replays the last day, so health, usage budgets
(`PROVIDER_BUDGETS_JSON`) and open circuits survive restarts.

## Event-driven coordination

`TaskService` emits a change per moved task after its transaction commits (never on rollback;
each listener is isolated). Text turns, plan waits, the plan refresher, the outbox and idle
workers react at once; the previous polls stay as a safety net with longer intervals. A worker
that ran a task claims again immediately, so chained plan steps do not wait for a poll.

Workers hold 30-second leases renewed every 10 seconds. A failed renewal is retried while
the lease is still valid; only a lost or expiring lease aborts the action. On shutdown a
worker stops claiming, waits up to 20 seconds for in-flight actions, then aborts them.

Cancellation aborts local requests and fences commits. For workflows and remote agent runs,
transport abortion is not proof of remote cancellation: record RECOVERY_REQUIRED.
Reconciliation requires an operator's exact action identifier, outcome and evidence.

## Event families

Events are durable, ordered per task, and carry the directive's envelope fields; each
event's causation identifier is the previous event's message identifier. Directive §11
families map to the closed `EventTypeSchema` as follows.

| Directive family | Core event |
| --- | --- |
| Task requested / accepted | `task.transition` from CREATED (admission is idempotent per key) |
| Task rejected | Synchronous HTTP error; no task is created |
| Plan proposed | `plans` row and SSE plan state; each step's tasks emit the families below |
| Action proposed | `provider.selected` |
| Action authorized / execution started | `action.intended` (recorded before dispatch) |
| Action denied, approval rejected | `approval.rejected`; policy denials block the task via `task.transition` |
| Execution progress | Not emitted; liveness is the lease heartbeat |
| Execution completed / verification succeeded | `verification.succeeded`, then `task.transition` to COMPLETED |
| Execution failed / verification failed | `execution.failed`, `verification.failed` |
| Approval requested / granted | `approval.requested`, `approval.granted` |
| Cancellation requested | `cancellation.requested` |
| Recovery required | `task.transition` to RECOVERY_REQUIRED; resolution is `action.reconciled` |

Context additions emit `context.added`.

## Not enabled

No arbitrary shell, account creation, messages, payments, credential onboarding, repository
promotion, shared browser profiles, multi-tenancy or general browser agents are enabled.
Those need independently verified enforcement before extension.
