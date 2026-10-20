# JARVIS Core

Local-first backend authority for a personal autonomous agent platform. JARVIS Core alone
owns global task state, policy, approvals, durable execution, recovery and final
verification. OpenClaw, Browser Use, n8n, Claude, Codex and Gemini are integrated behind
typed adapters and never bypass that authority.

> Models propose. Policies authorize. Executors act. Evidence verifies. The core records
> the authoritative result.

Routing learns from that record: providers measured as failing or too slow for the time left
move behind the others ([ADR 0011](docs/ADR/0011-measured-adaptive-routing.md)), circuits and
usage budgets survive restarts, and every component reacts to committed task changes instead of
polling. A learning brain turns repeated successes into skills and corrections into lessons
([ADR 0015](docs/ADR/0015-learning-brain-and-layered-intent.md)), and the operator decides in
the desktop Settings which actions a spoken command may run on its own
([ADR 0014](docs/ADR/0014-operator-standing-permissions.md)). JARVIS keeps talking while it
works: spoken turns never queue behind background work, long work is acknowledged at once with
where it looks and roughly how long, and progress is narrated between the operator's turns
([ADR 0016](docs/ADR/0016-duplex-conversation-and-live-progress.md)).

Status: first foundation release for **one trusted local operator**. It is not a
multi-tenant system and makes no production-readiness claim. See
[docs/ENGINEERING_REPORT.md](docs/ENGINEERING_REPORT.md) for verified evidence and
open gates. No frontend is included by design.

## Layout

Source modules sit in layers with one dependency direction, enforced by
`tests/architecture.test.ts`: `core` ← `integrations` ← `services` ← `http` ← `app` ← entry points.

| Path | Purpose |
| --- | --- |
| `src/core/` | Task authority: contracts and state machine, task service (admission, DAG, leases, lanes, recovery, approvals), action gateway (risk, approvals, durable intent, verification), workers, provider registry with measured routing, PostgreSQL and migrations, context, secrets, tracing |
| `src/integrations/` | Claude, Gemini, Codex, OpenClaw, Browser Use, n8n, OpenAI-compatible and desktop/news adapters |
| `src/services/plans/` | Model-proposed plans: model, view and live progress, finishers and replan, working memory, the service (admission, approval, lifecycle) |
| `src/services/` | Conversation (layered voice turns) and persona, narrator and measured durations, permissions, long-term memory, brain store, n8n outbox |
| `src/http/` | Authenticated loopback API: server (auth, rate limit, error mapping) and route modules (health, tasks, hooks, plans and the live stream, settings, conversation) |
| `src/app/` | Configuration and provider setup; `createCore()`, the composition root with ordered start and stop |
| `src/main.ts`, `src/cli.ts` | Process entry point (configuration, signals, tracing, pool) and developer CLI |
| `packages/action-engine/` | Intent parsing, typed action catalog, compiler, guards, Windows-MCP bindings, news, narration templates, eval set |
| `packages/integration-hub/` | Pure allowlisted voice-to-provider integration recipes |
| `packages/brain/` | Learning brain: experiences, skills, reinforcement, decay, recall, reflexes |
| `apps/desktop/` | Electron presence, captions, plan cards with live progress, Settings |
| `workers/voice/` | Local voice service: semantic end of turn, speaker gate, STT/TTS, duplex announcement queue |
| `workers/browser/` | Isolated Python Browser Use worker (fixed DOM readback only, NDJSON progress) |
| `tests/` | Unit and integration tests; `tests/e2e/` boots the whole Core through `createCore()` against fake services |
| `schemas/` | Published JSON Schemas generated from the runtime contracts |
| `examples/n8n/` | n8n workflows for both directions of the integration |
| `docs/` | Architecture, ADRs, threat model, runbook, research, engineering report |

## One-command Windows background startup

Use the native detached [service manager](docs/WINDOWS_SERVICE_MANAGER.md) to start
the configured PostgreSQL, OpenClaw, Browser Use and n8n services and the JARVIS Core
without keeping PowerShell tabs open. The optional desktop UI owns the voice worker.

```powershell
.\scripts\jarvis-services.ps1 -Action Start -WithDesktop
.\scripts\jarvis-services.ps1 -Action Status
.\scripts\jarvis-services.ps1 -Action Logs -Service core -Tail 50
.\scripts\jarvis-services.ps1 -Action Stop
```

This is not a Windows boot service; Docker Desktop and required dependencies must already be installed. The manager
attempts to launch Docker Desktop if the engine is not running. The manager follows .env flags, never changes them or grants
additional permissions. See the linked guide for troubleshooting and isolation limits.

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

## Native subscription mode (Windows)

Core and OpenClaw 2026.10.4 use verified Node 24.22.0. This host uses the existing portable
runtime; system Node remains 24.11.0 because automatic MSI execution was denied.

```powershell
$env:PATH = (Join-Path $PWD '.tools/node-v24.22.0-win-x64') + ';' + $env:PATH
node --version  # v24.22.0
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
docker compose stop core
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
.\scripts\openclaw-native.ps1  # gateway run in a dedicated terminal; no Scheduled Task
# Second terminal with the same PATH and cleared DATABASE_URL:
npm run build
npm start
# Third terminal:
npm run cli -- ready
```

See [INTEGRATIONS.md](docs/INTEGRATIONS.md) for official CLI logins and configuration.
Codex and OpenClaw require exact HIGH approval per task. Native read-only Codex can still
read host data. Claude Code uses the operator's subscription login; Gemini uses an operator API key in
`.env`. Credential presence does not prove entitlement.
After testing, stop native Core and the Gateway, then `docker compose up -d postgres`
to remove the temporary PostgreSQL publication. The engineering report records live evidence.

## Developer commands

| Command | What it runs |
| --- | --- |
| `npm run check` | Type check, Biome lint, Vitest suite, build |
| `npm test` | Unit, property, contract, security, resilience and local E2E tests |
| `npm run test:e2e` | Core composition-root matrix on PGlite, or disposable schemas when `E2E_DATABASE_URL` is set |
| `npm run matrix:generate` / `npm run matrix:check` | Regenerate / verify reviewable matrix inputs; see `tests/e2e/matrix/README.md` for executed and pending coverage |
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
| `GET /v1/plans/:id` | Model-proposed plan, its steps and state |
| `POST /v1/plans/:id/approve {hash}`, `/reject`, `/cancel`, `/choose` | Hash-bound plan approval, rejection, cancellation, candidate choice |
| `GET /v1/stream` | Server-sent plan states, panels and announcements |
| `POST /v1/conversation/turns`, `GET`/`DELETE /v1/conversation/turns` | Voice turn, transcript export and deletion |
| `GET /v1/memories`, `DELETE /v1/memories[/:id]` | Review and forget operator-approved memory notes |
| `GET`/`PUT /v1/permissions`, `POST /v1/permissions/preset`, `GET /v1/permissions/audit` | Operator permissions per action, levels and their audit trail |
| `GET /v1/brain`, `POST /v1/brain/consolidate`, `DELETE /v1/brain[/skills/:id]` | What JARVIS learned; consolidate now; forget |

Task, result and event envelope contracts are published in `schemas/`.

## Configuration

`.env.example` lists every variable. Core refuses to start with copied placeholders.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT` | PostgreSQL connection (loopback or `postgres` only) and `compose.dev.yaml` host port (default 55432) |
| `JARVIS_TOKEN`, `N8N_INGRESS_TOKEN` | Distinct operator and n8n ingress credentials (32+ chars) |
| `PORT` | Core HTTP port (loopback only), default 2160 |
| `WORKER_CONCURRENCY`, `MODEL_CONCURRENCY`, `BROWSER_CONCURRENCY`, `WORKFLOW_CONCURRENCY` | Background backpressure limits (`WORKER_CONCURRENCY` defaults to 2) |
| `INTERACTIVE_CONCURRENCY` | Workers reserved for spoken turns, so conversation never waits behind work (default 2) |
| `ENABLE_CLAUDE`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_REFUSAL_FALLBACK` | Claude Messages API adapter (`claude` plus low-effort `claude-live` for voice; model defaults to `claude-opus-5-5`) |
| `ENABLE_CLAUDE_CODE`, `CLAUDE_CODE_PATH`, `CLAUDE_CODE_MODEL`, `JARVIS_PRIVATE_PROVIDERS` | Claude Code subscription harness; providers trusted with private data |
| `ENABLE_OPENROUTER`, `OPENROUTER_MODELS`, `ENABLE_NVIDIA`, `NVIDIA_MODELS` (+ keys) | Free OpenAI-compatible models |
| `PROVIDER_BUDGETS_JSON` | Rolling 24 h call or token ceilings per provider id |
| `ENABLE_GEMINI`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini API adapter |
| `ENABLE_OPENCLAW`, `OPENCLAW_URL`, `OPENCLAW_AGENT_ID`, `OPENCLAW_TOKEN`, `OPENCLAW_POLICY_VERIFIED` | OpenClaw OpenResponses adapter |
| `ENABLE_BROWSER`, `BROWSER_WORKER_URL`, `BROWSER_WORKER_TOKEN`, `BROWSER_EGRESS_VERIFIED`, `BROWSER_ALLOWED_URLS` | Browser Use worker |
| `ENABLE_N8N`, `N8N_WORKFLOWS_JSON` (+ referenced token variables), `N8N_ENCRYPTION_KEY` | Core-invoked n8n workflows |
| `N8N_CALLBACK_URL`, `N8N_CALLBACK_TOKEN` | Optional push of n8n-submitted task outcomes (set both) |
| `ENABLE_CODEX`, `OPENAI_API_KEY`, `CODEX_MODEL`, `CODEX_ISOLATION_VERIFIED`, `CODEX_WORKSPACE`, `CODEX_ISOLATED_HOME` | Codex SDK adapter (isolated host only) |
| `ENABLE_DESKTOP`, `WINDOWS_MCP_COMMAND`, `WINDOWS_MCP_ARGS`, `JARVIS_FILE_ROOTS` | Windows-MCP desktop actions and the folders file actions may touch |
| `ENABLE_NEWS`, `NEWS_FEEDS` | RSS news briefs and panels |
| `BRAIN_EMBEDDINGS`, `BRAIN_EMBEDDING_MODEL` | Optional semantic recall for the learning brain (`gemini`) |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) and [ADRs](docs/ADR/)
- [Integrations](docs/INTEGRATIONS.md) and [research and compatibility](docs/RESEARCH_AND_COMPATIBILITY.md)
- [Threat model](docs/THREAT_MODEL.md) and [recovery runbook](docs/RECOVERY_RUNBOOK.md)
- [Engineering report](docs/ENGINEERING_REPORT.md): evidence, limitations, next milestones
- [Action engine evidence](docs/ACTION_ENGINE_EVIDENCE.md): intent eval results and live checks
- [Master directive](docs/MASTER_DIRECTIVE.md): the requirements this project implements
