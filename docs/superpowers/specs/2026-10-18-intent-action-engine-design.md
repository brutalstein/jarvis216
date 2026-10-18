# JARVIS intent and action engine (M3, cycle 1) — design

Date: 2026-10-18. Status: approved section by section in conversation; the operator asked to start
implementation immediately after the written spec.

## Intent

After the voice layer, JARVIS turns natural Turkish or English speech into real work on this
computer: desktop control now; Browser Use, OpenClaw and n8n later through the same interface. It
also fetches information (news first) and presents it inside JARVIS as rich, film-style panels
instead of sending the operator to a browser. The engine is a separate, independently testable
package; Core remains the only authority for tasks, approvals and records.

Success for cycle 1: spoken commands on this laptop go utterance → intent → typed plan → policy
and approval card → Windows-MCP execution → observed verification → spoken outcome; "today's
news" shows news panels with a spoken brief; intent quality is measured on a Turkish/English
command set; every UI state is verified visually.

## Operator decisions (2026-10-18)

| Topic | Decision |
| --- | --- |
| Cycle 1 scope | Engine + Windows-MCP desktop adapter + approval cards + news panels |
| Approach | Typed catalog + plan / act / verify loop with bounded replanning (not a free agent loop, not a framework that owns execution) |
| Screen privacy | Hybrid: only the utterance (and recent turns) reaches fast models; screen content reaches only Claude Code |
| News source | RSS (Google News TR plus operator-chosen feeds); the model only summarises fetched headlines |
| Approvals (from 2026-10-17) | LOW automatic, MEDIUM one tap, HIGH tap + Windows Hello; voice never approves |

## Evidence (checked 2026-10-18)

- Windows-MCP 0.8.8 on PyPI, Python ≥ 3.14 (uvx provisions it), stdio transport, `--tools` /
  `WINDOWS_MCP_TOOLS` allowlist, `ANONYMIZED_TELEMETRY=false`, desktop gate policies
  (`relaxed`/`balanced`/`strict`) with a desktop-ownership lease
  ([README](https://github.com/CursorTouch/Windows-MCP)).
- MCP TypeScript SDK v2 is the stable line: `@modelcontextprotocol/client` 2.3.1,
  `@modelcontextprotocol/server` (2026-07-28 spec)
  ([repo](https://github.com/modelcontextprotocol/typescript-sdk)).
- Gemini Search grounding free quota is unclear in 2026 (forum reports conflict), so news uses
  RSS.
- FunctionGemma (270M, local function calling) exists; a local fast router is deferred until the
  eval shows latency needs it.

## Architecture

```
Voice service ─► Core POST /v1/conversation/turns (existing)
  ├─ engine.understand(utterance, history, catalog) ─► ModelPort
  │     (gemini → or-* → nv-* → claude-code, privacy personal)  ⇒ reply | clarify | plan | cancel
  ├─ plan ⇒ engine.compile ⇒ plans row + one Core task per step (dependency chain)
  └─ Worker ─► ActionGateway (risk, approval, exact hash, records)
        ├─ DesktopExecutor (desktop.act) ─► engine.runStep ─► ToolPort ─► MCP stdio ─► Windows-MCP
        └─ NewsExecutor   (info.fetch)  ─► engine.fetchNews ─► RSS over HTTPS
Core GET /v1/stream (SSE) ─► desktop main ─► renderer (cards, panels) ─► voice data channel (announce → TTS)
```

### `packages/action-engine` (npm workspace)

Imports nothing from `src/`. It talks to the world through ports:

- `ModelPort`: `complete(prompt, privacy) → text` (Core implements it with tasks).
- `ToolPort`: `list()` and `call(name, args, signal)` (the package ships a generic MCP stdio
  adapter on `@modelcontextprotocol/client`).

Contents: catalog, `understand` (prompt + parse + validate + repair), `compile`, `ground`,
`runStep` (bindings + guards + postconditions), `fetchNews`, `narrate`, MCP adapter, eval set and
eval scorer. Its own Vitest tests.

### Core (host)

- `ConversationService` builds the engine prompt and routes the decision.
- New capabilities `desktop.act` and `info.fetch` with executors that call the engine.
- `plans` table, plan approval, MEDIUM gate, SSE stream, Windows-MCP child process supervision.
- ADR 0010 amends ADR 0004: a model proposes; the deterministic compiler and the operator's
  approval convert the proposal into typed tasks.

### Windows-MCP

A child process of Core; Core is its only MCP client. Telemetry off; allowlist App, Click, Type,
Scroll, Shortcut, Snapshot, Screenshot, FileSystem, Clipboard, Wait, WaitFor, ControlStatus;
`balanced` desktop gate policy. PowerShell and Registry are never enabled.

## Understanding

One model call per turn decides chat versus action. The prompt contains the persona, a compact
catalog (action id, one-line TR/EN description, argument signature derived from the Zod schema
with `z.toJSONSchema`), recent turns and the utterance. No screen content.

Reply contract (extends the M1 contract):

```json
{ "addressed": true, "say": "…", "lang": "tr", "display": [],
  "intent": { "kind": "reply" | "clarify" | "plan" | "cancel",
              "goal": "Spotify'ı açıp çalmaya başlat",
              "steps": [ { "action": "app.open", "args": { "name": "Spotify" } },
                         { "action": "media.key", "args": { "key": "play_pause" } } ] } }
```

- Missing `intent` means `reply` (M1 behaviour is preserved).
- Every step is validated against the catalog schema. One unknown action or invalid argument
  rejects the whole plan; one repair call with the validation errors is attempted; otherwise the
  decision becomes `clarify` ("Tam anlayamadım efendim, …?").
- `clarify` asks for a missing or ambiguous argument; the answer arrives in the follow-up window
  and recent turns carry the context, so no pending-intent state exists.
- Structural honesty: for `plan` the model's `say` is discarded. The engine speaks templates
  ("Spotify'ı açacağım." / "Onayınızı bekliyorum.") and outcomes come only from Core records.
- `cancel` ("dur", "iptal", "stop") cancels the active plan. Voice may cancel, never approve.

## Catalog (cycle 1)

Risk is set by the catalog, never by the model; Core floors still apply.

| Action | Arguments | Risk | Windows-MCP binding | Postcondition |
| --- | --- | --- | --- | --- |
| `app.open` / `app.focus` | name | LOW | App launch / switch | Matching window exists / is foreground within 5 s |
| `app.close` | name | MEDIUM | App switch + Alt+F4 | Window gone; an unsaved-changes dialog stops the plan and is reported |
| `window.list` | — | LOW | Snapshot | Shown as a panel; never sent to a model |
| `screen.describe` | question? | LOW | Snapshot text → Claude Code | Read only |
| `media.key` | play_pause, next, previous, volume_up, volume_down, mute | LOW | Shortcut (media keys) | Tool success (weak evidence) |
| `ui.click` | target, window? | MEDIUM | ground → Click | Snapshot changed (weak evidence) |
| `ui.type` | text, target?, submit? | MEDIUM | ground → Type | Field value contains the text when readable |
| `key.shortcut` | keys | MEDIUM | Shortcut | Tool success |
| `clipboard.read` / `clipboard.write` | — / text | LOW / MEDIUM | Clipboard | Read-back matches |
| `file.list` | folder | LOW | FileSystem | — |
| `file.move` / `file.copy` / `file.rename` / `file.mkdir` | source, destination | MEDIUM | FileSystem | Destination exists; for move the source is gone |
| `web.open` | url (http/https only) | MEDIUM | App launch (default browser) | Browser window is foreground |
| `news.brief` | topic?, region?, count? | LOW | RSS (Core) | Panel built from fetched items |

Guards (enforced in the engine before any tool call, tested):

- **Files:** allowed roots are Desktop (OneDrive), Documents and Downloads, configurable with
  `JARVIS_FILE_ROOTS`. Paths are resolved to real paths (junctions and symlinks included); `..`
  and anything outside a root are rejected.
- **Escape paths:** `ui.type`, `ui.click` and `key.shortcut` are refused when the target window is
  a terminal, PowerShell, cmd, Windows Terminal, the Run dialog, Regedit, UAC, Task Manager or a
  password field; Win+R, Win+X, Ctrl+Shift+Esc and similar shortcuts are refused. Otherwise
  "type" would become a hidden shell.
- **Not in cycle 1:** HIGH actions (`file.delete`, `process.kill`), PowerShell, Registry,
  payments, passwords.
- **Operator takeover:** touching the mouse or keyboard during a run stops it (Windows-MCP desktop
  ownership; verified live during implementation).

## Compilation, plans and approval

- Each validated step becomes a Core task: capability `desktop.act` or `info.fetch`, input
  `{ action, args }`, provider `windows-mcp` or `news`, risk from the catalog, dependency on the
  previous step, `planId`.
- `plans` row: id, turn id, goal, compiled steps, `hash = fingerprint(steps)`, status
  (`PROPOSED`, `AWAITING_APPROVAL`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`,
  `RECOVERY_REQUIRED`), approval hash and expiry.

| Plan content | Behaviour |
| --- | --- |
| LOW steps only | Runs at once without a card; a progress panel is shown |
| At least one MEDIUM step | One card: goal and steps with risk badges. One tap (or Enter) approves the plan, bound to the plan hash, valid 2 minutes |
| HIGH | Not in cycle 1 |

- Gateway rule: a MEDIUM action runs only with its own exact approval or as a step of an approved,
  unexpired plan whose compiled step matches the action's input and risk. Each step still runs at
  most once (existing action uniqueness).
- Reject, Esc or expiry cancels the plan and its tasks.
- Turn timing: a LOW-only plan that finishes within 5 s is narrated in the same reply (news
  briefs use this path). Otherwise the reply is a short acknowledgement ("Bakıyorum efendim." /
  "Onayınızı bekliyorum.") and the outcome is announced later.
- Endpoints: `GET /v1/plans/:id`, `POST /v1/plans/:id/approve {hash}`,
  `POST /v1/plans/:id/reject`, `POST /v1/plans/:id/cancel`, `GET /v1/stream` (SSE: plan and step
  states, panels, announcements).
- Concurrency: one desktop plan at a time; a new desktop plan cancels the previous one. Info plans
  may run in parallel.

## Execution, verification and replanning

- `DesktopExecutor`: `external: false`, `retrySafe: false`, `outcomeObservable: true`. Guards →
  grounding → Windows-MCP call → postcondition with bounded `WaitFor` → typed evidence
  `{ ok, evidence: "postcondition" | "tool-ok", observation }`.
- Grounding is deterministic in cycle 1: Snapshot accessible names, Turkish-aware normalisation
  (İ/ı, diacritics), fuzzy match scoped by window and role. One clear candidate → act; several →
  numbered candidate panel, the operator says "ikincisi" or taps (a clarification, not an
  approval); none → observed failure.
- Outcome classes: an executor declaring `outcomeObservable` moves an unmet postcondition to
  FAILED (the state was observed; no quarantine). A broken Windows-MCP channel mid-call stays
  uncertain: RECOVERY_REQUIRED, never replayed, and JARVIS says it is unsure.
- Replanning: at most once per plan, after an observed failure: a `text.generate` task, privacy
  `private`, provider `claude-code` only, with the goal, the failed step and a text summary of a
  fresh Snapshot (window and element names; no screenshots). The new plan is compiled and needs
  approval again if it has a MEDIUM step. `screen.describe` uses the same path.
- `news.brief`: operator feed list; bounded fetch (timeout, byte limit), `fast-xml-parser`, topic
  filter, de-duplication, newest N. Panel items keep the source headline verbatim. Thumbnails are
  fetched by Core only from the feed's own image URL, type-checked (JPEG/PNG/WebP) and size-bounded
  (≤ 200 KB), and sent as data URIs, so the renderer never loads remote content. The spoken brief
  is a separate `personal` `text.generate` task over the fetched headlines only; if it fails the
  template "5 başlık ekranda, efendim." is spoken.
- Narration: TR/EN templates per action and outcome, delivered over SSE → desktop main →
  renderer → voice data channel `announce` → TTS. While JARVIS controls the desktop the overlay
  shows a control indicator.
- Limits: 15 s per step, 2 min per plan. If Windows-MCP crashes Core restarts it once; the running
  step is uncertain. A failing feed is skipped; if all fail the plan fails and JARVIS says so.

## Display panels and UI

- Engine-built blocks (first: `news` with items `{ headline, source, publishedAt, summary?,
  image? }`, `plan`, `candidates`, `progress`) are produced only by the engine from records and
  tool data. Model-built blocks stay text, list and code.
- Tapping a news card opens the article in the default browser; the operator's tap is the request.
- Direction: the film's HUD — thin-line holographic panels opening around the presence, staggered
  entry, emphasis following the narration. Built with the design-taste-frontend guidance;
  reduced motion, keyboard approval/rejection and AA contrast are required. CSP gains
  `img-src data:` only.

## Security

| Threat | Control |
| --- | --- |
| Prompt injection adding actions | Catalog-only actions, Zod validation, deterministic risk, plan approval bound to the hash |
| Typing into shells or the Run dialog | Escape guard on target window and shortcuts |
| File damage outside the operator's folders | Real-path root guard; no delete in cycle 1 |
| Screen content to providers that may train | Screen text only to Claude Code (`private`) |
| False action claims | Model `say` discarded for plans; outcomes from Core records |
| Remote content in the renderer | Core-fetched, type-checked thumbnails as data URIs; text-only rendering |
| Voice spoofing | Voice can cancel, never approve |

## Testing and evidence

- Engine (Vitest, test-first, fakes for both ports): parsing and repair, catalog validation,
  compile hash stability, risk map, path guard, escape guard, Turkish grounding matcher,
  postconditions, narration, RSS parsing with recorded fixtures; `fast-check` properties for the
  matcher and the path guard.
- MCP adapter: contract test over stdio against a test server built with
  `@modelcontextprotocol/server` (list, call, error mapping, restart after crash).
- Core (pglite): plan admission, approval binding (wrong hash, expiry, reject), MEDIUM gate, LOW
  auto-run, chain failure → plan FAILED, voice cancel, single desktop plan, `outcomeObservable`
  classification, SSE, the 5 s LOW reply path, regenerated JSON schemas.
- Desktop: Playwright Electron screenshots of the plan card, progress, candidates, news panels,
  failure and control indicator; keyboard approve/reject.
- Voice service: `announce` reaches TTS (Python unit test).
- Live evidence on this laptop (live-verified / tested only / not run): Notepad open + type +
  read back; close with the unsaved dialog; today's news panels and brief; Spotify open and
  pause (LOW, no card); "dur" mid-run.
- Eval: about 120 TR/EN commands (slang, STT errors, multi-step, out-of-scope, dangerous) with the
  expected kind, action sequence and key arguments; per-provider intent accuracy, valid-JSON rate
  and p50/p95 latency, recorded in `docs/ACTION_ENGINE_EVIDENCE.md`.

## Out of scope for cycle 1

Browser Use agent adapter, OpenClaw long tasks, n8n run/build, HIGH actions and Windows Hello
signed approvals, screenshot understanding, local fast router, tool retrieval, provider JSON-schema
modes. Each is added only when its own cycle or a measurement requires it.

## Risks

- Windows-MCP accessible names vary by application; grounding quality is measured live.
- Free models may produce invalid plan JSON; the eval measures it and the repair call bounds it.
- Desktop ownership and takeover detection behaviour must be confirmed on this machine.
- Python 3.14 for Windows-MCP is provisioned by uv beside the voice service's Python 3.12.
