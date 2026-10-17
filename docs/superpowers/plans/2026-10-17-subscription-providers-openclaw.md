# Subscription Providers and Local OpenClaw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Core runs Claude through the official Claude Code binary on the operator's subscription, Codex through a ChatGPT login, Gemini through an API key, and a locally installed OpenClaw Gateway, all on native Windows.

**Architecture:** A new `ClaudeCodeExecutor` spawns `claude.exe -p` with tools disabled and an allowlisted environment. `CodexExecutor` gains a `chatgpt` auth mode that relies on an isolated `CODEX_HOME` login. OpenClaw 2026.10.4 runs natively on loopback with Codex subscription auth and a tool-denied agent that Core reaches through the existing OpenResponses adapter.

**Tech Stack:** Node 24.22.0, TypeScript 7, Vitest, Zod 4, `@openai/codex-sdk` 0.163.0, Claude Code 2.1.x, OpenClaw 2026.10.4, PostgreSQL 18.3 in Docker.

**Spec:** `docs/superpowers/specs/2026-10-17-subscription-providers-openclaw-design.md`

## Global Constraints

- No OAuth token is read, stored, logged or passed as an argument by Core; logins stay in each vendor's own tool.
- Claude child argv: `-p --output-format json --model <m> --tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence`; objective on stdin; never `--bare`.
- Claude child env allowlist exactly: `PATH`, `SystemRoot`, `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`.
- Claude stdout cap 1 MiB; stderr never logged.
- `CODEX_AUTH` accepts `chatgpt` or `api-key`; default `api-key`.
- OpenClaw: `openclaw@2026.10.4`, Gateway `127.0.0.1:18789`, shared token auth, `/v1/responses` enabled, manual `openclaw gateway run`, no Scheduled Task.
- System Node upgrade target: 24.22.0 official MSI with SHA256 verified against `SHASUMS256.txt`.
- The operator completes every OAuth login and types every key; the agent never types passwords.
- No push without operator confirmation.

## Review Focus

- Claude exits 0 but returns `is_error: true` with a usage-limit message: must become `rate-limited`, never COMPLETED (Task 1 test `usage limit result is rate-limited`).
- stdout holds a non-JSON line before or after the result (update notice): must be `invalid-response`, not a crash (Task 1 test `noise around JSON is invalid-response`).
- An objective near the 20 000-character context limit: must reach the child intact on stdin (Task 1 test `long objective travels on stdin`).
- `CLAUDE_CODE_PATH` under a directory with spaces: must spawn without a shell (Task 1 test `binary path with spaces spawns`).
- OpenClaw Gateway not started: Core must record a not-dispatched failure, not an uncertain one (Task 4 live step, existing `ECONNREFUSED` classification).

---

### Task 1: ClaudeCodeExecutor

**Files:**
- Create: `src/integrations/claude-code.ts`
- Create: `tests/fixtures/fake-claude.mjs`
- Test: `tests/claude-code.test.ts`

**Interfaces:**
- Produces: `class ClaudeCodeExecutor implements Executor` with `constructor(options: { command: readonly [string, ...string[]]; model: string; workdir: string })`; `id = "claude-code"`, `capability = "text.generate"`, `external = true`, `retrySafe = true`; `execute(task, signal): Promise<ExecutionResult>` returning `{ text, source: "claude-code:<model>:subscription", externalId?: session_id }`. `command` is the executable followed by leading arguments; production passes `[CLAUDE_CODE_PATH]`.
- Produces: `export const claudeCodeEnvKeys = ["PATH","SystemRoot","USERPROFILE","HOME","APPDATA","LOCALAPPDATA","TEMP","TMP"] as const`.

`fake-claude.mjs` is run as `[process.execPath, fixture, mode, recordFile]`. It writes `{ argv, env, stdin }` to `recordFile` and then behaves per `mode`: `success` prints `{"type":"result","subtype":"success","is_error":false,"result":"verified","session_id":"s-1"}`; `login` prints an `is_error:true` result `"Not logged in · Please run /login"` and exits 1; `limit` prints an `is_error:true` result `"Claude AI usage limit reached|1760000000"` and exits 0; `noise` prints `update available` then the success JSON; `huge` prints 2 MiB; `hang` never exits.

- [x] **Step 1: Write the failing tests** in `tests/claude-code.test.ts`:
  - `success returns text, source and session id`: result `text === "verified"`, `source === "claude-code:test-model:subscription"`, `externalId === "s-1"`.
  - `argv carries the fixed flags and no objective`: recorded argv after mode/recordFile equals the Global Constraints argv with `test-model`; objective string absent from argv.
  - `long objective travels on stdin`: 19 000-character objective equals recorded `stdin`.
  - `child env is the allowlist only`: with `process.env.ANTHROPIC_API_KEY = "sk-test-should-not-pass"`, recorded env keys ⊆ `claudeCodeEnvKeys` and contain no `ANTHROPIC_API_KEY`.
  - `not logged in is authentication-required and not dispatched`: rejects `ProviderFailure` with `kind === "authentication-required"`, `dispatched === false`.
  - `usage limit result is rate-limited`: `kind === "rate-limited"`, `retryable === true`.
  - `noise around JSON is invalid-response` and `oversized stdout is invalid-response`: `kind === "invalid-response"`.
  - `missing binary is provider-unavailable and not dispatched`: command `["C:/nonexistent/claude.exe"]`.
  - `abort kills the child`: mode `hang`, abort after 200 ms; promise rejects within 2 s and the child pid no longer exists (`process.kill(pid, 0)` throws).
  - `binary path with spaces spawns`: copy the fixture into a temp dir named `fake claude` and run `success`.

- [x] **Step 2: Run** `npx vitest run tests/claude-code.test.ts` — expected FAIL (module not found).

- [x] **Step 3: Implement** `src/integrations/claude-code.ts`: `spawn(command[0], [...command.slice(1), ...flags], { cwd: workdir, env, shell: false, windowsHide: true, stdio: ["pipe","pipe","pipe"] })`; write objective to stdin and end it; collect stdout up to 1 MiB (kill and fail beyond); on `signal` abort call `child.kill()`; on close parse stdout as one JSON value with a non-strict Zod object `{ type: "result", subtype: string, is_error: boolean, result?: string, session_id?: string }`. Classification uses `result` text, then stderr text: `/\/login|not logged in|authenticat|oauth/i` → `authentication-required` (`dispatched=false`); `/usage limit|rate.?limit|\b429\b/i` → `rate-limited` (retryable); `/overloaded|\b5\d\d\b/i` → `transient` (retryable); spawn `error` event → `provider-unavailable` (retryable, `dispatched=false`); anything else → `invalid-response`.

- [x] **Step 4: Run** `npx vitest run tests/claude-code.test.ts` — expected all PASS; then `npm run check` — expected green.

- [x] **Step 5: Commit** `git add src/integrations/claude-code.ts tests/claude-code.test.ts tests/fixtures/fake-claude.mjs && git commit -m "feat: add Claude Code subscription executor"`.

### Task 2: Configuration for Claude Code and Codex ChatGPT mode

**Files:**
- Modify: `src/config.ts` (provider registration block), `src/integrations/models.ts` (`CodexExecutor`), `.env.example`
- Test: `tests/subscription-config.test.ts`

**Interfaces:**
- Consumes: `ClaudeCodeExecutor` from Task 1.
- Produces: `type CodexAuth = { kind: "api-key"; key: string } | { kind: "chatgpt" }`; `CodexExecutor` constructor becomes `(auth: CodexAuth, model: string, workspace: string, codexHome: string)`; `export function codexOptions(auth: CodexAuth, codexHome: string): CodexOptions` (the object passed to `new Codex(...)`).
- Produces env variables: `ENABLE_CLAUDE_CODE`, `CLAUDE_CODE_PATH`, `CLAUDE_CODE_MODEL`, `CODEX_AUTH`.

- [x] **Step 1: Write the failing tests:**
  - `codex chatgpt options carry no API key`: `codexOptions({kind:"chatgpt"}, home)` has no `apiKey` and `env` has no `OPENAI_API_KEY`; `env.CODEX_HOME === home`.
  - `codex api-key options keep current behavior`: `apiKey` and `env.OPENAI_API_KEY` equal the key.
  - `codex chatgpt mode registers without OPENAI_API_KEY when auth.json exists`: temp dirs created under `data/workspaces` and `data/codex-homes` with `auth.json`; `configuredProviders` registry lists `codex`.
  - `codex chatgpt mode refuses startup without auth.json`: rejects.
  - `claude code registers with an existing absolute path`: registry lists `claude-code` with `configuration === "claude-code:test-model:tools-none"`.
  - `claude code refuses a missing or relative path`: both reject.

- [x] **Step 2: Run** `npx vitest run tests/subscription-config.test.ts` — expected FAIL.

- [x] **Step 3: Implement** in `src/config.ts`: `ENABLE_CLAUDE_CODE === "true"` → `CLAUDE_CODE_PATH` must be absolute (`path.isAbsolute`) and exist (`fs.access`); `CLAUDE_CODE_MODEL` non-empty; workdir `data/claude-code` created with `mkdir -p`; priority 15. Codex: `CODEX_AUTH` parsed with `z.enum(["api-key","chatgpt"]).default("api-key")`; `chatgpt` requires `<home>/auth.json` to exist and never resolves `OPENAI_API_KEY`. Add the four variables to `.env.example` with `ENABLE_CLAUDE_CODE=false`, `CODEX_AUTH=api-key`.

- [x] **Step 4: Run** `npx vitest run tests/subscription-config.test.ts` then `npm run check` — expected green.

- [x] **Step 5: Commit** `git commit -m "feat: configure Claude Code and Codex ChatGPT subscription modes"` with the files above.

### Task 3: Host setup — Node 24.22.0 and OpenClaw Gateway

**Files:** none in the repository except `.env` (values set by sed; never printed).

- [ ] **Step 1: Upgrade system Node.** Download `node-v24.22.0-x64.msi` from `https://nodejs.org/dist/v24.22.0/`, verify its SHA256 against that directory's `SHASUMS256.txt`, install with `msiexec /i <msi> /qn` (the operator approves UAC). Verify: `node --version` prints `v24.22.0`.

- [x] **Step 2: Install OpenClaw.** `npm install -g openclaw@2026.10.4`. Verify: `openclaw --version` prints `2026.10.4`.

- [x] **Step 3: Configure the Gateway** with `openclaw config set` (keys confirmed from `openclaw config` help for the installed version): bind loopback, port 18789, auth mode token with a 48-byte random token, `gateway.http.endpoints.responses.enabled=true`. Write the same token into `.env` as `OPENCLAW_TOKEN` and set `OPENCLAW_URL=http://127.0.0.1:18789`.

- [x] **Step 4: Create agent `jarvis-reader`** with every tool denied and no sandbox escape (keys from the installed docs). Verify: `openclaw config get` shows the deny policy.

- [x] **Step 5: Start and probe.** `openclaw gateway run` in a background terminal. Verify: `GET http://127.0.0.1:18789/v1/models` with the token returns 200 and lists `openclaw/jarvis-reader`; without the token returns 401.

### Task 4: Logins and live verification

**Files:** `.env` (enable flags only), `data/codex-homes/jarvis`, `data/workspaces/jarvis`, `data/claude-code`.

- [x] **Step 1: Operator logins.** Start each command; the operator completes it in the browser:
  `openclaw models auth login --provider openai`;
  `$env:CODEX_HOME="<repo>\data\codex-homes\jarvis"; codex login`.
  Verify: `openclaw models auth list` shows an `openai` profile; `data/codex-homes/jarvis/auth.json` exists; `CODEX_HOME=... codex login status` prints `Logged in using ChatGPT`.

- [x] **Step 2: OpenClaw adversarial denial.** Send three OpenResponses requests to `jarvis-reader`: run `whoami`, read `C:\Windows\win.ini`, fetch `https://example.com`. Verify: no tool call items in any response and the Gateway session log shows no tool execution. Only then set `OPENCLAW_POLICY_VERIFIED=true`.

- [x] **Step 3: Native Core.** `docker compose stop core`; `docker compose -f compose.yaml -f compose.dev.yaml up -d postgres`; set `ENABLE_CLAUDE_CODE=true`, `CLAUDE_CODE_PATH=C:\Users\cenke\.local\bin\claude.exe`, `CLAUDE_CODE_MODEL`, `ENABLE_OPENCLAW=true`, `ENABLE_CODEX=true`, `CODEX_AUTH=chatgpt`, `CODEX_ISOLATION_VERIFIED=true`, `CODEX_WORKSPACE`, `CODEX_ISOLATED_HOME`; start with the inherited `DATABASE_URL` removed (`env -u DATABASE_URL npm start`). Verify: `npm run cli -- ready` lists `claude-code`, `codex`, `openclaw`.

- [x] **Step 4: Live tasks** via `npm run cli -- submit <spec.json> <key>`, each with `verification: {kind:"contains", value:"JARVIS_<NAME>_OK"}`:
  - `claude-code` public task → COMPLETED; the result contains no text from user hooks or `CLAUDE.md` (probe: ask the model to list its instructions; check for "caveman" and "Ponytail").
  - `codex` → WAITING_FOR_APPROVAL → `approve` → COMPLETED.
  - `openclaw` → approval → COMPLETED.
  - `gemini` if the operator set `GEMINI_API_KEY` → COMPLETED; otherwise recorded as blocked.
  - With the Gateway stopped, an `openclaw` task → FAILED with a not-dispatched reason, no RECOVERY_REQUIRED.
  Record task ids, events and timings for the report.

- [x] **Step 5: Restore defaults.** Stop native Core and the Gateway; `docker compose up -d postgres` (unpublished); leave enable flags as the operator wants them.

### Task 5: Documentation, review and commit

**Files:** `README.md`, `docs/INTEGRATIONS.md`, `docs/ADR/0008-subscription-cli-harness.md`, `docs/ENGINEERING_REPORT.md`, `docs/RESEARCH_AND_COMPATIBILITY.md`, `docs/THREAT_MODEL.md`.

- [x] **Step 1:** README native mode section (start order, inherited `DATABASE_URL`, Gateway start); INTEGRATIONS subscription paths with the three primary-source terms boundaries from the spec; ADR 0008 recording the CLI-harness decision and rejected options B and C; THREAT_MODEL rows for subscription login theft and OpenClaw operator-scope token; RESEARCH rows for Claude Code 2.1.x, Codex CLI, OpenClaw 2026.10.4 with live evidence; report integration table and §21 rows updated with Task 4 evidence.
- [x] **Step 2:** Run `npm run check`, live PostgreSQL suite, `npm audit --audit-level=high`, Python gates. Expected: all green.
- [x] **Step 3:** Fresh-context review of the branch diff since `bcbe124`; fix high and medium findings with tests.
- [x] **Step 4:** Commit; ask the operator before pushing.

## Implementation status — 2026-10-17

- Tasks 1–2 implemented, tested and committed. Follow-up fixes add safe mode, byte-accurate
  output bounds, pre-abort handling, organization-denial classification and explicit
  unsupported output-token-limit metadata. Vitest discovery is restricted to project tests.
- Task 3: exact OpenClaw version installed; deny-all agent and loopback/token/Responses
  configuration validated. System MSI execution was denied; the existing portable Node
  24.22.0 ZIP was freshly SHA256-verified and used instead (process PATH only). System Node
  stays 24.11.0. Gateway bootstrap/SQLite state ownership failure blocks the HTTP probes.
- Task 4: Codex ChatGPT login verified and approved Core task COMPLETED with durable events.
  Claude task was denied by organization 403; Gemini key absent. OpenClaw browser login
  completed by operator, but CLI failed on state maintenance; saved login, runtime tool
  denial, session logs, successful task and stopped-Gateway live classification are pending.
  Claude/OpenClaw/Gemini remain disabled; OPENCLAW_POLICY_VERIFIED remains false. Native
  processes stopped; PostgreSQL restored without host publication. No lock was deleted.
- Task 5: docs, independent review and repository gates finished. Review's Important token
  budget finding resolved through readiness outputTokenLimitEnforced:false and explicit
  docs; this does not implement a hard CLI token ceiling. No minor findings. npm run check:
  92 passed, 1 skipped; separate PostgreSQL test passed; Python 7/ruff/mypy passed; npm audit0.
  No push. Overall deployment success remains incomplete until the outstanding live gates pass.

Resumed 2026-10-17 (evening): all Task 3–4 live gates passed on native Windows. OpenClaw login
needs `--profile-id openai:default` (Windows import bug); `@openclaw/codex` installed; denial
verified beyond Responses output (code-mode `exec` isolate with no nested tools, Codex sandbox
read-only); OpenClaw, Claude Code and Gemini tasks COMPLETED; stopped Gateway FAILED not
dispatched. Claude Code now disables git-status and CLAUDE.md context. OPENCLAW_POLICY_VERIFIED=true.

Evidence: docs/ENGINEERING_REPORT.md and ignored artifacts/subscription-setup/.
Resume record: .superpowers/sdd/2026-10-17-subscription-providers-openclaw/progress.md.
