# Integration setup

All integrations start disabled. Health “configured” means local configuration exists;
it never means remote authentication, billing entitlement or runtime policy was verified.
Choose explicit model IDs available to your account. Keep subscription credentials inside
the official CLI paths below; never substitute them for an API key.

## Claude and Gemini APIs

Set `ANTHROPIC_API_KEY` and `ENABLE_CLAUDE=true` for the official Messages SDK.
`CLAUDE_MODEL` defaults to `claude-opus-5-5`. Enabling Claude registers two providers on the
same model: `claude` (optional `CLAUDE_EFFORT`: low, medium, high, xhigh or max) and
`claude-live` at low effort for realtime voice turns, ranked right after `gemini-live`. Every
stop reason is mapped: a truncated reply (`max_tokens`, context window) may fall back to
another listed provider, a safety `refusal` is final and is never shopped to other providers.
On models that accept it (Fable 5.1, Opus 5.5, Opus 5, Sonnet 5.5) Core enables Anthropic's
server-side refusal fallback; the result's `source` names the model that actually served.
Set `CLAUDE_REFUSAL_FALLBACK=false` to send single-model requests only.

Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `ENABLE_GEMINI=true` for the official GenAI SDK. Core
does not supply tools to these models. Requests are bounded by task calls, output tokens,
context size and total deadline. Conversation turns and replans ask for native JSON mode where
it exists (Gemini `application/json`, OpenRouter `json_object`); Claude follows the prompt's
JSON contract. Claude, Gemini, OpenAI-compatible and Claude Code results report token usage.

Routing measures every provider (see [ADR 0011](ADR/0011-measured-adaptive-routing.md)).
`PROVIDER_BUDGETS_JSON` sets rolling 24-hour call or token ceilings per provider id, for
example `{"or-some-model":{"callsPerDay":45},"claude":{"tokensPerDay":500000}}`; free
OpenRouter keys allow about 50 requests a day. Money-denominated caps are not implemented; do
not use these modes for tasks requiring a hard money cap. Private tasks require exact
per-action approval before remote disclosure.

## Claude Code subscription

Set `ENABLE_CLAUDE_CODE=true`, an existing absolute `CLAUDE_CODE_PATH`, and
`CLAUDE_CODE_MODEL` (for example `sonnet`). Run `claude auth login --claudeai` as the
operator. Core runs the official binary with no tools, MCP, slash commands, persistence
or user customizations (`--safe-mode`), in `data/claude-code`, with the objective on stdin.
The child receives only the environment allowlist plus `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`
and `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`: the workdir sits inside this repository, and without
them Claude Code adds its git status snapshot (branch, file names, commits) to every prompt.
Claude Code's own built-in prompt still carries the account e-mail and an environment block
to the operator's subscription. Windows adds OS identity variables.
API keys and arbitrary parent variables are excluded. Core never reads OAuth tokens.
Managed enterprise policy can still apply. One JSON result is capped at 1 MiB of UTF-8;
stderr is bounded for classification and never logged.

Claude Code and Codex do **not** enforce `budget.maxOutputTokens`. Their readiness entries
explicitly report `outputTokenLimitEnforced: false`; omitted means unknown for other
providers. Size checks and deadlines do not cap generated tokens or subscription quota.
Choose a provider with supported token limits when the task requires a hard ceiling.

[Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) distinguish ordinary
individual Claude Code use from routing third-party traffic through subscription tokens.
This harness is for its single local operator. An earlier live request returned 403
`oauth_not_allowed_for_organization`; that response is classified as `policy-denied`. It did
not recur: with the strict flags the subscription login answers, and live Core tasks
completed (see the engineering report). Without `--setting-sources ""` a user-level
`apiKeyHelper` or `ANTHROPIC_BASE_URL` would take precedence over the subscription login.

Gemini remains API-key only. No Gemini CLI or Antigravity OAuth path is implemented;
see [Google's deprecation notice](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals),
[Gemini CLI terms](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)
and [Antigravity terms](https://antigravity.google/terms). The operator's free-tier key is
in `.env` only; `gemini-3.5-flash` was chosen from the live model list and completed a task.

## OpenClaw

On this host 2026.10.4 is installed under the portable Node 24.22.0 npm prefix. Installed
schema validation accepted `gateway.mode=local`, `gateway.bind=loopback`,
`gateway.port=18789`, `gateway.auth.mode=token`, `gateway.http.endpoints.responses.enabled=true`,
and both `tools.deny=["*"]` and `agents.entries.jarvis-reader.tools.deny=["*"]`.
The agent uses `openai/gpt-5.6-sol` and `agents.ownership=explicit`. File/image URL inputs
are disabled under the Responses endpoint. The random 48-byte Gateway token matches
`OPENCLAW_TOKEN`; secrets were supplied via `openclaw config patch --stdin`, not argv.
OpenAI models run through the official `@openclaw/codex` harness plugin
(`openclaw plugins install @openclaw/codex`). Start every OpenClaw command with
`scripts/openclaw-native.ps1`, which prefixes the portable Node and removes `OPENAI_API_KEY`,
`CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `GOOGLE_API_KEY` from the process
environment. Log in with:

```powershell
.\scripts\openclaw-native.ps1 models auth login --provider openai --method oauth --agent jarvis-reader --profile-id openai:default
```

Keep `--profile-id`. Without it, 2026.10.4 first tries to import the Codex CLI login through
a managed app-server. On Windows that app-server's transport close is never reported as
"closed", so every attempt fails with "The Codex credential reader could not stop". The
explicit profile skips that import and never copies `~/.codex` tokens. The operator
completes the browser OAuth. Gateway startup on this host takes about 60 s; the SQLite
failure recorded earlier did not recur with a direct `gateway run`.

`tools.deny=["*"]` does not remove every tool. The Codex harness still exposes code-mode
`exec`/`wait`, which never appear as Responses output items. On 2026.10.4 `exec` was observed
running a V8 isolate with an empty nested `tools` object and no `fetch`, `require` or file
system; that is observed behavior, not an upstream guarantee. `feature.shell_tool=false`, and MCP, apps, plugins, browser and computer use
are off. Defense in depth: `plugins.entries.codex.config.appServer` sets
`sandbox: "read-only"` and `approvalPolicy: "never"`; the harness default is
`danger-full-access`. Two rounds of shell, file and web probes against a random canary file, plus explicit
`exec`/`wait` probes, showed no leak. The Gateway log showed only agent runs ending
`stopReason=stop`, and the Codex session rollouts showed no calls beyond the probed
`exec`/`wait`. `OPENCLAW_POLICY_VERIFIED=true` rests on that evidence. Re-run the probes after any
OpenClaw or Codex plugin upgrade before trusting the flag again.

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
`BROWSER_ALLOWED_URLS` array. Start the native worker with `.\scripts\browser-native.ps1`,
or use `.\scripts\integrations-native.ps1` to bring up OpenClaw, the browser worker and the
n8n Compose profile together. The opt-in Compose browser profile remains available.
Configure Core with its worker URL and enable Browser. The container and Chromium sandbox
combination is not live-tested here; never “fix” it by disabling Chromium security.

## Windows-MCP (desktop actions)

Spoken desktop plans run through [Windows-MCP](https://github.com/CursorTouch/Windows-MCP)
0.8.8 as a stdio child of Core; Core is its only MCP client. `uvx` provisions its Python 3.14.

```dotenv
ENABLE_DESKTOP=true
WINDOWS_MCP_COMMAND=uvx
WINDOWS_MCP_ARGS=["windows-mcp@0.8.8","serve"]
JARVIS_FILE_ROOTS=
```

Core passes `ANONYMIZED_TELEMETRY=false` and allowlists only App, Click, Type, Scroll, Shortcut,
Snapshot, Screenshot, FileSystem, Clipboard, Wait, WaitFor and ControlStatus. PowerShell and
Registry are never enabled. File actions stay inside Desktop (OneDrive when present), Documents
and Downloads unless `JARVIS_FILE_ROOTS` lists other folders under the user profile. The child
inherits only system variables, never Core's secrets. If it crashes Core restarts it once; the
running step is then uncertain and is not replayed.

## News (RSS)

```dotenv
ENABLE_NEWS=true
NEWS_FEEDS=["https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr"]
```

Core fetches the listed HTTPS feeds with a timeout and byte limit, skips a failing feed and
builds panels from the fetched headlines only. Thumbnails come only from the feed's own image
URL, private addresses are refused, and only JPEG/PNG/WebP up to 200 KB are sent to the
renderer as data URIs. The spoken brief is a `personal` text task over those headlines.

## Long-term memory

Always available; Settings → İzinler decides how it runs ([ADR 0014](ADR/0014-operator-standing-permissions.md)).
"Jarvis, annemin doğum günü 3 Mayıs, hatırla" becomes a `memory.save` plan that waits for one
tap (or runs at once when the operator allowed `memory.save`); "unut" or "forget" proposes
`memory.forget(about)` the same way, and turning an action off hides it from the model. Notes holding passwords,
PINs, IBANs, card numbers or key-shaped tokens are refused. The newest notes (≤ 3000
characters) go into conversation prompts as data under `personal` consent. Review or remove
them with `GET /v1/memories` and `DELETE /v1/memories[/:id]`; conversation deletion and the
30-day purge leave them alone ([ADR 0012](ADR/0012-operator-approved-memory.md)); Settings →
Hafıza lists and forgets them too.

## Learning brain

Core learns from every understood request without configuration ([ADR 0015](ADR/0015-learning-brain-and-layered-intent.md)):
keyword recall, skills and reflexes run locally on PostgreSQL. Semantic recall is optional:

```dotenv
BRAIN_EMBEDDINGS=gemini
BRAIN_EMBEDDING_MODEL=gemini-embedding-001
```

It needs `ENABLE_GEMINI=true` and sends each understood utterance (not results, notes or screen
text) to the Gemini embedding endpoint. Without it, recall is BM25 only. Settings → Öğrenme
turns learning or reflexes off, shows learned skills, forgets one or resets everything;
`GET /v1/brain`, `POST /v1/brain/consolidate`, `DELETE /v1/brain/skills/:id` and
`DELETE /v1/brain` do the same over the operator API.

## Live progress from the browser worker

Core asks the browser worker for `application/x-ndjson`. The worker then streams one line per
page state (`{"progress":{"index":2,"total":3,"host":"bbc.com","state":"reading"}}`) and ends
with `{"result":{...}}` or an in-band `{"error":...,"status":400|503}` that Core maps exactly
like the HTTP status. Only the host and position leave the worker; page text arrives in the
result as before. A worker built before this change answers plain JSON and Core accepts it, so
rebuild the browser worker image to get page-by-page narration.

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

n8n stays in Docker (no native Windows binary path). Prefer the shared launcher or:

```powershell
.\scripts\integrations-native.ps1 -SkipOpenClaw -SkipBrowser
# or:
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

### Pushed task outcomes (optional)

Instead of polling, n8n can receive each notable status of the tasks it submitted (completed,
failed, cancelled, recovery required, waiting for approval, blocked). Import
`examples/n8n/jarvis-task-events.json`, give its webhook a Header Auth credential (`Authorization`,
`Bearer <random 32+ character token>`), publish it, then set `N8N_CALLBACK_URL` (for example
`http://n8n:5678/webhook/jarvis-task-events`) and `N8N_CALLBACK_TOKEN` in `.env`. Core queues
each event in the transition's own transaction and posts:

```json
{"protocolVersion":1,"type":"task.status","eventId":"<uuid>","taskId":"<uuid>",
 "correlationId":"<uuid>","status":"COMPLETED","occurredAt":"<ISO time>",
 "result":{"text":"...","source":"..."}}
```

Delivery is at least once: the workflow drops repeated `eventId`s. Failed deliveries back off
from 2 s to 5 minutes and are dead-lettered after 12 attempts; `/v1/metrics` reports pending,
delivered and failed counts. Only verified completions carry `result`. Core's side is covered by
contract tests; the example workflow is not live-verified.

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
