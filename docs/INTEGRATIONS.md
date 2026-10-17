# Integration setup

All integrations start disabled. Health “configured” means local configuration exists;
it never means remote authentication, billing entitlement or runtime policy was verified.
Choose explicit model IDs available to your account. Keep subscription credentials inside
the official CLI paths below; never substitute them for an API key.

## Claude and Gemini APIs

Set `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `ENABLE_CLAUDE=true` for the official Messages
SDK. Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `ENABLE_GEMINI=true` for the official GenAI
SDK. Core does not supply tools to these models. Requests are bounded by task calls,
output tokens, context size and total deadline. Financial cost caps and measured reliability
routing are not implemented; do not use these modes for tasks requiring a hard money cap.
Private tasks require exact per-action approval before remote disclosure.

## Claude Code subscription

Set `ENABLE_CLAUDE_CODE=true`, an existing absolute `CLAUDE_CODE_PATH`, and
`CLAUDE_CODE_MODEL` (for example `sonnet`). Run `claude auth login --claudeai` as the
operator. Core runs the official binary with no tools, MCP, slash commands, persistence
or user customizations (`--safe-mode`), in `data/claude-code`, with the objective on stdin.
The child receives only the environment allowlist; Windows adds OS identity variables.
API keys and arbitrary parent variables are excluded. Core never reads OAuth tokens.
Managed enterprise policy can still apply. One JSON result is capped at 1 MiB of UTF-8;
stderr is bounded for classification and never logged.

Claude Code and Codex do **not** enforce `budget.maxOutputTokens`. Their readiness entries
explicitly report `outputTokenLimitEnforced: false`; omitted means unknown for other
providers. Size checks and deadlines do not cap generated tokens or subscription quota.
Choose a provider with supported token limits when the task requires a hard ceiling.

[Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) distinguish ordinary
individual Claude Code use from routing third-party traffic through subscription tokens.
This harness is for its single local operator. The live request returned 403
`oauth_not_allowed_for_organization` (organization disabled subscription access), classified
as `policy-denied`; this provider stays disabled until account access is enabled.

Gemini remains API-key only. No Gemini CLI or Antigravity OAuth path is implemented;
see [Google's deprecation notice](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals),
[Gemini CLI terms](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)
and [Antigravity terms](https://antigravity.google/terms). No Gemini key was available.

## OpenClaw

On this host 2026.10.4 is installed under the portable Node 24.22.0 npm prefix. Installed
schema validation accepted `gateway.mode=local`, `gateway.bind=loopback`,
`gateway.port=18789`, `gateway.auth.mode=token`, `gateway.http.endpoints.responses.enabled=true`,
and both `tools.deny=["*"]` and `agents.entries.jarvis-reader.tools.deny=["*"]`.
The agent uses `openai/gpt-5.6-sol` and `agents.ownership=explicit`. File/image URL inputs
are disabled under the Responses endpoint. The random 48-byte Gateway token matches
`OPENCLAW_TOKEN`; secrets were supplied via `openclaw config patch --stdin`, not argv.
The intended login command is `openclaw models auth login --provider openai --agent jarvis-reader`.

Gateway startup and login confirmation are currently blocked by OpenClaw's native SQLite
ownership/maintenance failure. The read-only `openclaw doctor --json` reproduces it even
with temporary state. Do not delete locks or relax tool policy to make startup pass.
Both enablement and policy attestation stay false until the three adversarial probes,
session-log inspection and approved Core task actually pass.

Provision the researched version separately, bind the Gateway to loopback/private container
network, require bearer authentication and enable its documented Responses endpoint.
Create a dedicated `jarvis-reader` agent with no privileged native tools, shell execution,
browser control, account credentials or cross-agent delegation. Verify denial with adversarial
prompts and OS/network restrictions before setting `OPENCLAW_POLICY_VERIFIED=true`.
The flag is an operator attestation, not a sandbox installer or proof.

Set URL, agent ID and token, then `ENABLE_OPENCLAW=true`. Native Core uses the loopback
default from `.env.example`. Core in Compose cannot reach host loopback: attach the separately
provisioned service to a network Core joins and set `OPENCLAW_URL` to its service URL, for
example `http://openclaw:18789`. Never assume
that client `tools: []` disables all Gateway-native tools. Gateway sessions belong to
OpenClaw. Native Codex app-server and ACP harness execution require a later tested integration;
do not launch a second Core SDK manager against those same sessions.

## Browser Use

The initial path is deterministic public-page extraction through Browser Use Actor methods.
It accepts only configured exact HTTPS URLs, starts an ephemeral browser, checks DOM text
and destroys the session. No credentials, form submission, registration, generated scripts,
downloads, CAPTCHAs, account management or shared profiles are supported.

```powershell
uv sync --project workers/browser --locked
$env:JARVIS_LIVE_BROWSER_TEST='true'
uv run --project workers/browser --locked python workers/browser/live_smoke.py
```

This smoke test uses a public example page without credentials. It is separate from enabling
the browser service. Before service activation, provide verified egress controls that block
private networks, loopback, metadata endpoints and unapproved destinations, including page
subresources and redirects. A top-level URL/domain allowlist is not that network boundary.
Then set `BROWSER_EGRESS_VERIFIED=true`, a random `BROWSER_WORKER_TOKEN` and the exact
`BROWSER_ALLOWED_URLS` array. Start the Python worker or the opt-in Compose browser profile.
Configure Core with its worker URL and enable Browser. The container and Chromium sandbox
combination is not live-tested here; never “fix” it by disabling Chromium security.

## Codex SDK

Provision a dedicated container/VM with no personal files, host home, `.env`, Docker socket
or unrelated provider credentials. Create dedicated directories under `data/workspaces` and
`data/codex-homes`. The adapter receives an explicit auth mode and its isolated home. Make
the relevant configuration immutable for the action lifetime. Read-only mode alone does
not prevent all host file reads and does not establish isolation.

Only after verifying that boundary set `CODEX_ISOLATION_VERIFIED=true`, explicit model,
workspace and isolated-home paths, `OPENAI_API_KEY` and `ENABLE_CODEX=true`. This adapter
currently produces proposals; repository edits/test/promotion orchestration is unsupported.
The default read-only Core container cannot run this path without additional provisioned
workspace mounts, and no unsafe automatic override is supplied.

The approved native subscription mode sets `CODEX_AUTH=chatgpt` instead of the default
`api-key`. Create dedicated directories, then sign in with the official CLI:

```powershell
New-Item -ItemType Directory -Force data/codex-homes/jarvis, data/workspaces/jarvis
$env:CODEX_HOME = Join-Path $PWD 'data/codex-homes/jarvis'
codex -c 'cli_auth_credentials_store="file"' login
codex login status
Remove-Item Env:CODEX_HOME
```

Set `CODEX_WORKSPACE` and `CODEX_ISOLATED_HOME` to those absolute directories, select
`CODEX_MODEL`, and retain the attestation and HIGH approval gates. Core checks only
`auth.json` presence, never its contents, and supplies no API key in ChatGPT mode. Native
host reads remain possible: the live run saw machine-wide skill guidance. The operator
accepted this residual risk; use a container/VM for an actual host-read boundary. See
[OpenAI authentication](https://learn.chatgpt.com/docs/auth) and
[OpenClaw's supported subscription route](https://docs.openclaw.ai/providers/openai).
Auth mode is part of the action configuration fingerprint, so changing it invalidates approval.

## n8n

```powershell
docker compose --profile automations up -d --build
```

Complete n8n's local operator setup at `http://127.0.0.1:5678`. Import
`examples/n8n/jarvis-roundtrip.json`. Assign an HTTP Header Auth credential to **both** HTTP
nodes: name `Authorization`, value `Bearer <N8N_INGRESS_TOKEN>`. Do not give n8n the Core
operator token. Provision OpenClaw as above before executing the example.

The example manually triggers a Core task, waits in bounded five-second intervals, reads
status and consumes the verified response. The task's privacy is private, so Core first
requires operator approval: inspect `/v1/tasks/:id/actions`, then grant the exact action.
The workflow stops on terminal failure/uncertainty or after at most 21 status iterations.
No external message is sent. Live run on n8n 2.43.7: ingress returned 202, the status loop
polled, and with OpenClaw not provisioned the task became BLOCKED and the workflow stopped at
its operator-review branch. n8n emits Luxon timestamps with a UTC offset (`+03:00`); Core
accepts offsets. A retried n8n execution re-evaluates `$now`, so Core sees a changed payload
for the same event ID and returns a conflict: this fails closed and needs operator review.

For Core-to-n8n execution, register published workflow webhook URLs in `N8N_WORKFLOWS_JSON`:

```json
{"example":{"url":"http://n8n:5678/webhook/reviewed-workflow","tokenRef":"N8N_WORKFLOW_EXAMPLE_TOKEN","version":"reviewed-v1"}}
```

Supply the referenced secret through the environment and enable n8n. Inside Compose use
the service URL (`http://n8n:5678/...`); Core and n8n share only the `automation` network.
Each workflow must
deduplicate task IDs durably before external writes and return `{ "text": "...", "source":
"n8n:authoritative-readback", "externalId": "execution-id" }` only after its own declared
verification. Core cannot prove external truth from arbitrary webhook JSON. Admin discovery
and status reads use `N8nClient` with an independently scoped `X-N8N-API-KEY`. Workflow
discovery is currently a bounded first page. Public execution stopping is explicitly rejected.

`examples/n8n/jarvis-core-callee.json` is a reference callee: a header-authenticated webhook,
a Remove Duplicates node keyed on `taskId` across executions, and a response in Core's result
contract. Verified live: Core invoked it after exact HIGH approval and recorded COMPLETED with
the n8n execution ID; replaying the same `taskId` returned an empty body without running the
workflow again; a wrong token returned 403. Its response text is produced by the workflow
itself, so it proves invocation and deduplication, not an external business outcome.

Live setup without the n8n UI (PowerShell; container name from `docker compose ps`):

```powershell
docker cp examples/n8n/jarvis-core-callee.json jarvis-core-n8n-1:/tmp/callee.json
docker exec jarvis-core-n8n-1 n8n import:workflow --input=/tmp/callee.json
docker exec jarvis-core-n8n-1 n8n publish:workflow --id=<workflow id>
docker compose --profile automations restart n8n   # webhooks register on start
```

Create the Header Auth credential in the UI or with `n8n import:credentials`. `n8n execute`
inside the running container needs `-e N8N_RUNNERS_BROKER_PORT=5690` because the server
already holds the default broker port. From Git Bash, prefix `docker exec` commands that
pass container paths with `MSYS_NO_PATHCONV=1`.
