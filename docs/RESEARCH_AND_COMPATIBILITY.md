# Research and compatibility — 2026-10-17

Sources were read before integration implementation. Release tags were obtained from the
official repositories' GitHub release API; package versions from npm/PyPI. A published tag
is discovery evidence, not proof that a complete deployment works.

| Component | Observed upstream | Selected / installed | Runtime evidence |
| --- | --- | --- | --- |
| Node.js | 24.22.0 LTS, 2026-10-14 | 24.22.0 official Windows ZIP, SHA256 checked | Type checking and suite run; 24.11.0 also tested |
| TypeScript | 7.0.2 | 7.0.2 | Strict type checking + build |
| OpenClaw | v2026.10.4 | 2026.10.4, portable Node global prefix | Native Gateway, ChatGPT OAuth via `@openclaw/codex`, denial probes and approved Core task COMPLETED |
| Browser Use | GitHub 0.13.13; PyPI 0.13.11 | 0.13.11, Python 3.12.10 | Real ephemeral browser DOM readback passed |
| n8n | n8n@2.43.7 | 2.43.7 image | Live: ingress roundtrip and Core-invoked webhook with dedup; API key client not exercised |
| Claude Code | v2.1.302 researched | Existing official CLI 2.1.281 | Subscription live tasks COMPLETED with strict flags; earlier 403 did not recur; harness 15 tests |
| Claude API SDK | npm 0.135.0 | @anthropic-ai/sdk 0.135.0 | Compiled adapter; not live-verified (no API key by design) |
| Codex | rust-v0.163.0 | @openai/codex-sdk 0.163.0 | ChatGPT login in isolated home; approved Core task COMPLETED on gpt-5.6-sol |
| Gemini CLI | v0.64.0 | Research reference; CLI not launched | Gemini API path below; CLI harness pending |
| Gemini API SDK | npm 2.30.0 | @google/genai 2.30.0 | Operator free-tier key; `gemini-3.5-flash` live task COMPLETED |
| PostgreSQL | Selected existing 18.3 image | 18.3-bookworm, amd64 digest pinned | Live: concurrent migrate, competing claims, reconnect after backend kill, benchmark |
| Docker Desktop | Compose v2, WSL2 backend | Core image built locally | Live: health, CLI lifecycle, restart persistence, SIGTERM drain, segmented networks |
| PGlite | 0.5.10 | Dev/test only | Real SQL, transactions and disk reopen tested |
| Fastify / Zod / pg | 5.12.7 / 4.6.7 / 8.23.1 | Same exact versions | HTTP and SQL tests |
| OpenTelemetry | API 1.9.1; tracing SDK 2.12.0 | Same exact versions | Correlated JSON span export tested |

Locks: `package-lock.json` and `workers/browser/uv.lock`. Python Browser Use pulls a
substantial transitive dependency set; it remains isolated from Core's TypeScript runtime.
Container tags/manifest existence does not establish image security or successful startup.
Python base 3.12.10 matches the local interpreter; patch/security upgrade review remains due.
No broad “latest stable = tested compatible” claim is made.

Subscription follow-up: Node's existing portable 24.22.0 ZIP was freshly SHA256-verified;
system MSI execution was denied by automatic policy review, so system Node stays 24.11.0.
OpenClaw 2026.10.4 configuration uses `agents.entries` and explicit ownership, not legacy
default-agent markers. Global and `jarvis-reader` tool policies both deny `*`; file/image
URL fetching is off. Configuration validates, but Gateway bootstrap fails and read-only
doctor reproduces state ownership/offline-maintenance failures even in its temporary state.
No lock was deleted, no maintenance boundary bypassed, and policy attestation remains false.
The operator completed browser OAuth, but OpenClaw's CLI exited on the state failure; its
saved login and model access remain unverified. Runtime evidence is in the engineering report.

## OpenClaw

Sources: [Gateway protocol](https://docs.openclaw.ai/gateway/protocol),
[ACP agents](https://docs.openclaw.ai/tools/acp-agents),
[trust model](https://docs.openclaw.ai/gateway/security/trust-model),
[OpenResponses](https://docs.openclaw.ai/gateway/openresponses-http-api),
[release](https://github.com/openclaw/openclaw/releases/tag/v2026.10.4).

Use documented `POST /v1/responses`, bearer authentication and a dedicated agent header.
The endpoint must be enabled by the operator. Core supplies a task-specific `user` session
identity and rejects incomplete, failed, tool-call and unexpected response shapes. HTTP
disconnect supports cancellation upstream, but Core records uncertainty rather than claiming
all external effects stopped. Native tools must be disabled by verified OpenClaw policy;
`tools: []` alone is not an enforcement boundary. Device-paired Gateway WebSocket v4 is
researched but not reimplemented. Native Codex app-server and ACP harness ownership differ;
neither pathway is claimed implemented here. Never concurrently manage a session in Core
and OpenClaw. Scope/authentication changes across versions require a new contract test.

## Browser Use

Sources: [quickstart](https://docs.browser-use.com/open-source/quickstart),
[browser parameters](https://docs.browser-use.com/open-source/customize/browser/all-parameters),
[official source](https://github.com/browser-use/browser-use),
[selected package](https://pypi.org/project/browser-use/0.13.11/).

The installed package exposes `Browser`, session navigation, Actor page evaluation and
explicit cleanup. Use an ephemeral session and application-owned fixed DOM extraction,
without an LLM, account state or user scripts. Session navigation waits for lifecycle
readiness; raw Actor `goto` does not. Exact HTTPS URLs and independent DOM readback bind
the result. Global timeout and cleanup timeout are separate. Authentication is only the
Core-to-worker token; no cloud credential is required for this Actor path. Native browser
navigation is live-tested; the authenticated service container and network egress isolation
remain unverified. General autonomous form filling is unsupported.

## n8n

Sources: [API](https://docs.n8n.io/api/), [authentication](https://docs.n8n.io/api/authentication/),
[queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/),
[webhooks](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/),
[repository](https://github.com/n8n-io/n8n).

Use `X-N8N-API-KEY` for workflow discovery and execution-status reads. Invoke registered
published webhooks rather than inventing a public “execute workflow” method. Inbound Core
events use a separate bearer credential, stable event identity, timestamp window and durable
deduplication. The included roundtrip uses bounded waits and status reads; n8n owns the
trigger schedule. Public execution stop is explicitly unsupported by this client. Workflow
versions and idempotency behavior must be validated in the deployed workflow; the included
callee example was validated live on 2.43.7. Queue mode
requires Redis and the n8n database topology; it is intentionally not enabled for the first
single-instance deployment. API permissions/availability depend on the deployed edition.

## Claude

Sources: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview),
[Messages API](https://platform.claude.com/docs/en/api/typescript/messages/create),
[TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript),
[Code releases](https://github.com/anthropics/claude-code/releases).

The implemented path uses the official Messages SDK, explicit model ID, API key, output
token cap, abort signal and disabled SDK retries. It registers no tools. Only an end-turn
response qualifies for output verification. Authentication, rate-limit and server errors are
classified without retaining exception bodies. Claude Code/Agent SDK execution and its
subscription permissions are separate. The new official CLI harness is described in
[INTEGRATIONS.md](INTEGRATIONS.md#claude-code-subscription) and ADR 0008; its live calls
completed after an earlier organization 403 that did not recur. Streaming exists
upstream but this adapter currently buffers bounded text. No subscription entitlement is
assumed from API access.

## Codex

Sources: [official SDK documentation](https://learn.chatgpt.com/docs/codex-sdk),
[SDK repository](https://github.com/openai/codex/tree/main/sdk/typescript),
[releases](https://github.com/openai/codex/releases),
[OpenClaw ACP](https://docs.openclaw.ai/tools/acp-agents).

The official SDK wraps a CLI process; it creates a thread and accepts an abort signal.
The adapter selects read-only sandbox, no web search, no network permission and no runtime
approval escalation. A dedicated workspace, isolated CODEX_HOME and explicit `api-key` or
`chatgpt` auth mode are supplied. ChatGPT mode has no API key and checks only login-file
presence. Those settings do not prove host filesystem isolation; a container/VM is required
for sensitive isolation. The approved single-operator native mode accepts that residual risk.
Configuration identity includes model, workspace, isolated home and auth mode. SDK thread execution, native app-server
and OpenClaw-managed ACP are distinct paths; only the standalone SDK adapter exists here.
An approved native Core text task completed with durable events on `gpt-5.6-sol`.
No coding edit or sandbox-escape test has been run; machine-wide skill guidance was visible.

## Gemini

Sources: [Gemini API](https://ai.google.dev/gemini-api/docs),
[text generation](https://ai.google.dev/gemini-api/docs/text-generation),
[headless CLI](https://geminicli.com/docs/cli/headless/),
[CLI repository](https://github.com/google-gemini/gemini-cli).

The official installed GenAI SDK still exposes `models.generateContent`; this release uses
that typed text-only method, abort signal and output cap. The documentation now foregrounds
Interactions; migration to it is a future compatibility decision, not an invented equivalent.
No tools are registered, and non-STOP responses fail validation. CLI JSON/streaming interfaces
and CLI authentication were researched but not launched. API keys, CLI OAuth, subscription
access and quotas must remain separate. Fallback is possible only after known retry-safe
failures within the original allowlist, privacy scope, call count and total wall-clock budget.

## Evidence boundaries

- Local HTTP servers emulate documented provider responses; they do not establish live connectivity.
- Browser Use import and real public DOM extraction are live evidence for that limited path.
- Docker became available later in the session: the Core image, PostgreSQL 18.3 and n8n 2.43.7
  ran on Docker Desktop for Windows. The browser-worker container was not started because
  egress controls are not attested.
- Real PostgreSQL suite requires explicit opt-in and a local disposable database. An inherited
  unrelated database setting caused an initial connection failure; it is never used implicitly now.
- No provider credentials, paid requests, accounts, external messages or deployments were created.
- Relevant breaking/auth/lifecycle changes were reviewed at interface level; exhaustive release
  diff audits and the full cross-provider test matrix remain open deployment gates.
