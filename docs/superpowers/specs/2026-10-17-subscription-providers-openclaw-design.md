# Subscription providers and local OpenClaw — design

Date: 2026-10-17. Status: approved in conversation; pending written-spec review.

## Intent

The operator wants Claude and Codex through their own subscription logins (OAuth), not API
keys, and a locally installed OpenClaw Gateway integrated with Core. Gemini uses an API key.
Everything runs on this Windows 11 host without WSL. Core keeps sole authority over routing,
policy, approval, verification and recovery.

Success: each path completes a real Core task with durable events, and no OAuth token ever
enters Core, its logs, its database or its child-process arguments.

## Constraints from primary sources

- Anthropic ([Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)):
  OAuth authentication supports ordinary use of Claude Code and native Anthropic applications.
  Third-party developers may not route requests through Free, Pro or Max credentials on behalf
  of users. Advertised limits assume ordinary, individual use of Claude Code and the Agent SDK.
  Consequence: Core runs the unmodified official `claude` binary headless for its own operator;
  it never reads, stores or forwards the Claude OAuth token.
- OpenAI ([OpenClaw OpenAI provider](https://docs.openclaw.ai/providers/openai)): OpenAI supports
  ChatGPT/Codex subscription OAuth in external tools. Codex CLI login and OpenClaw's own
  `openclaw models auth login --provider openai` are both permitted.
- Google ([Code Assist for individuals deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals),
  [Gemini CLI terms](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md),
  [Antigravity terms](https://antigravity.google/terms)): Login with Google for individual,
  Google AI Pro and Ultra tiers stopped serving Gemini CLI on 2026-06-18, and third-party access
  through Gemini CLI or Antigravity OAuth breaches the terms. Decision: Gemini stays on the
  existing API-key adapter.
- OpenClaw 2026.10.4 requires Node `>=24.16.0 <25 || >=26.1.0`
  ([npm](https://registry.npmjs.org/openclaw/latest)); native Windows CLI and Gateway are
  supported ([Windows](https://docs.openclaw.ai/platforms/windows)). The OpenResponses endpoint
  is disabled by default and a shared-secret bearer grants full operator scope
  ([OpenResponses](https://docs.openclaw.ai/gateway/openresponses-http-api)).

## Deployment

- Subscription CLIs and their logins live in the operator's Windows profile, so Core runs
  natively (`npm start`) for these providers. PostgreSQL stays in Docker, published on loopback
  through `compose.dev.yaml`. The Docker Core mode remains for API-key providers and n8n.
- System Node is upgraded from 24.11.0 to 24.22.0 (same LTS line, official MSI, SHA256
  verified). This is the only change outside the repository besides installed CLIs.
- OpenClaw: `npm install -g openclaw@2026.10.4`. Gateway bound to `127.0.0.1:18789`, shared
  token auth with a random token that is also Core's `OPENCLAW_TOKEN`, `/v1/responses`
  enabled. Started manually with `openclaw gateway run`; no Scheduled Task.
- OpenClaw model: Codex subscription via `openclaw models auth login --provider openai`.
- OpenClaw agent `jarvis-reader` with every tool denied. Denial is verified with adversarial
  prompts (shell command, file read, web fetch) before `OPENCLAW_POLICY_VERIFIED=true`.
- The operator completes every OAuth login in the browser. The agent starts the commands and
  never types passwords or reads tokens.

## Components

### ClaudeCodeExecutor (new, `src/integrations/claude-code.ts`)

- `id: "claude-code"`, capability `text.generate`, `external: true`, `retrySafe: true`
  (no tools, so no side effects), no executor risk floor. Private tasks still require HIGH
  approval through the existing external-provider policy floor.
- Process: `spawn(CLAUDE_CODE_PATH, ["-p", "--output-format", "json", "--model", model,
  "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
  "--no-session-persistence"])`, no shell. The objective is written to stdin, never argv.
  `cwd` is an empty `data/claude-code` directory.
- Child environment is an allowlist: `PATH`, `SystemRoot`, `USERPROFILE`, `HOME`, `APPDATA`,
  `LOCALAPPDATA`, `TEMP`, `TMP`. `ANTHROPIC_API_KEY` and every other variable are excluded, so
  authentication is the subscription login. `--bare` is not used: it never reads OAuth.
- Output: the single JSON result is validated with Zod (`type: "result"`, `is_error`,
  `result`, `session_id`). stdout is capped at 1 MiB; stderr is never logged and is used only to
  classify failures. Result `source` is `claude-code:<model>:subscription`; `externalId` is the
  session id.
- Failure classification:
  - spawn error such as ENOENT: `provider-unavailable`, not dispatched;
  - not logged in or expired login: `authentication-required`, not dispatched;
  - subscription usage limit or HTTP 429: `rate-limited`, retryable;
  - malformed or oversized output, non-zero exit without a known cause: `invalid-response`;
  - abort or deadline: the child is killed; the gateway's existing abort handling applies.
- Configuration: `ENABLE_CLAUDE_CODE`, `CLAUDE_CODE_PATH` (absolute, must exist),
  `CLAUDE_CODE_MODEL`. Registry configuration string `claude-code:<model>:tools-none`.

### Codex subscription mode (existing `CodexExecutor`)

- New `CODEX_AUTH=chatgpt|api-key`, default `api-key` (current behavior).
- `chatgpt`: no API key is required or passed; startup requires `<CODEX_ISOLATED_HOME>/auth.json`
  to exist (presence only, never read). The operator creates it with
  `$env:CODEX_HOME = "<repo>\data\codex-homes\jarvis"; codex login`.
- Unchanged: read-only sandbox, network disabled, approval policy never, HIGH floor,
  per-run approval, `CODEX_ISOLATION_VERIFIED` attestation. On native Windows the read-only
  sandbox is not an OS read boundary; this stays a documented residual risk.

### OpenClaw and Gemini

Configuration only: `OPENCLAW_URL=http://127.0.0.1:18789`, `OPENCLAW_AGENT_ID=jarvis-reader`,
existing HIGH floor; Gemini uses `GEMINI_API_KEY`, entered by the operator.

## Testing and verification

- Automated (TDD), with `CLAUDE_CODE_PATH` pointing at a fake `claude` script: success JSON,
  not logged in, usage limit, malformed and oversized output, ENOENT, child killed on abort,
  prompt on stdin and absent from argv, `ANTHROPIC_API_KEY` absent from the child environment.
  Codex `chatgpt` mode: refuses startup without `auth.json`, requires no API key. Configuration:
  missing required fields refuse startup. The existing suite stays green.
- Live, each as a Core task with durable events:
  1. Claude Code subscription task reaches COMPLETED; output shows no user hooks or CLAUDE.md.
  2. Codex with ChatGPT login, HIGH approval, COMPLETED.
  3. OpenClaw: adversarial prompts are refused, then an approved task reaches COMPLETED.
  4. Gemini with the operator's key, COMPLETED; without a key it is reported as blocked.
- Docs: README native mode, INTEGRATIONS subscription paths and terms boundaries, ADR 0008,
  engineering report integration table and evidence. Commit; push only after confirmation.

## Out of scope

Antigravity CLI, OpenClaw Scheduled Task, Claude Code tools, Gemini OAuth, routing models
through OpenClaw, multi-user subscription use.

## Open item resolved during implementation

The exact OpenClaw configuration keys for denying all agent tools are read from the installed
version's documentation and `openclaw config` schema before they are applied.
