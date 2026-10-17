# JARVIS Core architecture

Status: initial backend foundation. The master directive is the target, not a claim of completion.
Single trusted local operator; never expose these services to the public internet.

| Component | Authoritative responsibility |
| --- | --- |
| Core task service | Admission, DAG, state transitions, deadlines, leases, cancellation, recovery |
| Action gateway | Exact typed action, permissions, approval, call budget, durable intent, verification |
| PostgreSQL | Tasks, dependencies, single-use approvals, actions, ordered durable events |
| Provider registry | Versioned capabilities, deterministic routing and bounded safe fallback |
| OpenClaw | Delegated agent runtime; HTTP Responses integration; no Core policy ownership |
| Browser Use worker | Isolated deterministic public-page extraction using official Actor API |
| n8n | External triggers and schedules; registered webhook workflows, execution records |
| Claude/Gemini SDKs | Text proposals without tools; API credentials distinct from CLI subscriptions |
| Codex SDK | Explicit opt-in sandboxed analysis; no second OpenClaw-owned session |

Core is a modular monolith with a separate Python browser boundary. A single PostgreSQL
queue avoids two independent global schedulers; Redis is unnecessary at this scale.
Workers acquire fenced leases transactionally. A global scheduler row serializes admission,
claims, dependency changes and recovery; expected laptop concurrency is small. Scale only
after measuring contention. External I/O never occurs inside a database transaction.

Each task executes one declared action. DAG dependencies compose larger jobs. Models do
not generate executable plans in this release; operators submit typed plans. This is a
deliberate authority boundary, not an autonomous planning implementation.

Before I/O, persist an action intent and consume any approval in one transaction. A crash
after intent leaves an uncertain action: recovery never replays it. A lease fence prevents
late workers from committing. Completion requires deterministic declared evidence checks;
model text matching is only evidence of an output contract, never external truth.

Cancellation aborts local requests and fences commits. For workflows and remote agent runs,
transport abortion is not proof of remote cancellation: record RECOVERY_REQUIRED.
Reconciliation requires an operator's exact action identifier, outcome and evidence.

No arbitrary shell, account creation, messages, payments, credential onboarding, repository
promotion, shared browser profiles, multi-tenancy or general browser agents are enabled.
Those need independently verified enforcement before extension.
