# JARVIS v1.0.0 — release prompt for the implementing agent

> How to use: paste everything below the line into your coding agent, started from the root
> of the `jarvis216` checkout on the operator's Windows laptop. Fill in the short
> **Operator inputs** block first; every field has a default the agent uses if you leave it
> blank.

---

## 0. Your role and the goal

You are the release engineer, test architect and desktop packager for **JARVIS**, a
local-first personal assistant made of: JARVIS Core (TypeScript, the only authority for
tasks, policy, approvals and records), an Electron desktop app (`apps/desktop`), a local
Python voice service (`workers/voice`), a Python Browser Use worker (`workers/browser`) and
adapters for Claude, Claude Code, Gemini, OpenRouter, NVIDIA, Codex, OpenClaw, n8n,
Windows-MCP and RSS news.

Ship **v1.0.0**. That means all four of these, done and proven:

1. **End-to-end tests for every meaningful combination** of configuration, permission,
   risk, language, plan shape, failure and platform. They are automated, run in CI where
   CI can run them, and are opt-in live suites where they need real credentials, a GPU or
   the Windows desktop.
2. **The first installable JARVIS desktop release**: a Windows installer that
   installs, launches, finds and supervises the local stack, upgrades and uninstalls
   cleanly. Then **install it on the operator's laptop**, carrying over all of the
   operator's existing data and configuration.
3. **Live verification on the operator's machine** of every gate that earlier reports
   left as "tested only", "not run" or "blocked". Each one must end live-verified or be
   honestly re-classified with the reason.
4. **Release engineering**: version 1.0.0 everywhere, changelog, updated documentation and
   evidence, a release CI workflow, a `v1.0.0` tag and a GitHub Release with the installer,
   checksums and SBOM. The tag and the release need the operator's explicit go-ahead.

Work in the phases below, in order. Do not skip a phase because it looks done. Re-run its
gate and record the result.

---

## 1. Operator inputs (fill in; defaults apply when blank)

| Input | Value | Default if blank |
| --- | --- | --- |
| Where the agent runs | | The operator's Windows 11 laptop, in the existing checkout |
| Checkout path (JARVIS home) | | `C:\Users\cenke\OneDrive\Desktop\jarvis216` (see §2.4 about OneDrive) |
| Working branch | | `release/v1.0.0`, cut from up-to-date `main` |
| May the agent push branches? | | Yes, to the working branch only |
| May the agent open a PR / merge to `main`? | | Open a PR: yes. Merge: no, the operator merges |
| May the agent create the `v1.0.0` tag and a Release? | | Draft Release only; the operator publishes it |
| Code-signing certificate | | None: ship unsigned, document the SmartScreen prompt |
| Install scope and folder | | Per user, no admin: `%LOCALAPPDATA%\Programs\JARVIS` |
| App ID / product name | | `local.jarvis.desktop` / `JARVIS` |
| Start with Windows | | Off by default; a toggle in Settings |
| Live provider tests allowed (spend quota) | | Only providers whose credentials already exist in `.env`; at most 50 OpenRouter calls a day |
| Claude Messages API key available? | | No (it was absent by design so far); the gate stays "blocked" |
| Windows Hello for HIGH approvals in v1 | | Ask the operator at checkpoint C4; default: not in v1, stays documented |
| Daily time window when the operator is present for live desktop/voice tests | | Ask at checkpoint C2 |

---

## 2. What you already know: the operator's setup (do not re-discover, verify)

Treat these facts as given, but **verify each one cheaply** before you rely on it, and
record any difference in the progress ledger (§4). Never print a secret value while you
verify; report only "set" or "unset".

### 2.1 Machine and toolchain

- Windows 11 Pro, native (Core does not run in WSL); Docker Desktop 29.8.2 with the WSL2
  backend. Time zone Europe/Istanbul. Languages: Turkish first, English second.
- Laptop: RTX 5070 Laptop GPU with 8 GB (Blackwell, sm_120, needs CUDA 12.8 wheels), Ryzen
  9 8945HX, 31 GB RAM. Windows Hello reports `Available`.
- Node: the **portable Node 24.22.0** in `.tools\node-v24.22.0-win-x64` (gitignored). System
  Node is 24.11.0, because the MSI install was denied. Put the portable one first on `PATH`
  for every command. The engine range is `>=24.11.0 <25`, and CI pins 24.22.0.
- Python 3.12.10 and `uv` 0.11 (CI pins 0.11.23). TypeScript 7.0.2, Biome 2.5.15, Vitest
  5.0.5, Electron 44.9.0, Playwright 1.64.1, esbuild 0.28.2.
- Git Bash quirk: prefix `docker exec` commands that pass container paths with
  `MSYS_NO_PATHCONV=1`. Watch CRLF in Python files (`.gitattributes` exists).

### 2.2 Ports and running services (do not disturb the operator's own)

| Port | Owner | Rule |
| --- | --- | --- |
| 5432 | The operator's **native Windows PostgreSQL** (not JARVIS) | Never stop, reconfigure or connect to it |
| 55432 | JARVIS PostgreSQL 18.3 published by `compose.dev.yaml` (operator data) | Real data. Tests never touch it |
| 2160 | The operator's JARVIS Core | Real data. Tests never touch it |
| 2161 / 55433 | Disposable dev Core and dev PostgreSQL (`jarvis-voice-pg`), settings in the gitignored `.env.voice-dev` | Tests and live dev checks go here. They were removed after the last run, so recreate them |
| 18789 | OpenClaw Gateway 2026.10.4 (native, about 60 s to start) | Start with `scripts/openclaw-native.ps1` |
| 8765 | Browser Use worker (native) | `scripts/browser-native.ps1` |
| 5678 | n8n 2.43.7 (Compose `automations` profile, container `jarvis-core-n8n-1`) | |

The dev runtime starts like this; the later `--env-file` wins (verify it):
`node --env-file=.env --env-file=.env.voice-dev dist/main.js`.

**A shell-inherited `DATABASE_URL`** (a remote Supabase pooler) has silently overridden
`.env` on this host before. Core now refuses non-local databases. Still, run
`Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue` in every new shell.

### 2.3 Accounts, providers and where their credentials live

Read `.env` only through code that reports presence. Never echo, log, commit or paste
values. Never read OAuth token files.

| Provider | State so far | Where the login lives |
| --- | --- | --- |
| Gemini API | Live-verified, free tier, `gemini-3.5-flash` | `GEMINI_API_KEY` in `.env` |
| Claude Code | Live-verified, subscription, CLI 2.1.281, model `sonnet`, `--safe-mode`, workdir `data/claude-code` | `claude auth login --claudeai` (operator's profile) |
| Claude Messages API (`claude`, `claude-live`) | Never live-verified: no API key, by design | `ANTHROPIC_API_KEY` (empty) |
| Codex | Live-verified natively, `CODEX_AUTH=chatgpt`, `gpt-5.6-sol`, HIGH approval per task | `data/codex-homes/jarvis` (isolated home), workspace `data/workspaces/jarvis` |
| OpenClaw | Live-verified natively, agent `jarvis-reader` on `openai/gpt-5.6-sol` via the `@openclaw/codex` plugin, `tools.deny=["*"]`, Codex sandbox `read-only`, `OPENCLAW_POLICY_VERIFIED=true` from denial probes | Operator profile; log in with `--profile-id openai:default` (without it, login fails on Windows) |
| OpenRouter (free) | Answered earlier: `dots-studio/dots-3-note-preview:free`, `nvidia/nemotron-3-super-120b-a12b:free`; about 50 requests a day | `OPENROUTER_API_KEY` |
| NVIDIA | Answered earlier: `openai/gpt-oss-20b` (about 3.7 s), `nvidia/nemotron-3-super-120b-a12b` (about 16 s) | `NVIDIA_API_KEY` |
| n8n | Both directions live on 2.43.7; the API-key client and the outcome-push example are not live | n8n volume `n8n-data`, `N8N_ENCRYPTION_KEY` |
| Browser Use 0.13.11 | Native DOM readback live on example.com; the container with egress controls is not live | `BROWSER_*` in `.env` |
| Windows-MCP 0.8.8 via `uvx` | 12 allowlisted tools, live-verified; PowerShell and Registry excluded; cold start 16.6 s, warm 3.4 s | No credentials. `ENABLE_DESKTOP=false` in the operator's `.env` today |
| RSS news | Google News TR feed live | `NEWS_FEEDS` |

### 2.4 The operator's data you must preserve and carry into v1

| Data | Location |
| --- | --- |
| Secrets and provider settings | `.env` (gitignored) and `.env.voice-dev` |
| Tasks, events, actions, conversation turns, memories, learning brain (experiences, skills), permissions and their audit, routing observations, outbox | PostgreSQL volume `postgres-data` (Compose project `jarvis-core`), published on 55432 |
| Voice print | `data/voice/operator.npy` (an embedding only, never audio) |
| Voice models | `data/voice/models/` (Piper `tr_TR-dfki-medium`, `en_GB-alan-medium`, ECAPA); Whisper large-v3 (about 3 GB) in the Hugging Face cache |
| Voice samples and the e2e fixture | `data/voice/samples/` (`e2e-tr.wav`, 16 kHz mono PCM) |
| Codex isolated home and workspace | `data/codex-homes/jarvis`, `data/workspaces/jarvis` |
| n8n workflows and credentials | Volume `n8n-data` |
| OpenClaw configuration and state | The operator's profile (`%LOCALAPPDATA%\OpenClaw`, and the OpenClaw config) |

The checkout sits under **OneDrive**. OneDrive sync can lock or partially sync
`node_modules`, `data/` and model files. Check whether `data/` and `.tools/` are excluded
from sync. If they are not, tell the operator at checkpoint C1. Do not move the checkout
yourself.

### 2.5 Voice and persona facts

- STT faster-whisper large-v3 on CUDA float16 (about 340 ms per short sentence); TTS Piper
  on CPU; speaker check with SpeechBrain ECAPA (192 dimensions); about 5.1 GB VRAM in use.
- Default speaker threshold 0.7 (`VOICE_SPEAKER_THRESHOLD`), never calibrated on the
  operator's real microphone. Filler after `VOICE_FILLER_SECONDS` (default 1.2).
- Measured end of speech → first generated audio: 2.8–4.75 s. The target is 2.5 s and **is
  not met**. Report honestly; do not tune the measurement.
- Persona: the film's JARVIS: calm, capable, dry wit, formal at first ("efendim"). The UI
  copy is Turkish. Voice never approves anything.

---

## 3. Non-negotiable rules

1. **Evidence classes.** Label every claim in reports and docs: **live-verified** (ran here
   against the real thing), **tested only** (automated, with fakes or fixtures), **not
   run**, or **blocked** (with the missing prerequisite). Fixture tests are never presented
   as live evidence. A compile or a green unit suite is never presented as runtime proof.
2. **Never weaken a gate to get green.** Do not skip, disable, quarantine or loosen tests.
   Do not lower coverage floors (lines 95, statements 93, functions 92, branches 84). Do not
   add lint suppressions to hide findings, and do not relax CSP, Electron isolation,
   Chromium sandboxing, risk floors, approvals or auth. If a test is flaky, find the root
   cause.
3. **Secrets.** No secret goes into git, logs, test output, screenshots, issue or PR text, or
   your messages. Grep the diff for token-shaped strings before every commit. Tests use
   generated throwaway secrets.
4. **The operator's data is sacred.** Tests use the dev runtime (2161/55433), disposable
   schemas, temporary `USERPROFILE`s and temporary `VOICE_DATA_DIR`s. Never run
   `docker compose down -v`. Never delete or overwrite `data/voice/operator.npy`, the
   `postgres-data` or `n8n-data` volumes, `.env`, Codex or OpenClaw state. Before anything
   touches real data (installing v1, migrating, enabling desktop actions), take the backups
   in Phase 0.
5. **Pinned versions stay pinned.** Do not upgrade dependencies unless something needs it.
   Any new dependency gets an exact version, its lockfile updated with the repo's own
   tooling (`npm install --package-lock-only --ignore-scripts`, `uv lock`), `npm audit
   --audit-level=high` clean, and a line in `docs/RESEARCH_AND_COMPATIBILITY.md`. Installs
   keep `--ignore-scripts`. Electron's binary comes from `node
   apps/desktop/node_modules/electron/install.js`, which verifies its checksum.
6. **Architecture rules stay enforced.** Layers run `core` ← `integrations` ← `services` ←
   `http` ← `app` ← entry points (`tests/architecture.test.ts`). Core is the only authority.
   Models propose; policies authorize; executors act; evidence verifies.
7. **Electron tests run sequentially** (`workers: 1`): app instances compete for the global
   Ctrl+Alt+J shortcut. Quit the operator's installed JARVIS before running desktop tests,
   or give tests their own `--user-data-dir` once the single-instance lock exists.
8. **Live desktop actions only with the operator present.** The operator has kept a
   Notepad window open that holds credentials. A typing step or a Snapshot/Screenshot could
   touch or capture it. Before any live Windows-MCP test, ask the operator to close every
   window with private content, then use a fresh, empty Notepad.
9. **Quota.** OpenRouter free gives about 50 requests a day. Pace live evals and use
   `PROVIDER_BUDGETS_JSON`. Ask before spending anything that costs money.
10. **Conventions.** Commit messages follow the existing style (`feat(scope): …`,
    `fix: …`, `test(e2e): …`, `ci: …`, `docs: …`). Write small, focused commits that each
    pass the gates. Docs are concise and evidence-classed. A significant decision gets an ADR
    (`docs/ADR/0018-…`). Never put an AI model name or model ID in commits, PRs, code or docs
    as authorship. Provider model IDs that are configuration are fine.
11. **Ask, don't guess**, at the checkpoints in §11 and whenever an action is destructive,
    outward-facing (push, tag, release, PR comment) or spends money.

---

## 4. Phase 0: orientation, safety and baseline

1. Read, in this order: `README.md`, `docs/ARCHITECTURE.md`, ADRs 0001–0017,
   `docs/ENGINEERING_REPORT.md` (all follow-ups),
   `docs/VOICE_DESKTOP_EVIDENCE.md`, `docs/ACTION_ENGINE_EVIDENCE.md`,
   `docs/INTEGRATIONS.md`, `docs/INTEGRATION_HUB.md`, `docs/THREAT_MODEL.md`,
   `docs/RECOVERY_RUNBOOK.md`, `apps/desktop/README.md`, `apps/desktop/DESIGN.md`,
   `workers/voice/README.md`, `.github/workflows/ci.yml`, `tests/e2e/harness.ts`,
   `tests/e2e/core.test.ts`, `apps/desktop/tests/*`. `graphify-out/GRAPH_REPORT.md` is
   an optional code map.
2. Create `docs/release/v1/PROGRESS.md`. This ledger is how you resume after a context
   reset: one table row per work item with its state, evidence link and next step. Update
   it at the end of every work item and commit it with the work.
3. Verify the environment facts in §2. Record versions, presence (not values) of each
   credential, Docker state, GPU visibility (`nvidia-smi`) and free disk space (Whisper and
   torch need several GB).
4. **Backups before anything else**, all to a folder outside OneDrive and outside the repo
   that the operator chooses at checkpoint C1:
   - `scripts/backup.ps1` (git bundle, verified).
   - `pg_dump --format=custom` of the operator's JARVIS database. Restore it into a scratch
     database, check row counts per table, then drop the scratch database. This is also the
     backup/restore drill the runbook lists as pending.
   - An encrypted copy of `.env`, and copies of `data/voice/operator.npy`, `.env.voice-dev`
     and the n8n volume (`docker run --rm -v n8n-data:/d …` tar).
   - Record checksums of every backup.
5. **Baseline gates**, all of them, with counts recorded:
   - `npm ci --ignore-scripts`; `npm run check:ci` (typecheck, lint with zero warnings,
     coverage with floors, build); `npm audit --audit-level=high`.
   - `npm run contracts`, then `git diff --exit-code schemas/`.
   - The PostgreSQL suites against the dev PostgreSQL: `npm run test:postgres`
     (`JARVIS_LIVE_POSTGRES_TEST=true`, `TEST_DATABASE_URL`) and `npm run test:e2e`
     (`E2E_DATABASE_URL`).
   - Desktop: `npm ci --prefix apps/desktop --ignore-scripts`, the Electron install
     script, `npm --prefix apps/desktop run typecheck`, `npm --prefix apps/desktop test`,
     and `npm audit --prefix apps/desktop --audit-level=high`.
   - Browser worker: `uv sync --project workers/browser --locked`, then ruff, ruff format
     check, mypy and unittest, exactly as in CI.
   - Voice: ruff, ruff format check, mypy and the unittest modules exactly as in CI, plus the
     full suite with the CUDA wheels on the laptop (`uv sync --frozen --directory
     workers/voice`, `python -m unittest discover -s tests`).
   - `npm run benchmark`, with numbers recorded.
   - The latest GitHub Actions run on `main` for all five jobs (typescript on Linux and
     Windows, postgres, desktop, python, voice).
6. Anything red in the baseline is fixed first, root-caused, with a regression test, in its
   own commit. Nothing in later phases starts on a red baseline.

**Gate 0:** backups verified, baseline green locally and in CI, ledger committed.

---

## 5. Phase 1: the end-to-end test matrix

### 5.1 Principles

- "Every combination" means: **exhaustive** where the space is finite and safety-relevant
  (permissions × actions × risk, auth × routes, privacy × trust, IPC validation), **pairwise
  (all-pairs) generated** where the full product explodes (provider topology × integration
  flags × language × load), and **property-based** (fast-check, already in the repo) for
  state machines and parsers. Write the generator. Commit the generated case table
  (`tests/e2e/matrix/*.cases.json` or equivalent) so each case is reviewable. Every case
  asserts Core's **records** (task states, events, action rows, audit), never model claims.
- Extend the existing harness (`tests/e2e/harness.ts`: `createCore()` with fake services
  over real HTTP and a fake Windows-MCP over real stdio). Do not build a second one. The
  only injected seam is executors.
- Each Core e2e scenario must pass on **PGlite and PostgreSQL 18.3**, and on **Linux and
  Windows**. CI covers Linux × both databases and Windows × PGlite. Run Windows ×
  PostgreSQL on the laptop against the dev PostgreSQL and record it.
- Keep the suite fast. If the matrix outgrows the 15 s default per test or CI time, split
  it into shards. Do not drop cases.
- Opt-in live suites use explicit flags and skip with a clear reason when the flag is
  absent. Existing flags: `JARVIS_LIVE_POSTGRES_TEST`, `E2E_DATABASE_URL`, `JARVIS_E2E`,
  `JARVIS_LIVE_BROWSER_TEST`. Add new ones in the same style (`JARVIS_LIVE_PROVIDERS`,
  `JARVIS_LIVE_DESKTOP`, `JARVIS_LIVE_N8N`, `JARVIS_LIVE_OPENCLAW`,
  `JARVIS_INSTALLER_TEST`) and document all of them in one table in the README.

### 5.2 Dimensions and required cases

**A. Platform × database:** {Linux, Windows} × {PGlite, PostgreSQL 18.3}, for the whole
`tests/e2e` suite.

**B. Provider topology** (Core configuration):
- No provider enabled: Core starts, `/readyz` reports it, and a turn fails gracefully with a
  definite error rather than a hang or crash. The voice client speaks its apology.
- Each conversation provider alone: `gemini-live`, `claude-live`, `claude-code`, `or-*`,
  `nv-*`.
- Full chains with fallback on every classified failure: 429 `rate-limited`, 401/403
  `authentication-required`, 404 `permanent`, 5xx `provider-unavailable`, network
  `transient` (never-dispatched rule), empty or `finish_reason: length` `invalid-response`,
  Claude 529, `max_tokens` or context-window truncation (may fall back), and safety
  `refusal`, which is **final and never shopped to another provider**. Also: refusal
  fallback on and off (`CLAUDE_REFUSAL_FALLBACK`), with the served model recorded.
- A spent budget (`PROVIDER_BUDGETS_JSON` calls and tokens, cached input counted) skips
  that provider. An open circuit (three outage-class failures, 60 s) skips it. After a
  restart both are rebuilt from `provider_observations`. Measured demotion of a slow or
  failing provider works (adaptive-v1).
- Integration flags, pairwise over {desktop, news, browser, openclaw, n8n, codex} × on/off:
  the conversation catalog lists **only enabled** actions, and a proposal for a disabled one
  is refused (`NO_COMPATIBLE_PROVIDER` / `policy-denied`). Misconfiguration refuses to start
  and names the setting without its value. Cover: placeholder `REPLACE_` secrets, non-local
  `DATABASE_URL`, OpenClaw without `OPENCLAW_POLICY_VERIFIED=true`, Codex without
  `CODEX_ISOLATION_VERIFIED=true` or with paths outside `data/workspaces` or
  `data/codex-homes`, and a bad `N8N_WORKFLOWS_JSON`.

**C. Privacy × trust:** privacy {public, personal, private, local-only} × provider
{external trusted (in `JARVIS_PRIVATE_PROVIDERS`), external untrusted, local} → the expected
risk floor and approval (private + external untrusted → HIGH exact approval). Changing the
trust list changes the approval hash.

**D. Permissions: exhaustive, table-driven.** All **24 catalog actions** (`packages/action-engine/src/catalog.ts`; if the count differs
when you read it, the file wins):

| Risk | Actions |
| --- | --- |
| LOW | `app.open`, `app.focus`, `window.list`, `screen.describe`, `media.key`, `clipboard.read`, `file.list`, `browser.read`, `browser.read_many`, `news.brief` |
| MEDIUM | `app.close`, `ui.click`, `ui.type`, `key.shortcut`, `clipboard.write`, `file.move`, `file.copy`, `file.rename`, `file.mkdir`, `web.open`, `memory.save`, `memory.forget` |
| HIGH | `agent.delegate`, `automation.invoke` |

Cross them with:
- mode {ask, allow, deny};
- grant {permanent, timed and active (1 h / 8 h / 1 d), timed and expired};
- presets {guarded (LOW allow, others ask; the shipped default), trusted (HIGH ask, others
  allow), autonomous (all allow), custom}, including a preset with an expiry;
- path {voice plan, plan card approve by hash, the HIGH second exact action approval from the
  desktop, CLI `approve`, API}.

Expected results:
- `deny`: hidden from the prompt, refused by the gateway even when a model proposes it,
  and refused **mid-plan** when revoked during a run.
- `allow`: runs without a card, recorded `approval.granted` `via: "standing-grant"`.
- `ask`: a card.
- HIGH with `ask`: the plan tap **and** a separate exact action approval.
- Expired grant: back to `ask`.

Every change is in `GET /v1/permissions/audit`.

**E. Plan lifecycle:** single step; multi-step with mixed risks; all steps allowed (runs at
once); candidate choice (several matches → numbered panel → tap, or a spoken ordinal:
"ikincisi", "ilkine tıkla", "sonuncusu", "the second one", "3rd"; out of range; a learned pick
reused for the same situation); replan with a fresh Snapshot summary (window and element
names only, never field values); a step failing mid-plan; low confidence (< 0.5) turned into a
confirm question that the next turn answers. Approve by hash: correct; wrong; stale after the
plan changed; reused; after the 2-minute expiry. Reject (Esc). Cancel by voice ("dur",
"iptal", "stop"), by UI and by API. Status question ("durum ne?", "what's the status") answered
from records without a model call. Each task outcome: COMPLETED, FAILED, CANCELLED, BLOCKED
(resume), and RECOVERY_REQUIRED (reconcile). Screen text is replaced by a marker once used.

**F. Conversation:** language {tr, en, mixed} × addressing {name present with Turkish
spelling variants, follow-up window with a voice print, no print (name required),
unaddressed} × intent {chit-chat, news brief, memory save or forget, status, stop, ordinal
choice, correction "hayır, …" (weakens what was learned), the dangerous set ("her şeyi sil",
`format c`, card payments, passwords, sending messages → a refusing reply, never a plan)} ×
load {idle, background worker busy (the interactive lane answers anyway)} × model behaviour
{valid JSON, malformed JSON → one repair, timeout → 504 `TURN_TIMEOUT`, failure → 502
`TURN_FAILED` and fallback, refusal}. Also: the stable-first prompt and its cache
breakpoint; a slow plan acknowledged at once with where it looks and roughly how long; "Tamam"
after a page read or an agent result giving a short spoken summary (private providers only);
transcript export, deletion and the 30-day purge.

**G. Memory:** save, forget one, forget all, the prompt limit (newest notes, ≤ 3000
characters), and survival across conversation deletion and purge. Refuse notes holding
passwords, PINs, IBANs, card numbers or key-shaped tokens, in Turkish and English, with
near-miss negatives (a date that looks like a PIN in context, an IBAN-like product code).

**H. Learning brain:** learning {on, off} × reflexes {on, off} × embeddings {off, gemini
(fake endpoint)} × restart {no, yes}; consolidation, decay, forget one skill, reset all;
reflexes skip the model for practised phrases; a failing brain store never fails a turn.

**I. n8n:** an exhaustive ingress auth matrix of {n8n token, operator token, none, wrong} ×
{n8n route, every operator route}. Idempotency: same event and payload → same task; same
event with a changed payload (including a retry that re-evaluates `$now`) → conflict, fail
closed; new event → new task. Timestamps with `Z` and `+03:00`. Core → n8n: both approvals
present, only the plan tap, only the action approval, a replayed `taskId` (no re-execution),
wrong token (403), timeout (uncertain → reconcile). Outbox: delivered; 5xx retried with
backoff from 2 s to 5 min; dead-lettered after 12 attempts; a restart mid-delivery;
`/v1/metrics` counts; only verified completions carry `result`. Queue limits: 429
`QUEUE_FULL` above 100 per non-operator principal and 1000 in total.

**J. Failure injection:** PostgreSQL killed mid-transaction (`pg_terminate_backend`) and
down at startup; SIGTERM during in-flight work (drain up to 20 s, then quarantine); a hard
kill after intent → RECOVERY_REQUIRED → reconcile with evidence; lease expiry; cancel
racing an executing action (cancel of RECOVERY_REQUIRED → 409 `RECONCILIATION_REQUIRED`); a
late worker result rejected by the fence; the Windows-MCP child crashing (restarted once,
the running step uncertain and not replayed); browser worker 400, 429, 503, timeout,
truncated NDJSON and an old plain-JSON worker; OpenClaw down (FAILED, not dispatched); n8n
down; Core down while the desktop runs (visible error, then recovery); the SSE stream dropping
(reconnect and plan restore); the voice service crashing → **Yeniden dene** restarts it.
That last path is implemented but has **no test yet**, so add one.

**K. Security:** an auth sweep of every route (only `/healthz` is open); the rate limit;
constant-time token comparison; the operator token never reaches the renderer (dev and
**packaged** build); IPC fuzzing of every `ipcMain` channel: bad ids, hashes, ordinals 0 and
101, non-integer numbers, wrong sender (overlay calling main-only channels), `plans:open` with
`http:`, `javascript:`, `file:`, userinfo URLs and an https URL not among the current news
items; CSP violations; blocked navigation, `window.open` and `<webview>`; file-action path
containment (`..`, junctions, 8.3 aliases, UNC paths, another drive, outside
`JARVIS_FILE_ROOTS`); news SSRF (private-address thumbnails, redirects to private addresses,
over 200 KB, wrong MIME type); secret redaction (grep every log and test artifact for the
generated tokens); and the Electron fuses of the packaged build (§7).

**L. Desktop UI (Playwright `_electron`):** keep all existing specs. Add a **desktop ↔ real
Core** e2e suite: the dev-built Electron app against a Core booted by the harness with fake
models. Today the desktop specs use a fake Core. It covers plan cards, approval by Enter and
by tap, Esc reject, the HIGH second approval, candidate panels, news panels and opening an
article, live progress lines and the progress bar, Settings (all four tabs: Genel, İzinler,
Öğrenme, Hafıza, with arrow-key navigation, presets, per-action modes, timed grants, learning
switches, consolidate, forget skill, reset with confirmation, memories), conversation
export and delete with confirmation, and enrollment start/finish (409 below 25 s), cancel and
delete. Also add:
- window sizes 700×560, 1080×760, 1440×900 and 1920×1080 at scale factors 1, 1.25, 1.5 and 2;
- Turkish glyphs (ğ ü ş ı ö ç İ) without clipping;
- keyboard-only operation and visible focus;
- accessible names and roles;
- reduced motion;
- 4.5:1 contrast;
- overlay mirroring and pointer pass-through outside cards;
- tray menu items (Göster, Dinlemeyi durdur/başlat, Çık);
- the close-to-tray behaviour;
- the single-instance lock, About/version, first-run setup and start-with-Windows (all new
  in §7);
- every startup error path: env missing, token missing, invalid port, Core unreachable,
  `uv` missing, voice start timeout, no CUDA.

Save screenshots of every state to the gitignored `artifacts/`. Commit only the curated set
under `apps/desktop/tests/screenshots/`.

**M. Voice:** the full Python suite on the laptop with CUDA. The GPU e2e (`JARVIS_E2E=1`) in
**Turkish and English**. Generate `data/voice/samples/e2e-en.wav` (16 kHz mono) the same way
as the Turkish one, and label both as synthetic speech. Cover enrollment from the fixture
into a temporary directory, duplex announcements (queued, never over the operator,
coalesced, expiring after 12 s, outcomes always spoken), the filler, a stop phrase during
speech and stale-reply suppression. Measure latency over **at least 20 turns per language**
and report p50/p95 for STT, Core, synthesis and first generated audio against the 2.5 s
target.

**N. Browser worker:** unit tests, the real-socket tests, the live smoke
(`JARVIS_LIVE_BROWSER_TEST=true`), a URL off the allowlist, a redirect off the allowlist, 1–4
pages, 5 pages rejected, and NDJSON progress.

**O. Installer and packaged app** (after Phase 3 builds them): fresh install, first launch,
a second launch (single instance), upgrade from a `1.0.0-rc.N` build to `1.0.0` with settings
and data kept, uninstall (user data kept unless the operator ticks removal), silent mode,
shortcuts, and a launch from the Start menu (whose `PATH` differs from a dev shell). On CI:
build and run a silent install and uninstall on `windows-latest` behind
`JARVIS_INSTALLER_TEST`.

### 5.3 CI changes

Add a **Windows desktop job** (Playwright Electron on `windows-latest`, no xvfb), the
matrix shards, and the installer build-and-smoke job. Keep every existing job. Pin new
actions by version as the file already does. Every push on the working branch must end
green; red CI is fixed before new work.

**Gate 1:** the whole matrix runs and is green locally (both databases, Windows) and in CI;
the case tables are committed; the evidence table in the ledger lists every case family with
its class.

---

## 6. Phase 2: live verification on the operator's machine

Do each item with the operator present when it says so. Record the date, versions, task IDs
(not content), timings and the outcome in the evidence documents.

1. **Dev runtime:** recreate `jarvis-voice-pg` (55433) and the dev Core (2161) from
   `.env.voice-dev`, without touching 2160/55432.
2. **Providers** (`scripts/probe-free-models.ts`, plus one Core task each through the
   dev Core): Gemini, Claude Code, OpenRouter, NVIDIA, Codex (HIGH approval), and the Claude
   API if a key was provided (otherwise it stays **blocked**). Remove any configured free
   model that no longer answers from the operator's `.env` **only with the operator's
   consent**.
3. **OpenClaw:** start the Gateway, then **re-run the denial probes** (random canary file;
   shell, file and web probes; explicit `exec`/`wait`) before trusting
   `OPENCLAW_POLICY_VERIFIED`. After that: an approved delegate task COMPLETED, and a stopped
   Gateway giving FAILED `provider-unavailable`.
4. **n8n:** the roundtrip example, the Core-callee example (replay deduplication, wrong
   token 403), and for the first time **live**: the outcome push
   (`examples/n8n/jarvis-task-events.json`) and the API-key client (`X-N8N-API-KEY`
   discovery and `waitExecution`). Use an owner API key only if the operator creates one.
5. **Browser worker:** native live readback of 1 and of 4 allowlisted pages, with page-by-page
   narration reaching the desktop.
6. **Intent eval:** `npx tsx --conditions=jarvis-source --env-file=.env
   scripts/eval-intents.ts`, paced within quota. First **extend the eval set** with rows for
   `memory.save`, `memory.forget`, reflexes, corrections and status questions in Turkish and
   English. Then **replace the `EVAL_RESULTS` placeholder** in
   `docs/ACTION_ENGINE_EVIDENCE.md` with per-provider accuracy, intent-JSON rate and
   latency.
7. **Desktop actions through voice** (operator present, private windows closed,
   `ENABLE_DESKTOP=true` and `ENABLE_NEWS=true` **in the dev env only**): open Notepad, type
   and read back; close with the unsaved-changes dialog (card, then tap); open Spotify and
   pause (LOW, no card); "dur" mid-run; today's news as panels and a spoken brief; a
   candidate choice by voice; a file move inside `JARVIS_FILE_ROOTS`; an action refused
   because Settings set it to deny.
8. **Voice with the real microphone** (operator present): recognition accuracy in Turkish
   and English, rejection of TV or other voices, calibration of `VOICE_SPEAKER_THRESHOLD`
   (record false accepts and rejects at 0.6/0.65/0.7/0.75/0.8, then let the operator
   choose), the operator's choice of voice by ear, perceived latency at the speakers, and
   overlay pointer behaviour on the real Windows desktop.
9. **Learning, memory and permissions live:** a reflex forms after practice and survives a
   Core restart; a memory note is saved and forgotten by voice; a timed grant expires.

**Gate 2:** every former "tested only / not run" item in the three evidence documents is
now live-verified or re-classified with its reason. Nothing is silently dropped.

---

## 7. Phase 3: the v1 desktop product

Today the desktop runs only from a dev checkout (`npm --prefix apps/desktop start`). These
**known blockers** must be fixed for a packaged app:

- `main.ts` finds the voice service through `repoRoot: resolve(__dirname, "../../..")` and
  the voice data through `../../../data/voice`. Inside a packaged `app.asar` these paths
  point nowhere. Replace them with a configured **JARVIS home** (the checkout), stored in a
  small config file under the app's `userData` (for example
  `%APPDATA%\JARVIS\config.json`). It holds **paths only, never tokens**. The `.env` stays in
  the JARVIS home and is still read only by the main process.
- The voice service starts with a bare `uv` from `PATH`. A Start-menu launch does not get
  the dev shell's `PATH`, so resolve `uv` (and later `docker` and the portable `node`) to
  absolute paths during first-run setup, and show a clear error when one is missing.
- The tray icon is an SVG passed to `nativeImage.createFromBuffer`. Electron's `nativeImage`
  decodes PNG and JPEG (and ICO on Windows), not SVG, so on Windows the tray icon is most
  likely empty. Verify this, then ship real assets: a multi-size `.ico` (16–256) and PNG
  variants, in the existing visual language (the three concentric mint rings on stone, see
  DESIGN.md).
- There is no single-instance lock, no version display, no autostart option and no
  first-run flow.

Build these, test-first where testable:

1. **Packaging:** `electron-builder` with an NSIS per-user installer (or a researched
   alternative; record the choice in ADR 0018). Exact version pinned and audited. Include
   only `dist/` and `package.json`: the renderer is already bundled by esbuild, so check what
   runtime `node_modules` are really needed. Produce `JARVIS-Setup-1.0.0.exe`, `latest.yml`
   (only if updates are configured) and `SHA256SUMS.txt`, plus a CycloneDX SBOM (`npm sbom
   --sbom-format cyclonedx`) for root and desktop.
2. **Electron hardening of the packaged build:** keep `contextIsolation`, `sandbox`,
   `nodeIntegration: false`, the CSP, navigation and window-open blocking, and the
   permission handlers (microphone only, audio only, main window only). Set **fuses**:
   `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off,
   `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on,
   `OnlyLoadAppFromAsar` on, cookie encryption on. Add a test that reads the fuses of the
   built binary.
3. **Identity:** the app ID from §1, product name `JARVIS`, version from `package.json`
   via `app.getVersion()`, the icon, the AppUserModelID set for notifications, and an
   **About** line in Settings → Genel showing the desktop version, Core's version (add it
   to `/readyz`, authenticated) and the voice service version.
4. **Single instance:** `app.requestSingleInstanceLock()`. A second launch shows and
   focuses the first window. Tests pass their own `--user-data-dir` so they never collide
   with an installed copy.
5. **First-run setup** (Turkish UI, matching DESIGN.md): pick or confirm the JARVIS home;
   check that the `.env` is there and has `PORT` and `JARVIS_TOKEN` (presence only); check
   Docker, `uv`, the portable Node, the GPU and free disk; check that the voice models are
   present or offer to fetch them with progress; test Core `/healthz` and an authenticated
   `/readyz`; finish with a summary that names exactly what is missing and the next step.
   Re-runnable from Settings.
6. **Local stack supervision** (choose and record in ADR 0018; default as follows): the
   desktop main process, or a small launcher it owns, starts what is not already running, in
   order: the JARVIS PostgreSQL via `docker compose -f compose.yaml -f compose.dev.yaml up -d
   postgres` → **native** Core (`dist/main.js` with the portable Node, `--env-file` of the
   JARVIS home, inherited `DATABASE_URL` cleared) → the voice service → optional integrations
   through the existing scripts, behind toggles. Core must run natively, not in Compose:
   Windows-MCP is a stdio child of Core and must live in the operator's desktop session, and
   Compose Core cannot reach the loopback Gateway or the subscription CLIs. Start nothing
   twice: detect an already-running Core on the configured port and attach to it. Never stop
   services the desktop did not start. On quit, stop only the processes it owns, with Core's
   graceful drain, and kill their process trees on Windows (`taskkill /T`), as `voice.ts`
   already does.
7. **Start with Windows:** off by default; a Settings toggle using
   `app.setLoginItemSettings`; when on, start hidden to the tray.
8. **Logs:** main-process and supervisor logs under `userData\logs` with size rotation;
   numeric timings only; tokens, transcripts and memory text never logged (redaction test).
   Add an **"open log folder"** button in Settings.
9. **Updates:** no silent auto-update in v1 unless the installer is signed. Default: a manual
   upgrade by running the new installer over the old one, which keeps user data. Document
   it.
10. **Uninstall:** removes the app. It keeps the JARVIS home, `data/`, `.env`, the Docker
    volumes and `userData`, unless the operator explicitly ticks a separate "also remove app
    settings" option, which still never touches the JARVIS home or the volumes.
11. **Licensing and notices:** the repo has **no LICENSE file**. Ask the operator at
    checkpoint C4 which license, or "proprietary, all rights reserved". Generate
    `THIRD_PARTY_NOTICES` for everything shipped or downloaded: Electron, Inter and EB
    Garamond (OFL), Phosphor icons, the Pipecat client, and the voice models (Whisper, Piper
    voices, ECAPA). **Check each model's license** and flag any non-commercial or
    share-alike terms to the operator. Credit the design-token source named in DESIGN.md.
12. **Threat model update:** installer and DLL search order, the config file's write
    permissions, the supervisor's child environments (allowlist only, as `voice.ts` does),
    and unsigned-binary risk. Add these to `docs/THREAT_MODEL.md`.

**Gate 3:** the packaged app passes the full desktop suite (run against the built executable,
not only the dev build), the installer smoke passes on CI, the fuse test passes, and the
redaction test passes.

---

## 8. Phase 4: install v1 on the operator's laptop

Operator present (checkpoint C3).

1. Confirm the Phase 0 backups exist and are fresh, or take new ones.
2. Quit any dev-run desktop. Leave the operator's Core, PostgreSQL, OpenClaw and n8n as they
   are.
3. Build a release candidate (`1.0.0-rc.1`) from the working branch, install it, and run
   first-run setup against the **real** JARVIS home. The app must attach to the existing
   Core on 2160, or start it, and reuse every existing piece of data:
   - the voice print is recognised (enrollment flag true);
   - memories, permissions with their audit, learned skills and conversation history appear
     in Settings exactly as before (compare counts with the Phase 0 dump);
   - provider routing works with the existing `.env`;
   - Core migrations run forward on the existing database without loss (row counts per
     table before and after).
4. Run the **operator acceptance script** (§10) by voice, in Turkish and English.
5. Upgrade `rc.1` → final `1.0.0` with the installer, and re-check the data.
6. Reboot test: with "Start with Windows" on, JARVIS appears in the tray after login, the
   stack comes up in order, and the first spoken turn works.
7. Uninstall test on a **separate Windows user account or a VM**, not on the operator's
   main install, unless the operator asks.

**Gate 4:** v1.0.0 installed on the laptop, the acceptance script passed with the operator,
data verified intact.

---

## 9. Phase 5: release engineering

1. **Versions to 1.0.0:** root `package.json` (`jarvis-core`), `apps/desktop/package.json`,
   `packages/action-engine`, `packages/brain`, `packages/integration-hub`,
   `workers/voice/pyproject.toml` and `workers/browser/pyproject.toml`. Regenerate
   `package-lock.json` (both) and `uv.lock` (both) with the tools, and confirm that `--locked`
   and `--frozen` still pass with **no** dependency changes. Expose Core's version at
   `/readyz`. Leave `protocolVersion` and the published schema versions alone unless a
   contract changed; if one did, regenerate `schemas/` and explain why.
2. **`CHANGELOG.md`** (Keep a Changelog), written from the git history and grouped by
   milestone: M1 voice desktop; memory; M3 actions and plans; adaptive routing, circuits and
   budgets; n8n outbox; permissions; learning brain; duplex conversation and live progress;
   hardening and layered modules; v1 packaging and the e2e matrix. Add a **Known limitations**
   section copied honestly from the evidence.
3. **Docs:**
   - `README.md`: drop the stale "No frontend is included by design" and "makes no
     production-readiness claim" wording only as far as the evidence supports; add the
     install section, the opt-in test flags table and the v1 scope.
   - `apps/desktop/README.md`: it still says long-term memory is a later milestone; fix
     that, and add the installer, first run, autostart, logs, upgrade and uninstall.
   - `docs/ENGINEERING_REPORT.md`: a "v1.0.0 release" section with the gate table, test
     counts per suite, coverage, the matrix summary, live evidence and remaining risks; the
     §21 acceptance matrix refreshed; §9's "CI itself was not run" corrected.
   - `docs/VOICE_DESKTOP_EVIDENCE.md` and `docs/ACTION_ENGINE_EVIDENCE.md`: the new live
     results.
   - `docs/RECOVERY_RUNBOOK.md`: the restore drill result and the installer recovery steps.
   - **ADR 0018**: packaging, supervision, first run, updates and uninstall data policy.
   - `docs/release/v1/RELEASE_CHECKLIST.md`: the repeatable checklist used for this release.
4. **Release workflow** `.github/workflows/release.yml`: on a `v*` tag, on `windows-latest`,
   run the full gates, build the installer, generate the SBOM and `SHA256SUMS.txt`, run the
   installer smoke, and upload everything to a **draft** GitHub Release. It needs `contents:
   write` and nothing broader. Signing steps are skipped unless signing secrets exist.
5. **Independent review before tagging:** run a fresh-context review of the full diff since
   the last release point (a subagent with no session history, if your tooling has one,
   otherwise a careful adversarial self-review). Focus on correctness, security (secrets,
   IPC, supervisor, installer) and test honesty. Fix every high or medium finding with a
   regression test and record the review in the engineering report, as the §23 review did.
6. **PR and tag** (checkpoint C5): open a PR from the working branch to `main` with a
   summary, the gate table and the evidence links. After the operator merges, tag `v1.0.0`
   on the merge commit, let the workflow build the draft Release, then attach the release
   notes (the changelog section and the known limitations). **The operator publishes it.**

**Gate 5:** a draft Release exists for `v1.0.0` with the installer, checksums and SBOM,
built by CI from the tag; the docs are updated; the ledger is closed.

---

## 10. Operator acceptance script (run by voice in Phase 4)

Run each line in Turkish, and the starred ones in English too. Record pass or fail and
latency.

1. "Jarvis, kendini kısaca tanıtır mısın?" *: an in-character reply.
2. Without the name and without the follow-up window, speech is ignored; with a voice print,
   the follow-up within 8 s is accepted.
3. "Jarvis, bugünün haberleri ne?" *: news panels with thumbnails where the feed has them;
   a tap opens the default browser.
4. "Jarvis, not defterini aç ve 'merhaba' yaz": open runs at once; typing follows the
   permissions (a card under guarded).
5. "Jarvis, not defterini kapat" with unsaved text: a card, Enter approves; the save dialog
   is handled as planned.
6. "Jarvis, Spotify'ı aç ve durdur" *: LOW, no card.
7. A multi-page read: the acknowledgement at once, page-by-page narration, the live line and
   bar on the card, the outcome spoken.
8. "Durum ne?" during that work, then "dur" *: the status from records, then a cancel.
9. A candidate choice: "ikincisi" / "the second one".
10. "Annemin doğum günü 3 Mayıs, hatırla"; later "bunu unut" *.
11. "Şifrem 1234, hatırla": refused.
12. "Her şeyi sil" / "format c": a refusal reply, no plan.
13. A HIGH integration (agent or n8n): the plan tap **and** the separate approval; with
    Settings set to allow, the standing grant appears in the audit.
14. Settings: switch the preset, set a timed grant, forget a skill, consolidate, export and
    delete conversations (confirmed), voice print re-enrol and delete (confirmed, on a
    disposable print only).
15. Ctrl+Alt+J toggles listening; close to tray; the overlay shows cards while hidden; **Çık**
    quits and stops only the processes JARVIS owns.

---

## 11. Checkpoints: stop and ask the operator

- **C1 (Phase 0):** the backup destination; whether `data/` and `.tools/` are excluded from
  OneDrive; the window when the operator is present.
- **C2 (Phase 2):** before live provider runs that spend quota; before the OpenClaw probes;
  before enabling desktop actions (private windows closed?); before any `.env` change.
- **C3 (Phase 4):** before installing on the laptop and touching the real data.
- **C4 (Phase 3/5):** the license; Windows Hello for HIGH in v1 or not; code signing;
  removing dead free models from `.env`.
- **C5 (Phase 5):** the PR, the merge (the operator does it), the tag, and publishing the
  Release.

At each checkpoint, give a short summary: what is done, the evidence, the decision you need
with your recommendation, and what happens next.

---

## 12. Definition of done for v1.0.0

Release-blocking:

- [ ] All CI jobs green on the release commit: typescript (Linux with coverage floors,
      Windows), postgres + e2e, desktop (Linux and Windows), python, voice, matrix shards,
      installer smoke.
- [ ] Zero lint warnings; `npm audit --audit-level=high` clean for root and desktop; no
      schema drift; architecture test green.
- [ ] The e2e matrix in §5 implemented and green, with committed case tables; the
      permissions × actions table exhaustive; the voice-restart test added.
- [ ] Backups taken and the restore drill done.
- [ ] The packaged app passes the desktop suite; fuses verified; no token in the renderer or
      the logs; the tray icon renders on Windows; single instance, first run, About, logs and
      autostart work.
- [ ] v1.0.0 installed on the operator's laptop with all existing data intact; the acceptance
      script passed.
- [ ] Every live gate classified; `EVAL_RESULTS` filled; evidence docs, README, CHANGELOG,
      ADR 0018, THREAT_MODEL and the runbook updated.
- [ ] Independent review done; high and medium findings fixed with tests.
- [ ] A draft GitHub Release `v1.0.0` with the installer, `SHA256SUMS.txt` and the SBOM,
      built by CI from the tag.

Not release-blocking (record as known limitations unless done):

- Claude Messages API live (no key); browser worker container with enforced egress; separate
  PostgreSQL migration and runtime roles; money-denominated budgets; authoritative
  read-after-write verifiers per integration; Windows Hello for HIGH; code signing and
  auto-update; the voice latency target of 2.5 s; Gemini embeddings and provider cache-hit
  rates if quota does not allow.

---

## 13. Never

- Present fixture results as live, or a skipped test as passed.
- Touch the operator's PostgreSQL on 5432, or run tests against port 2160 or 55432.
- Run `docker compose down -v`, delete volumes, or overwrite `operator.npy` or `.env`.
- Print, log or commit a secret, or read OAuth token files.
- Disable Chromium or Electron security, the CSP, auth, risk floors or approvals "to make it
  work".
- Let voice approve anything, or let a model's claim stand in for Core's record.
- Push to `main`, merge, publish a Release or change `.env` without the operator's yes.
- Upgrade pinned dependencies without need, or run install scripts.
- Run Electron tests in parallel, or alongside the installed app without isolation.
- Leave CI red at the end of a work session.

Start with Phase 0. Your first message back should be the verified environment summary, the
baseline gate table and the checkpoint C1 questions.
