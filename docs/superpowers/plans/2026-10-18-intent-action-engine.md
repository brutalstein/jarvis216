# Intent and Action Engine (M3 cycle 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spoken TR/EN commands become catalog-typed plans that Core approves, executes on this
PC through Windows-MCP or RSS, verifies by observation and narrates; news appears as HUD panels.

**Architecture:** A pure package `packages/action-engine` (catalog, intent parsing, guards,
grounding, step bindings, news, narration, MCP stdio adapter) used by Core. Core owns every model
call (as tasks), plans, approvals, executors, SSE; Desktop renders cards and panels; the voice
service speaks announcements.

**Tech Stack:** TypeScript (Node 24, ESM), Zod 4.6.7, `@modelcontextprotocol/client` 2.3.1
(test: `@modelcontextprotocol/server` 2.3.1), `fast-xml-parser` 5.11.2, Vitest, fast-check,
pglite, Fastify 5, Electron + Playwright, Python 3.12 + Pipecat (voice), Windows-MCP 0.8.8 via uvx.

**Spec:** `docs/superpowers/specs/2026-10-18-intent-action-engine-design.md`

**Deviations from spec (decided while planning):**
- No `ModelPort` inside the engine: Core makes every model call as a recorded task; the engine
  exposes prompt builders and parsers. Fewer moving parts, every dispatch stays a Core action.
- Ambiguous grounding is resolved by tapping a candidate (the tap approves the shown
  continuation). Voice ordinals ("ikincisi") are deferred: voice can never approve, so they would
  need a second tap anyway.

## Global Constraints

- The engine imports nothing from `src/`; Core imports it as `@jarvis/action-engine`.
- Risk comes only from the catalog; HIGH actions, PowerShell, Registry, payments, passwords are absent.
- Voice never approves; voice may cancel.
- Screen content (snapshot text, candidates, window titles) reaches only `claude-code` with privacy `private`, never Gemini/free models.
- Windows-MCP: `uvx windows-mcp@0.8.8 serve`, env `ANONYMIZED_TELEMETRY=false`, `WINDOWS_MCP_TOOLS=App,Click,Type,Scroll,Shortcut,Snapshot,Screenshot,FileSystem,Clipboard,Wait,WaitFor,ControlStatus`, desktop gate policy `balanced`.
- File roots: OneDrive Desktop, Documents, Downloads (`JARVIS_FILE_ROOTS` overrides); real-path containment.
- Limits: plan ≤ 8 steps; step 15 s; approval window 2 min; execution window 2 min after approval; LOW-only reply wait 5 s; thumbnails ≤ 200 KB JPEG/PNG/WebP.
- Model `say` is discarded for plans; spoken outcomes come from templates over Core records.
- Persisted text (code, comments, docs, commits) is plain English; spoken templates are TR/EN.

## Review Focus

- Localised app names from STT ("not defteri", "hesap makinesi", "spotifay") must open the right app → alias table test in Task 3.
- A new spoken command while a plan awaits approval must cancel the old plan and remove its card → test in Task 8.
- Core restart with plans awaiting approval or running must converge (expired approvals cancel, statuses follow tasks) → test in Task 8.
- A plan with 0 steps, > 8 steps or a HIGH/unknown action from a jailbroken model must be rejected whole → test in Task 2.
- A feed returning HTML, huge bodies or malformed XML must be skipped, not crash the plan → test in Task 6.

---

### Task 1: Workspace and catalog

**Files:**
- Create: `packages/action-engine/{package.json,tsconfig.json,vitest.config.ts}`, `packages/action-engine/src/{index.ts,types.ts,catalog.ts}`
- Modify: `package.json` (workspaces, scripts), `tsconfig.json` (`customConditions: ["source"]`, include `packages/*/src`, `packages/*/tests`), `vitest.config.ts` (`resolve.conditions: ["source"]`, include `packages/*/tests/**/*.test.ts`), `biome.json`/lint script (add `packages`), `Dockerfile` (copy and build `packages/`)
- Test: `packages/action-engine/tests/catalog.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Lang = "tr"|"en"`; `Risk = "LOW"|"MEDIUM"`; `Step = { action: string; args: Record<string, unknown> }`; `CompiledStep = Step & { risk: Risk; kind: "desktop"|"info" }`; `ToolResult = { ok: boolean; text: string }`; `ToolPort = { call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> }`.
- Produces (`catalog.ts`): `catalog: Record<string, ActionDef>` with `ActionDef = { id; kind; risk; description: Record<Lang,string>; args: z.ZodObject }`; `compile(steps: unknown): { ok: true; steps: CompiledStep[] } | { ok: false; errors: string[] }`; `catalogLines(): string` (one line per action: `id(argSignature) — tr / en`, signature from `z.toJSONSchema`).
- Package `exports`: `{ ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`; Core `dev` script uses `node --conditions=source --import tsx`; root `build` runs the engine build first.

- [ ] **Step 1: Write the failing tests** — `compile` accepts `[{action:"app.open",args:{name:"Spotify"}}]` → `{ok:true, steps:[{..., risk:"LOW", kind:"desktop"}]}`; `news.brief` → `kind:"info"`; `ui.type` → `risk:"MEDIUM"`; every action in the spec table exists with the spec's risk (table-driven); `catalogLines()` contains `app.open` and `"name"`; `web.open` rejects `file:///C:/x` and `javascript:alert(1)`.
- [ ] **Step 2: Run** `npx vitest run packages/action-engine/tests/catalog.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the workspace files and `catalog.ts` (Zod `strictObject` per action; `media.key` enum `play_pause|next|previous|volume_up|volume_down|mute`; `news.brief` `{topic?: string ≤80, region?: "tr"|"world", count?: 1..8 default 5}`; `ui.type.text` ≤ 2000).
- [ ] **Step 4: Run** the test → PASS; `npm run typecheck` → PASS; `npm run build` → engine `dist/` then Core `dist/`.
- [ ] **Step 5: Commit** `feat(engine): add action-engine workspace and typed catalog`.

### Task 2: Intent contract, repair and narration

**Files:**
- Create: `packages/action-engine/src/{intent.ts,narrate.ts}`
- Test: `packages/action-engine/tests/{intent.test.ts,narrate.test.ts}`

**Interfaces:**
- Consumes: `compile`, `catalogLines` (Task 1).
- Produces: `Decision = {kind:"reply"} | {kind:"clarify"} | {kind:"cancel"} | {kind:"plan"; goal: string; steps: CompiledStep[]}`; `readIntent(value: unknown): {decision: Decision} | {errors: string[]}` (missing/undefined → reply); `intentInstructions(): string`; `repairInstructions(errors: string[]): string`; `narrate(event: NarrationEvent, lang: Lang): string` with `NarrationEvent = {type:"proposed"; goal; needsApproval: boolean} | {type:"step-done"|"step-failed"; action; args; detail?} | {type:"plan-done"|"plan-failed"|"plan-uncertain"|"cancelled"|"not-understood"|"news-fallback"; count?}`.

- [ ] **Step 1: Write the failing tests** — `readIntent(undefined)` → reply; plan with 2 valid steps → plan with risks; 0 steps → errors; 9 steps → errors (`"too many steps"`); unknown action `"shell.run"` → errors naming it; one invalid step among valid → errors (whole plan rejected); `{kind:"cancel"}` → cancel; `intentInstructions()` includes every catalog id and the words `never` + `say`; `narrate({type:"proposed",goal:"Spotify'ı aç",needsApproval:true},"tr")` contains `onay`; every event type yields non-empty TR and EN text.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with a Zod schema for the intent object (`kind` enum, `goal` ≤ 200, `steps` 1..8 for plan) then `compile`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): parse intents with whole-plan validation and narrate outcomes`.

### Task 3: Guards and grounding

**Files:**
- Create: `packages/action-engine/src/{guards.ts,ground.ts,apps.ts}`
- Test: `packages/action-engine/tests/{guards.test.ts,ground.test.ts}`

**Interfaces:**
- Produces: `containedPath(input: string, roots: string[]): Promise<string>` (throws `GuardError("PATH_OUTSIDE_ROOTS")`; resolves real path of the nearest existing ancestor so new destinations work); `escapeTarget(windowTitle: string, processName?: string): string | null` (reason code or null); `blockedShortcut(keys: string): boolean`; `normalize(text: string): string` (Turkish-aware lowercase: İ→i, I→ı handled, strip diacritics for matching); `ground(target: string, elements: UiElement[], window?: string): {kind:"one"; element: UiElement} | {kind:"many"; candidates: UiElement[]} | {kind:"none"}` with `UiElement = { name: string; role: string; window: string; x: number; y: number }`; `appAlias(name: string): string` (TR→Windows name: not defteri→Notepad, hesap makinesi→Calculator, dosya gezgini→File Explorer, ayarlar→Settings, spotifay→Spotify, …).
- `GuardError extends Error { code: string }`.

- [ ] **Step 1: Write the failing tests** — path: `..` escape, sibling-prefix root (`Desktop2`), junction pointing outside (create one in a temp dir with `fs.symlink(..,"junction")`) → reject; new file under root → accept; fast-check: any generated relative path either resolves under a root or throws. Escape: titles `Windows PowerShell`, `Komut İstemi`, `Çalıştır`, `Run`, `Kayıt Defteri Düzenleyicisi`, `Görev Yöneticisi`, `Windows Terminal`, `User Account Control` → non-null; `Untitled - Notepad` → null. Shortcuts `win+r`, `Win+X`, `ctrl+shift+esc` → blocked; `ctrl+s` → allowed. Grounding: `"gönder"` matches `Gönder` button (one); two `Kaydet` → many; `"GÖNDER"` vs `gonder` normalisation; fast-check: `normalize` is idempotent. Aliases: `"not defteri"`, `"Not Defteri'ni"` (suffix stripped), `"spotifay"` → expected names.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (matching: exact normalised equality > prefix > token containment; role filter for click targets `Button|MenuItem|ListItem|Hyperlink|TabItem|CheckBox|Edit`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): add path, escape and shortcut guards and Turkish grounding`.

### Task 4: Step bindings and postconditions

**Files:**
- Create: `packages/action-engine/src/{run.ts,snapshot.ts}`, `packages/action-engine/tests/fixtures/windows-mcp/{tools.json,snapshot-notepad.txt,snapshot-dialog.txt}`
- Test: `packages/action-engine/tests/run.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 3 guards/ground/aliases.
- Produces: `Evidence = { ok: boolean; evidence: "postcondition"|"tool-ok"|"observed-failure"|"refused"; observation: string; candidates?: string[]; panel?: Panel }`; `runStep(step: CompiledStep, ctx: { tools: ToolPort; roots: string[]; signal: AbortSignal; timeoutMs?: number }): Promise<Evidence>`; `parseSnapshot(text: string): { windows: {title: string; focused: boolean}[]; elements: UiElement[] }`; `Panel` union (`{type:"windows"; items:string[]}` here; `news`/`candidates` added later).
- Transport/protocol errors from `ToolPort.call` propagate unchanged (Core classifies them as uncertain).

- [ ] **Step 1: Capture real tool schemas and snapshot text** — start `uvx windows-mcp@0.8.8 serve` through a 20-line throwaway script using `@modelcontextprotocol/client` (stdio), save `listTools()` output to `tools.json`, call `Snapshot` with Notepad open and with its unsaved-changes dialog open, save both outputs (use a clean Notepad, nothing personal on screen). Expected: `tools.json` lists the allowlisted tools with input schemas.
- [ ] **Step 2: Write the failing tests** with a fake `ToolPort` replaying fixtures — `app.open Notepad` calls `App` with launch args from `tools.json`, then `Snapshot` until a window titled `*Notepad*` appears → `{ok:true, evidence:"postcondition"}`; never appears within `timeoutMs` → `observed-failure`; `app.close` with dialog fixture → `observed-failure` whose observation mentions the dialog; `ui.type` into a PowerShell-titled focused window → `refused`, no Type call made; `key.shortcut win+r` → `refused`; `file.move` outside roots → `refused`; `ui.click` with two candidates → `observed-failure` with `candidates`; `media.key play_pause` → `tool-ok`; `window.list` → `panel.type === "windows"`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** `run.ts` (one binding function per action; argument names exactly as in `tools.json`; postcondition polling every 300 ms, bounded by `timeoutMs` default 5000 and the signal) and `snapshot.ts` (parser for the captured text format).
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(engine): bind catalog actions to Windows-MCP with observed postconditions`.

### Task 5: MCP stdio ToolPort

**Files:**
- Create: `packages/action-engine/src/mcp.ts`, `packages/action-engine/tests/fixtures/echo-server.ts`
- Test: `packages/action-engine/tests/mcp.test.ts`

**Interfaces:**
- Produces: `class McpToolPort implements ToolPort { constructor(options: { command: string; args: string[]; env: Record<string,string>; allow: string[] }); start(): Promise<void>; list(): Promise<string[]>; call(...); close(): Promise<void> }` — `call` of a tool outside `allow` throws `GuardError("TOOL_NOT_ALLOWED")`; MCP `isError` → `{ok:false}`; text content parts joined with `\n`; if the child exits, the next `call` restarts it once and the in-flight call rejects with `Error("MCP_CHANNEL_LOST")`.

- [ ] **Step 1: Write the failing tests** against `echo-server.ts` (built with `@modelcontextprotocol/server`, run via `node --import tsx`): list returns `echo`, `fail`, `crash`; `call("echo",{text:"merhaba"})` → `{ok:true,text:"merhaba"}`; `fail` → `{ok:false}`; non-allowed tool → `TOOL_NOT_ALLOWED`; `crash` → rejects `MCP_CHANNEL_LOST`, next `echo` succeeds.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with the v2 client's stdio transport (child env = only `options.env` plus `PATH`, `SystemRoot`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): add allowlisted MCP stdio tool port with one restart`.

### Task 6: News

**Files:**
- Create: `packages/action-engine/src/news.ts`, `packages/action-engine/tests/fixtures/rss/{google-tr.xml,bbc-turkce.xml,html-error.html}`
- Test: `packages/action-engine/tests/news.test.ts`

**Interfaces:**
- Produces: `NewsItem = { headline: string; source: string; publishedAt: string; url: string; image?: string }` (`image` is a data URI); `fetchNews(args: {topic?; region?; count?}, ctx: { fetch: typeof fetch; feeds: string[]; lookup?: (host: string) => Promise<string[]>; signal: AbortSignal }): Promise<NewsItem[]>`; `Panel` gains `{ type: "news"; title: string; items: NewsItem[] }`; `briefPrompt(items: NewsItem[], lang: Lang): string`; `readBrief(text: string): string | null` (null when empty or longer than 600 chars).
- Feed URL for a topic: `https://news.google.com/rss/search?q=<encoded topic>&hl=tr&gl=TR&ceid=TR:tr` added to the configured feeds.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` — Google TR fixture → items with verbatim headlines, source, ISO time, newest first, deduplicated by normalised headline, sliced to `count`; HTML error page and a 3 MB body → that feed skipped, others used; all feeds failing → `[]`; image URL on `127.0.0.1`, `10.x`, `localhost`, `http:` or a host resolving to a private address → no fetch, no image; image of 300 KB or `text/html` → no image; valid small PNG → `data:image/png;base64,` prefix; `briefPrompt` contains every headline and the rule to use only them.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (per-feed timeout 4 s, body cap 1 MB, `fast-xml-parser` with entity expansion off, image magic-byte check).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(engine): fetch news from RSS with SSRF-safe thumbnails`.

### Task 7: Core contracts, migration and gateway rules

**Files:**
- Modify: `src/contracts.ts` (capabilities `desktop.act`, `info.fetch`; their input schema `{ action: string ≤40, args: record }`; `planId: z.uuid().optional()`; `Executor.outcomeObservable?: boolean`), `src/database.ts` (migration 3: `plans` table), `src/gateway.ts`, `src/tasks.ts` (capability defaults `desktop.act: 1`, `info.fetch: 2`; `createIn(tx, raw, key, principal)` extracted from `create`), `schemas/*.json` via `npm run contracts`
- Test: `tests/plan-gateway.test.ts`

**Interfaces:**
- `plans` columns: `id uuid PK, turn_id uuid, goal text, lang text, kind text, steps jsonb, hash text, status text, task_ids jsonb, created_at bigint, expires_at bigint, approved_at bigint, narrated boolean default false, continued boolean default false, replanned boolean default false, outcome jsonb`.
- Gateway MEDIUM rule: risk MEDIUM passes if an exact approval exists (same path as HIGH) or `spec.planId` names a plan with `approved_at` set, `now ≤ approved_at + 120000`, status `RUNNING`, and `steps[i]` (i = index of task id in `task_ids`) has `fingerprint({action,args,risk})` equal to `fingerprint({...spec.input, risk})`; on pass it emits `approval.granted` with `{ planId, approver: "operator", via: "plan" }`.
- `outcomeObservable` executors: an unverified result moves the task to FAILED (action FAILED), not RECOVERY_REQUIRED.

- [ ] **Step 1: Write the failing tests** (pglite + fake executors) — MEDIUM step of an unapproved plan → WAITING_FOR_APPROVAL with `approval.requested`; same after plan approval → runs; approval older than 120 s → waits; tampered `task_ids` order (step mismatch) → waits; LOW runs without approval; HIGH unchanged; observable executor returning `{"ok":false}` → FAILED with action FAILED; non-observable → RECOVERY_REQUIRED (existing behaviour); `createIn` inside an outer transaction is rolled back with it.
- [ ] **Step 2: Run** `npx vitest run tests/plan-gateway.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new test and `npm test` → PASS; `npm run contracts` regenerates `schemas/`.
- [ ] **Step 5: Commit** `feat(core): add desktop and info capabilities, plans table and plan-bound MEDIUM approvals`.

### Task 8: PlanService

**Files:**
- Create: `src/plans.ts`, `src/text-task.ts`
- Modify: `src/conversation.ts` (use `runText` for its wait loop)
- Test: `tests/plans.test.ts`

**Interfaces:**
- Produces: `runText(tasks, wake, spec: { prompt; providers: string[]; privacy: "personal"|"private"; deadlineMs; maxOutputTokens }, key: string): Promise<{ text: string; provider: string | null }>` (throws `CoreError("TURN_TIMEOUT"|"TURN_FAILED")`).
- `class PlanService extends EventEmitter` — `propose(input: { turnId: string; goal: string; lang: Lang; steps: CompiledStep[] }): Promise<PlanView>`; `approve(id: string, hash: string): Promise<void>`; `reject(id: string)`; `cancel(id: string)`; `cancelActive(): Promise<PlanView | null>`; `choose(id: string, index: number): Promise<PlanView>`; `get(id: string): Promise<PlanView>`; `refresh(): Promise<void>` (derives statuses from tasks, expires unapproved plans after 120 s, runs finishers); `waitSettled(id: string, ms: number): Promise<PlanView>`; `start(signal: AbortSignal)` (refresh every 300 ms).
- `PlanView = { id; goal; lang; kind; status; hash; needsApproval: boolean; expiresAt; steps: { action; args; risk; status: TaskState; evidence?: Evidence }[]; panels: Panel[]; say?: string }`.
- Events: `"plan"` (PlanView on every status or step change), `"announce"` (`{ text, lang }` once per terminal plan unless `narrated`).
- Finishers (run once on COMPLETED): `news.brief` → `runText(briefPrompt, personal, conversation providers)`, fallback template; `screen.describe` → `runText(question + observation, private, ["claude-code"])`. On an observed failure with `candidates` → panel `{type:"candidates"; planId; items}`; other observed failures → one replan via `runText(private, ["claude-code"])` + `readIntent` + `propose` (skipped when `claude-code` is not configured).
- Options: `{ tasks; wake; onCancel(taskId); conversationProviders: string[]; privateProviders: string[] }`.

- [ ] **Step 1: Write the failing tests** (pglite, fake executors for `desktop.act`/`info.fetch`/`text.generate`) — LOW plan runs to COMPLETED and emits one `announce`; MEDIUM plan stays AWAITING_APPROVAL, wrong hash → `CoreError("PLAN_HASH_MISMATCH")`, right hash → COMPLETED; unapproved after 120 s (fake clock) → CANCELLED; reject → all step tasks CANCELLED; second desktop proposal cancels the first and emits its CANCELLED view; info plan beside a desktop plan does not cancel it; step 1 FAILED → step 2 BLOCKED → plan FAILED; RECOVERY_REQUIRED step → plan RECOVERY_REQUIRED and `plan-uncertain` narration; news finisher uses the fake brief, and the template when the brief task fails; candidates failure → `choose(id, 1)` creates an approved continuation with the exact target and remaining steps; double `choose` → `PLAN_ALREADY_CONTINUED`; restart: a new PlanService over the same DB converges (`refresh`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`propose` creates the plans row and step tasks in one `tasks.locked` transaction via `createIn`, keys `plan:<id>:<i>`, deadline now + 240 s, `maxDurationMs: 240000`, verification `{kind:"contains", value:"\"ok\":true"}`, privacy `personal`).
- [ ] **Step 4: Run** → PASS; `npm test` → PASS (conversation tests still green after the `runText` refactor).
- [ ] **Step 5: Commit** `feat(core): add PlanService with approval, single desktop plan, finishers and replan`.

### Task 9: Executors, configuration and Windows-MCP supervision

**Files:**
- Create: `src/integrations/actions.ts` (`DesktopExecutor`, `NewsExecutor`)
- Modify: `src/config.ts` (`ENABLE_DESKTOP`, `WINDOWS_MCP_COMMAND` default `uvx`, `WINDOWS_MCP_ARGS` default `windows-mcp@0.8.8 serve`, `JARVIS_FILE_ROOTS`, `ENABLE_NEWS`, `NEWS_FEEDS` default `https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr`), `src/main.ts` (start/close `McpToolPort`, create and start `PlanService`), `.env.example`
- Test: `tests/action-executors.test.ts`, `tests/subscription-config.test.ts` (new flags)

**Interfaces:**
- `DesktopExecutor`: id `windows-mcp`, capability `desktop.act`, `external:false`, `retrySafe:false`, `outcomeObservable:true`; `execute` = `runStep` → `{ text: JSON.stringify(evidence), source: "windows-mcp:" + evidence.evidence }`; `MCP_CHANNEL_LOST` → `ProviderFailure("transient", false, true)`.
- `NewsExecutor`: id `news`, capability `info.fetch`, `external:true`, `retrySafe:true`; evidence `ok` = at least one item; `panel` = news panel.
- `configuredProviders` returns the registry plus `{ tools?: McpToolPort }` so `main.ts` can close it on shutdown (signature change: `Promise<{ registry: ProviderRegistry; tools?: McpToolPort }>`; update callers in `main.ts`, `cli.ts`, tests).

- [ ] **Step 1: Write the failing tests** — Desktop executor with a fake ToolPort maps evidence to `ResultSchema`; refused evidence → text contains `"ok":false`; channel loss → ProviderFailure dispatched; News executor with fake fetch returns a panel; config: `ENABLE_DESKTOP=true` registers `windows-mcp` with the allowlist env, default roots resolve under `USERPROFILE`, a root outside `USERPROFILE` is rejected.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(core): register Windows-MCP and news executors`.

### Task 10: Conversation routing, endpoints and SSE

**Files:**
- Modify: `src/persona.ts` (action honesty rules + `intentInstructions()`), `src/conversation.ts` (route decisions; `TurnResult.planId?`), `src/server.ts` (plan endpoints, `GET /v1/stream`), `src/main.ts` (wire PlanService into server and conversation)
- Test: `tests/conversation-intent.test.ts`, `tests/stream.test.ts`

**Interfaces:**
- `parseReply` additionally returns `intent: unknown` (raw `intent` field).
- Turn routing: `reply`/`clarify` → as M1 (clarify keeps the model question); `cancel` → `plans.cancelActive()` + `narrate(cancelled)`; `plan` → `propose`; `needsApproval` → say `narrate(proposed)`; LOW-only → `waitSettled(id, 5000)`: settled → say the outcome (mark `narrated`), else acknowledgement. Invalid intent → one repair `runText` (same providers, prompt + `repairInstructions`) → still invalid → `narrate(not-understood)`.
- Endpoints (operator auth): `GET /v1/plans/:id`, `POST /v1/plans/:id/approve {hash}` (204), `POST /v1/plans/:id/reject` (204), `POST /v1/plans/:id/cancel` (204), `POST /v1/plans/:id/choose {index}` (200 PlanView), `GET /v1/stream` (SSE `event: plan|announce`, `: ping` every 5 s, socket timeout disabled for this request).

- [ ] **Step 1: Write the failing tests** — fake provider replying with a LOW plan → turn `say` is the template, not the model text, and `planId` set; MEDIUM plan → "onay" in say; invalid then valid after repair → plan; invalid twice → not-understood template; `cancel` intent cancels the active plan; plan endpoints enforce auth and hash; SSE test reads `event: plan` after a proposal and a ping.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(core): route spoken intents into plans with SSE updates`.

### Task 11: Voice announcements

**Files:**
- Modify: `workers/voice/jarvis_voice/server.py` (`POST /announce {text ≤600, lang}` → active session's Brain), `workers/voice/jarvis_voice/brain.py` (`announce(text, lang)`: captions + `TTSSpeakFrame`, skipped while the operator is mid-turn)
- Test: `workers/voice/tests/test_brain.py`

- [ ] **Step 1: Write the failing test** — `announce("Spotify açıldı.", "tr")` pushes a `TTSSpeakFrame` with that text and sends a jarvis caption; no session → endpoint 409.
- [ ] **Step 2: Run** `uv run pytest tests -q` (from `workers/voice`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `uv run ruff check` → PASS.
- [ ] **Step 5: Commit** `feat(voice): speak Core announcements`.

### Task 12: Desktop HUD — cards, panels, control indicator

**Files:**
- Modify: `apps/desktop/src/shared.ts` (`UiEvent` adds `{type:"plan"; plan: PlanView}` and `{type:"announce"; text; lang}`; `Bridge.plans: { approve(id, hash); reject(id); cancel(id); choose(id, index); open(url) }`), `apps/desktop/src/main/main.ts` (SSE client with reconnect backoff; IPC handlers; announcements → voice `POST /announce`; `open` via `shell.openExternal` only for `https:` URLs present in a received news panel), `apps/desktop/src/preload/preload.ts`, `apps/desktop/src/renderer/{ui.ts,styles.css,index.html,overlay.ts}` (+ new `apps/desktop/src/renderer/hud.ts`)
- Test: `apps/desktop/tests/hud.spec.ts`

**Interfaces:**
- Consumes: PlanView/Panel shapes (Tasks 4, 6, 8), endpoints (Task 10).
- Renderer: plan card (goal, steps with risk badges, Onayla/Reddet, Enter/Esc), progress rail, candidates panel (buttons), news panels (staggered HUD cards with optional data-URI thumbnail, tap → `open`), windows panel, overlay control indicator while a desktop plan is RUNNING. Text only via `textContent`.

- [ ] **Step 1: Design pass** — invoke `design-taste-frontend`; direction: film HUD, thin-line holographic panels around the presence, reduced-motion variant, AA contrast.
- [ ] **Step 2: Write the failing Playwright tests** (test mode injects UiEvents) — plan card renders and Enter calls `approve(id, hash)`; Esc calls `reject`; news panel shows 5 cards with verbatim headlines; candidates buttons call `choose`; control indicator visible in the overlay while RUNNING; screenshots of each state saved under `apps/desktop/tests/screenshots/`.
- [ ] **Step 3: Run** `npm test` in `apps/desktop` → FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** → PASS; inspect every screenshot; `npm run lint` (root) → PASS.
- [ ] **Step 6: Commit** `feat(desktop): add HUD plan cards, news panels and control indicator`.

### Task 13: Eval, live verification and documentation

**Files:**
- Create: `packages/action-engine/eval/commands.jsonl` (~120 lines: `{ "utterance", "lang", "kind", "actions": [], "args": {} }`), `scripts/eval-intents.ts`, `docs/ADR/0010-model-proposed-typed-plans.md`, `docs/ACTION_ENGINE_EVIDENCE.md`
- Modify: `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/INTEGRATIONS.md`, `README.md`, `apps/desktop/README.md`

- [ ] **Step 1: Write the eval set** (TR/EN, slang, STT errors, multi-step, out-of-scope, dangerous requests expecting reply/clarify) and the scorer test `packages/action-engine/tests/eval-score.test.ts` (exact action sequence; key-arg normalised match).
- [ ] **Step 2: Run** `npx tsx --conditions=source scripts/eval-intents.ts` against configured providers → per-provider accuracy, valid-JSON rate, p50/p95; record in the evidence doc.
- [ ] **Step 3: Live verification on this laptop** — the five spec scenarios through the real voice path; classify each as live-verified / tested only / not run; confirm operator takeover behaviour.
- [ ] **Step 4: Write ADR 0010 and update docs.**
- [ ] **Step 5: Run** `npm run check` and the desktop tests → PASS.
- [ ] **Step 6: Commit** `docs: record action engine evidence, ADR 0010 and architecture updates`.

### Task 14: Independent review

- [ ] **Step 1:** One fresh reviewer on the most capable model reviews the whole branch against the spec (security focus: escape guard, path guard, SSRF, approval binding).
- [ ] **Step 2:** Fix confirmed findings with tests; re-run `npm run check`, voice and desktop tests.
- [ ] **Step 3: Commit** `fix: address action engine review findings`.
