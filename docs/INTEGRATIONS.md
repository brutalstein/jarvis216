# Integration setup

All integrations start disabled. Health “configured” means local configuration exists;
it never means remote authentication, billing entitlement or runtime policy was verified.
Choose explicit model IDs available to your account. Do not substitute account or CLI
subscription credentials for documented API authentication.

## Claude and Gemini APIs

Set `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `ENABLE_CLAUDE=true` for the official Messages
SDK. Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `ENABLE_GEMINI=true` for the official GenAI
SDK. Core does not supply tools to these models. Requests are bounded by task calls,
output tokens, context size and total deadline. Financial cost caps and measured reliability
routing are not implemented; do not use these modes for tasks requiring a hard money cap.
Private tasks require exact per-action approval before remote disclosure.

## OpenClaw

Provision the researched version separately, bind the Gateway to loopback/private container
network, require bearer authentication and enable its documented Responses endpoint.
Create a dedicated `jarvis-reader` agent with no privileged native tools, shell execution,
browser control, account credentials or cross-agent delegation. Verify denial with adversarial
prompts and OS/network restrictions before setting `OPENCLAW_POLICY_VERIFIED=true`.
The flag is an operator attestation, not a sandbox installer or proof.

Set URL, agent ID and token, then `ENABLE_OPENCLAW=true`. In Compose a separately
provisioned service may use `http://openclaw:18789`; native Core uses loopback. Never assume
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
`data/codex-homes`. The adapter receives only a Codex API key and its isolated home. Make
the relevant configuration immutable for the action lifetime. Read-only mode alone does
not prevent all host file reads and does not establish isolation.

Only after verifying that boundary set `CODEX_ISOLATION_VERIFIED=true`, explicit model,
workspace and isolated-home paths, `OPENAI_API_KEY` and `ENABLE_CODEX=true`. This adapter
currently produces proposals; repository edits/test/promotion orchestration is unsupported.
The default read-only Core container cannot run this path without additional provisioned
workspace mounts, and no unsafe automatic override is supplied.

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
No external message is sent. Import and execution on a running n8n instance remain pending;
the JSON is a version-targeted example, not live workflow proof.

For Core-to-n8n execution, register published workflow webhook URLs in `N8N_WORKFLOWS_JSON`:

```json
{"example":{"url":"http://n8n:5678/webhook/reviewed-workflow","tokenRef":"N8N_WORKFLOW_EXAMPLE_TOKEN","version":"reviewed-v1"}}
```

Supply the referenced secret through the environment and enable n8n. Each workflow must
deduplicate task IDs durably before external writes and return `{ "text": "...", "source":
"n8n:authoritative-readback", "externalId": "execution-id" }` only after its own declared
verification. Core cannot prove external truth from arbitrary webhook JSON. Admin discovery
and status reads use `N8nClient` with an independently scoped `X-N8N-API-KEY`. Workflow
discovery is currently a bounded first page. Public execution stopping is explicitly rejected.
