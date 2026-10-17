# JARVIS Core

Local-first backend authority for a personal autonomous agent platform. JARVIS Core alone
owns global task state, policy, approvals, durable execution, recovery and final
verification. OpenClaw, Browser Use, n8n, Claude, Codex and Gemini are integrated behind
typed adapters and never bypass that authority.

> Models propose. Policies authorize. Executors act. Evidence verifies. The core records
> the authoritative result.

Status: first foundation release for **one trusted local operator**. It is not a
multi-tenant system and makes no production-readiness claim. See
[docs/ENGINEERING_REPORT.md](docs/ENGINEERING_REPORT.md) for verified evidence and
open gates. No frontend is included by design.

## Layout

| Path | Purpose |
| --- | --- |
| `src/contracts.ts` | Task state machine, schemas, event families, canonical hashing |
| `src/tasks.ts` | Task service: admission, DAG, leases, cancel, recover, approve, reconcile |
| `src/gateway.ts` | Action gateway: risk floor, exact approval, durable intent, verification |
| `src/routing.ts` | Versioned provider registry, deterministic routing, circuit breaker |
| `src/worker.ts` | Lease-holding worker loop with heartbeat and graceful drain |
| `src/server.ts`, `src/cli.ts` | Authenticated loopback HTTP control API and developer CLI |
| `src/context.ts` | Bounded, redacted, expiring task context with provenance |
| `src/database.ts` | PostgreSQL pool, transactions, append-only migrations |
| `src/integrations/` | Claude, Gemini, Codex, OpenClaw, Browser Use and n8n adapters |
| `src/security.ts`, `src/telemetry.ts` | Secret references/redaction, path containment, tracing |
| `workers/browser/` | Isolated Python Browser Use worker (fixed DOM readback only) |
| `schemas/` | Published JSON Schemas generated from the runtime contracts |
| `examples/n8n/` | n8n workflows for both directions of the integration |
| `docs/` | Architecture, ADRs, threat model, runbook, research, engineering report |

## Windows quick start

Prerequisites: Node.js 24.11+ (24.22.0 tested), Docker Desktop with WSL2, Python 3.12
and `uv` 0.11 (only for the browser worker).

```powershell
npm ci --ignore-scripts
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1   # creates .env with random secrets
docker compose up -d --build                                       # PostgreSQL + Core on 127.0.0.1
npm run cli -- ready
```

Optional services: `docker compose --profile automations up -d` (n8n on
`127.0.0.1:5678`); the `browser` profile stays disabled until egress controls are
verified (see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)). Every provider starts
disabled; enable each one explicitly in `.env`.

PostgreSQL is not published to the host by default. For native Core, the live PostgreSQL
suite or benchmarks, publish it on `127.0.0.1:55432` (override with `POSTGRES_HOST_PORT`):
`docker compose -f compose.yaml -f compose.dev.yaml up -d postgres`, then `npm run build`
and `npm start`. Do not run the n8n or browser profiles in that mode with valued data: a
published port is reachable from the other Compose networks.

`node --env-file=.env` never overrides a variable already set in your shell. Core refuses a
`DATABASE_URL` that is not this host or the Compose `postgres` service, so an inherited value
for another project fails startup instead of being migrated. Clear it with
`Remove-Item Env:DATABASE_URL` for the session.

Shutdown: `docker compose stop` (Core drains in-flight actions for up to 20 s, then exits).
`docker compose down` keeps data volumes. Never use `down -v` on valued data.

## Developer commands

| Command | What it runs |
| --- | --- |
| `npm run check` | Type check, Biome lint, Vitest suite, build |
| `npm test` | Unit, property, contract, security, resilience and local E2E tests |
| `npm run test:postgres` | Opt-in real PostgreSQL suite (`JARVIS_LIVE_POSTGRES_TEST=true`, `TEST_DATABASE_URL`) |
| `npm run benchmark` | Lifecycle and scheduler baseline (`BENCHMARK_DATABASE_URL` for PostgreSQL) |
| `npm run contracts` | Regenerate `schemas/*.schema.json` (a test fails if they drift) |
| `uv run --project workers/browser --locked python -m unittest discover -s workers/browser` | Python worker tests |

## Control API

All endpoints except `/healthz` require `Authorization: Bearer <JARVIS_TOKEN>`; the n8n
endpoints require the separate `N8N_INGRESS_TOKEN` and cannot reach operator routes.

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | Process liveness |
| `GET /readyz` | Database readiness, provider registry and circuit state |
| `GET /v1/metrics` | Task states, action outcomes, durations, retries, process usage |
| `POST /v1/tasks` | Admit a typed task (`Idempotency-Key` header required) |
| `GET /v1/tasks?status=&before=&limit=` | Task summaries, newest first |
| `GET /v1/tasks/:id`, `/events`, `/actions` | Task, ordered event envelopes, action records |
| `POST /v1/tasks/:id/cancel`, `/resume`, `/dependencies` | Cancel, resume a BLOCKED task, add a DAG edge |
| `POST /v1/actions/:id/approve`, `/reject`, `/reconcile` | Exact approval, denial, operator reconciliation |
| `POST /v1/hooks/n8n`, `GET /v1/hooks/n8n/tasks/:id` | Scoped n8n ingress and result read |

Task, result and event envelope contracts are published in `schemas/`.

## Configuration

`.env.example` lists every variable. Core refuses to start with copied placeholders.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT` | PostgreSQL connection (loopback or `postgres` only) and `compose.dev.yaml` host port (default 55432) |
| `JARVIS_TOKEN`, `N8N_INGRESS_TOKEN` | Distinct operator and n8n ingress credentials (32+ chars) |
| `PORT` | Core HTTP port (loopback only), default 2160 |
| `WORKER_CONCURRENCY`, `MODEL_CONCURRENCY`, `BROWSER_CONCURRENCY`, `WORKFLOW_CONCURRENCY` | Backpressure limits |
| `ENABLE_CLAUDE`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude Messages API adapter |
| `ENABLE_GEMINI`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini API adapter |
| `ENABLE_OPENCLAW`, `OPENCLAW_URL`, `OPENCLAW_AGENT_ID`, `OPENCLAW_TOKEN`, `OPENCLAW_POLICY_VERIFIED` | OpenClaw OpenResponses adapter |
| `ENABLE_BROWSER`, `BROWSER_WORKER_URL`, `BROWSER_WORKER_TOKEN`, `BROWSER_EGRESS_VERIFIED`, `BROWSER_ALLOWED_URLS` | Browser Use worker |
| `ENABLE_N8N`, `N8N_WORKFLOWS_JSON` (+ referenced token variables), `N8N_ENCRYPTION_KEY` | Core-invoked n8n workflows |
| `ENABLE_CODEX`, `OPENAI_API_KEY`, `CODEX_MODEL`, `CODEX_ISOLATION_VERIFIED`, `CODEX_WORKSPACE`, `CODEX_ISOLATED_HOME` | Codex SDK adapter (isolated host only) |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) and [ADRs](docs/ADR/)
- [Integrations](docs/INTEGRATIONS.md) and [research and compatibility](docs/RESEARCH_AND_COMPATIBILITY.md)
- [Threat model](docs/THREAT_MODEL.md) and [recovery runbook](docs/RECOVERY_RUNBOOK.md)
- [Engineering report](docs/ENGINEERING_REPORT.md): evidence, limitations, next milestones
- [Master directive](docs/MASTER_DIRECTIVE.md): the requirements this project implements
