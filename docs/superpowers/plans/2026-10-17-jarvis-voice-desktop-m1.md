# JARVIS Voice Desktop M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator speaks to JARVIS in Turkish or English and, when addressed, JARVIS answers by voice and shows display cards, with every model call routed and recorded by Core.

**Architecture:** Core gains free-model executors, a `personal` privacy class, listed provider order, `non-empty` verification and a conversation endpoint. A Python Pipecat voice service (`workers/voice`) does VAD, end-of-turn, speaker gating, local Whisper STT, addressee gating and Chatterbox TTS, and calls Core once per turn. An Electron app (`apps/desktop`) captures audio over loopback WebRTC and renders the presence, captions and cards.

**Tech Stack:** TypeScript 7.0.2, Fastify 5.12.7, Zod 4.6.7, Vitest 5.0.5, PGlite 0.5.10; Python 3.12, uv, pipecat-ai 1.12.0, faster-whisper (via pipecat `whisper` extra), chatterbox-tts 0.1.7, speechbrain 1.1.2, torch (CUDA 12.8 wheels); Electron 44.9.0, esbuild, @pipecat-ai/client-js 1.14.0, @pipecat-ai/small-webrtc-transport 1.11.0, @playwright/test 1.64.1.

**Spec:** `docs/superpowers/specs/2026-10-17-jarvis-voice-desktop-design.md`

## Global Constraints

- Windows 11 native only. Use Node 24.22.0: `$env:PATH = 'C:\Users\cenke\OneDrive\Desktop\jarvis216\.tools\node-v24.22.0-win-x64;' + $env:PATH`. Run `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue` before running Core.
- Never stop, reconfigure or write to the services on 127.0.0.1:2160 (Core), 18789 (OpenClaw), 55432 (PostgreSQL), or the operator's PostgreSQL on 5432.
- Secrets live only in `C:\Users\cenke\OneDrive\Desktop\jarvis216\.env`. Read them at runtime; never copy, print, commit or place them in URLs, logs or tests.
- Do not edit: `src/integrations/claude-code.ts`, `tests/claude-code.test.ts`, `scripts/openclaw-native.ps1`, `tests/openclaw-native.test.ts`, `docs/INTEGRATIONS.md`, `docs/ENGINEERING_REPORT.md`, `docs/RESEARCH_AND_COMPATIBILITY.md`, `docs/ADR/0008-subscription-cli-harness.md`, `README.md`. New Core tests go in new files.
- Pin exact versions; no new dependency beyond the Tech Stack line.
- All local services bind 127.0.0.1 and require a bearer token.
- Voice is never an approval; M1 has no computer actions.
- UI microcopy is Turkish and minimal. Display blocks render as text only.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- Dev runtime for live checks: own PostgreSQL container `jarvis-voice-pg` on 127.0.0.1:55433, own Core on 127.0.0.1:2161, settings in the gitignored worktree file `.env.voice-dev` (dev tokens, `DATABASE_URL`, `PORT=2161`, `ENABLE_CODEX=false`, `ENABLE_OPENCLAW=false`; no provider keys). Start Core with `node --env-file=C:\Users\cenke\OneDrive\Desktop\jarvis216\.env --env-file=.env.voice-dev dist/main.js` after confirming in Task 3 that the later file wins.

## Review Focus

1. A free model returns HTTP 200 with empty content (reasoning only): the turn must fall back to the next provider, never speak an empty reply. (Task 3 test)
2. The model wraps its JSON in a Markdown `json` code fence or adds prose: the reply must still parse; plain prose becomes `say`. (Task 5 test)
3. Turkish suffix forms of the name ("Jarvis'e", "jarvisciğim", "Carvis?") count as addressed while "servis" and "Travis" do not. (Task 7 test)
4. Every provider is slow or down: Core answers 504 `TURN_TIMEOUT` within the 20 s turn deadline and cancels the task; the voice service speaks a short fixed apology. (Task 5 and Task 8 tests)
5. The operator speaks again while a turn is in flight: the stale reply is dropped and only the newest turn is spoken. (Task 8 test)

---

### Task 1: Contract additions: `personal` privacy, `non-empty` verification, listed provider order

**Files:**
- Modify: `src/contracts.ts` (privacy enum, verification union, `providerOrder`, `verified()`)
- Modify: `src/gateway.ts:153` (use `verified`)
- Modify: `src/tasks.ts:400-403` (reconcile uses `verified`)
- Modify: `src/routing.ts:73-89` (listed order)
- Regenerate: `schemas/*.schema.json` via `npm run contracts`
- Test: `tests/voice-contracts.test.ts`

**Interfaces:**
- Produces: `TaskSpec.privacy: "public" | "personal" | "private" | "local-only"`; `TaskSpec.verification: { kind: "contains"; value: string } | { kind: "non-empty" }`; `TaskSpec.providerOrder: "priority" | "listed"` (default `"priority"`); `export function verified(spec: TaskSpec, text: string): boolean` in `src/contracts.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/voice-contracts.test.ts`:
  - `parses personal privacy, non-empty verification and listed order`: `TaskSpecSchema.parse({...base, privacy: "personal", providerOrder: "listed", verification: { kind: "non-empty" }})` keeps all three; omitted `providerOrder` parses to `"priority"`.
  - `rejects a non-empty verification carrying a value`: `{ kind: "non-empty", value: "x" }` throws.
  - `verified() applies each kind`: contains → `verified(spec("contains","ok"), "is ok") === true`, `"nope"` false; non-empty → `"  hi "` true, `"   "` false.
  - `listed order picks the first listed eligible provider regardless of priority`: registry with `a` (priority 10) and `b` (priority 50); task `providers: ["b","a"]`, `providerOrder: "listed"` selects `b`; with `"priority"` selects `a`; with `attempted: ["b"]` and listed selects `a`.
  - `gateway completes a non-empty reply and fails a blank one` (PGlite + fake retry-safe executor, pattern from `tests/core.test.ts`): text `"Merhaba"` → task COMPLETED; text `"   "` → FAILED.
- [ ] **Step 2: Run** `npx vitest run tests/voice-contracts.test.ts` — expect FAIL (unknown keys / missing export).
- [ ] **Step 3: Implement.** Verification becomes `z.discriminatedUnion("kind", [contains, nonEmpty])` with strict objects. `verified` returns `text.includes(value)` for contains and `text.trim().length > 0` for non-empty. Gateway line 153 and reconcile line 401 call `verified(task.spec, …)`. In `ProviderRegistry.select`, when `task.spec.providerOrder === "listed"` sort candidates by `task.spec.providers.indexOf(id)`; otherwise keep the existing priority/id sort.
- [ ] **Step 4: Run** `npm run contracts`, then `npx vitest run` — expect all PASS (the schema drift test passes with regenerated schemas).
- [ ] **Step 5: Commit** `feat: add personal privacy, non-empty verification and listed provider order`.

### Task 2: Trusted providers for private data

**Files:**
- Modify: `src/contracts.ts` (`Executor.trustedForPrivate?: boolean`)
- Modify: `src/gateway.ts:32-36` (policy floor)
- Modify: `src/routing.ts` (`Provider` exposes `trustedForPrivate` in `list()`)
- Modify: `src/config.ts` (`JARVIS_PRIVATE_PROVIDERS`)
- Modify: `.env.example` (add `JARVIS_PRIVATE_PROVIDERS=claude-code`)
- Test: `tests/privacy-trust.test.ts`

**Interfaces:**
- Consumes: Task 1 privacy enum.
- Produces: env `JARVIS_PRIVATE_PROVIDERS` (comma list of provider ids); `register()` sets `trustedForPrivate` and appends `:trusted-private` to the configuration string of trusted providers.

- [ ] **Step 1: Write the failing tests:**
  - `external private task needs exact approval unless the provider is trusted`: gateway run with external executor, privacy `private` → status `WAITING_FOR_APPROVAL`; same with `trustedForPrivate: true` → COMPLETED.
  - `personal privacy adds no floor`: external untrusted executor, privacy `personal`, risk LOW → COMPLETED without approval.
  - `trust changes the configuration hash`: `configuredProviders` with `ENABLE_GEMINI=true`, `GEMINI_MODEL=m`, `GEMINI_API_KEY` via `EnvSecrets`, once without and once with `JARVIS_PRIVATE_PROVIDERS=gemini` → `list()` shows `trustedForPrivate` false/true.
- [ ] **Step 2: Run** `npx vitest run tests/privacy-trust.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Policy floor: `executor.capability === "workflow.invoke" || (executor.external && claim.spec.privacy === "private" && !executor.trustedForPrivate) ? "HIGH" : "LOW"`. Parse the env list with `z.string().default("")` split on commas, trimmed, empty removed.
- [ ] **Step 4: Run** `npx vitest run` — expect PASS.
- [ ] **Step 5: Commit** `feat: let the operator trust named providers with private data`.

### Task 3: OpenRouter and NVIDIA executors

**Files:**
- Create: `src/integrations/openai-compatible.ts`
- Modify: `src/config.ts` (register configured models)
- Modify: `.env.example` (`ENABLE_OPENROUTER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODELS`, `ENABLE_NVIDIA`, `NVIDIA_API_KEY`, `NVIDIA_MODELS`)
- Create: `scripts/probe-free-models.ts` (run as `node --env-file=<main .env> --env-file=.env.voice-dev --import tsx scripts/probe-free-models.ts`)
- Test: `tests/openai-compatible.test.ts`

**Interfaces:**
- Produces: `export function providerId(prefix: "or" | "nv", model: string): string`; `export class OpenAICompatibleExecutor implements Executor` with constructor `{ id: string; base: string; key: string; model: string; timeoutMs?: number; extraBody?: Record<string, unknown> }`, `capability "text.generate"`, `external true`, `retrySafe true`, `outputTokenLimitEnforced true`. Bases: `https://openrouter.ai/api/v1` (extraBody `{ reasoning: { effort: "low", exclude: true } }`), `https://integrate.api.nvidia.com/v1`. Provider priorities: `or-*` 50, `nv-*` 60.

- [ ] **Step 1: Write the failing tests** (local `node:http` server as in `tests/integrations.test.ts`):
  - `providerId slugs`: `providerId("or","dots-studio/dots-3-note-preview:free") === "or-dots-3-note-preview"`, `providerId("nv","openai/gpt-oss-20b") === "nv-gpt-oss-20b"`, result length ≤ 40 and matches `/^[a-z0-9-]{1,40}$/`.
  - `posts an authenticated chat completion and returns the content`: server asserts `POST /chat/completions`, `authorization: Bearer k`, body `model`, `messages[0].content === objective`, `max_tokens === budget.maxOutputTokens`, `extraBody` merged; returns `{id:"r1",choices:[{message:{content:"Merhaba"},finish_reason:"stop"}]}` → `{ text: "Merhaba", source: "or-x:m:model-output", externalId: "r1" }`.
  - `classifies failures`: 429 → kind `rate-limited`, retryable; 404 → `permanent`; 503 → `provider-unavailable`; 200 with `content: ""` or `null` → `invalid-response` with `retryable === true` (Review Focus 1); server that never answers with `timeoutMs: 100` → `provider-unavailable`, retryable.
  - `configuration registers one provider per model`: `ENABLE_OPENROUTER=true`, `OPENROUTER_MODELS="a/b:free, c/d:free"`, key via `EnvSecrets` → registry ids `or-b`, `or-d`; missing key → throws.
- [ ] **Step 2: Run** `npx vitest run tests/openai-compatible.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** with `jsonRequest` from `src/integrations/http.ts` (it already maps 401/403/429/5xx/404 and network failures). Combine the task signal with `AbortSignal.timeout(timeoutMs ?? 8000)`; when only the timeout fired, throw `ProviderFailure("provider-unavailable", true)`. Validate the response with Zod; blank content → `ProviderFailure("invalid-response", true)`.
- [ ] **Step 4: Implement `scripts/probe-free-models.ts`:** build the registry from `process.env`, send one short Turkish turn through every `or-*`/`nv-*` provider, print `id status latencyMs` only.
- [ ] **Step 5: Run** `npx vitest run` and `npm run lint` — expect PASS.
- [ ] **Step 6: Live check (dev runtime).** Create `.env.voice-dev` (generated tokens, `DATABASE_URL=postgres://jarvis:<generated>@127.0.0.1:55433/jarvis`, `PORT=2161`, `ENABLE_CODEX=false`, `ENABLE_OPENCLAW=false`, `ENABLE_OPENROUTER=true`, `OPENROUTER_MODELS=dots-studio/dots-3-note-preview:free,nvidia/nemotron-3-super-120b-a12b:free`, `ENABLE_NVIDIA=true`, `NVIDIA_MODELS=openai/gpt-oss-20b`). Confirm the later `--env-file` overrides the earlier one with `node --env-file=<main .env> --env-file=.env.voice-dev -e "console.log(process.env.PORT)"` → `2161`. Run the probe with both env files; keep only models that answer; record the output (ids and latencies only) for the final report.
- [ ] **Step 7: Commit** `feat: add OpenRouter and NVIDIA free-model executors`.

### Task 4: Wake the worker on admission

**Files:**
- Modify: `src/worker.ts` (idle delay becomes wakeable)
- Modify: `src/server.ts` (`ServerOptions.onAdmit?: () => void`, called after task creation)
- Modify: `src/main.ts` (wire `onAdmit` to every worker's `wake()`)
- Test: `tests/worker-wake.test.ts`

**Interfaces:**
- Produces: `Worker.wake(): void`; `ServerOptions.onAdmit?(): void`.

- [ ] **Step 1: Write the failing test** `wake shortens the idle wait`: start `worker.run(signal)` with an empty queue, wait 50 ms, create a task with a fake instant executor, call `worker.wake()`, assert the task is COMPLETED within 250 ms (it would take ≥ 500 ms without wake).
- [ ] **Step 2: Run** `npx vitest run tests/worker-wake.test.ts` — expect FAIL.
- [ ] **Step 3: Implement:** the idle `delay(500, …)` uses `AbortSignal.any([signal, this.idle.signal])`; `wake()` aborts `this.idle` and the loop creates a fresh controller; a wake abort must not end the loop (check `signal.aborted` to decide).
- [ ] **Step 4: Run** `npx vitest run` — expect PASS.
- [ ] **Step 5: Commit** `perf: wake idle workers when a task is admitted`.

### Task 5: Conversation service, character and endpoints

**Files:**
- Create: `src/persona.ts`, `src/conversation.ts`
- Modify: `src/database.ts` (migration 2), `src/server.ts` (routes), `src/main.ts` (construct, purge on start)
- Test: `tests/conversation.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`personal`, `non-empty`, `providerOrder: "listed"`, `onAdmit`/`wake`).
- Produces:
  - `export function conversationPrompt(input: { utterance: string; followUp: boolean; history: { utterance: string; say: string }[]; now: Date }): string`
  - `export const DisplayBlockSchema` (union: `{ type: "text"; title?: string ≤80; body: string ≤1200 }`, `{ type: "list"; title?: string ≤80; items: string[] 1..8, each ≤200 }`, `{ type: "code"; language?: string ≤20; code: string ≤4000 }`)
  - `export type Reply = { addressed: boolean; say: string; lang: "tr" | "en"; display: DisplayBlock[] }`; `export function parseReply(text: string): Reply`
  - `export function conversationProviders(ids: string[]): string[]` → order `gemini`, `or-*`, `nv-*`, `claude-code`, only ids present, at most 5.
  - `export class ConversationService` — `constructor(tasks: TaskService, options: { providers: string[]; wake(): void; deadlineMs?: number })`; `turn(input: { utterance: string; followUp: boolean }): Promise<TurnResult>`; `list(limit: number): Promise<TurnRecord[]>`; `deleteAll(): Promise<void>`; `purge(olderThanMs: number): Promise<number>`.
  - `TurnResult = { id; taskId; addressed; say; lang; display; provider: string | null; latencyMs }`.
  - HTTP: `POST /v1/conversation/turns` body `{ utterance: string 1..4000 (trimmed), followUp?: boolean }` → 200 `TurnResult`; 504 `TURN_TIMEOUT`; 502 `TURN_FAILED`. `GET /v1/conversation/turns?limit=1..500` (default 100) → `{ turns: TurnRecord[] }` newest first. `DELETE /v1/conversation/turns` → 204. All operator-authenticated.
  - Table (migration 2): `conversation_turns(id uuid PK, created_at bigint, utterance text, follow_up boolean, task_id uuid, reply jsonb, provider text)` + index on `created_at`.

- [ ] **Step 1: Write the failing tests:**
  - `parseReply` cases: plain JSON; JSON inside a Markdown `json` code fence with leading prose (Review Focus 2); `{"addressed":false}` → `addressed false, say ""`; invalid display block dropped while valid ones kept; more than 3 blocks → first 3; non-JSON prose `"Tabii efendim."` → `{ addressed: true, say: "Tabii efendim.", lang: "tr", display: [] }`; English prose → `lang "en"`.
  - `conversationPrompt` contains the utterance, each history pair, the follow-up instruction only when `followUp` is true, and the phrase forbidding claims of completed actions.
  - `conversationProviders(["claude-code","nv-a","gemini","or-b","codex"])` → `["gemini","or-b","nv-a","claude-code"]`.
  - `turn falls back and records the reply` (PGlite, real `Worker.run`, registry of fake executors `gemini` throwing `ProviderFailure("rate-limited", true)` and `or-b` returning `{"say":"Merhaba efendim","lang":"tr"}`) → result `provider "or-b"`, `say "Merhaba efendim"`; `list(10)` returns it; task spec has `privacy "personal"`, `providerOrder "listed"`, `verification { kind: "non-empty" }`.
  - `turn times out` with `deadlineMs: 300` and a never-resolving executor → rejects with code `TURN_TIMEOUT` (HTTP 504 via `app.inject`) and the task ends CANCELLED or RECOVERY_REQUIRED, never RUNNING (Review Focus 4).
  - `endpoints require the operator token` (401 without), `DELETE` empties the table, `purge(30 days)` deletes only older rows.
- [ ] **Step 2: Run** `npx vitest run tests/conversation.test.ts` — expect FAIL.
- [ ] **Step 3: Implement `src/persona.ts`.** Character text in English instructions with Turkish/English reply rule: JARVIS, the operator's personal assistant on this computer; calm, precise, dry understated wit, loyal; reply in the operator's language, usually one or two sentences; address the operator as "efendim" in Turkish or "sir" in English; never invent facts; never claim to have done, set, sent, opened or scheduled anything — it has no actions yet and says so plainly; output exactly one JSON object `{addressed, say, lang, display}`; in follow-up mode set `addressed:false` when the speech is clearly not meant for JARVIS.
- [ ] **Step 4: Implement `src/conversation.ts`.** `turn`: load the last 6 turns from the past 30 minutes; admit a task (`capability "text.generate"`, `objective = conversationPrompt(…)`, `providers`, `providerOrder "listed"`, `privacy "personal"`, `budget { maxCalls: providers.length, maxDurationMs: deadlineMs, maxOutputTokens: 600 }`, `deadline now + deadlineMs` (default 20 000), `verification { kind: "non-empty" }`, idempotency key `conversation:<turn id>`), call `wake()`, no providers → `CoreError("NO_PROVIDER", 503)` before admission; poll `tasks.get` every 50 ms; COMPLETED → `parseReply(result.text)` and provider = target of the SUCCEEDED action; FAILED/BLOCKED/RECOVERY_REQUIRED → `CoreError("TURN_FAILED", 502)`; deadline → `tasks.cancel(id)` then `CoreError("TURN_TIMEOUT", 504)`. Store the row on success.
- [ ] **Step 5: Implement migration 2 and routes;** in `main.ts` build `ConversationService` with `conversationProviders(registry ids)` and run `purge(30 * 86_400_000)` at startup.
- [ ] **Step 6: Run** `npx vitest run`, `npm run check` — expect PASS.
- [ ] **Step 7: Live check:** start the dev runtime (Global Constraints), `POST /v1/conversation/turns` with `{"utterance":"Jarvis, kendini kısaca tanıtır mısın?"}`; expect 200, `provider "gemini"`, Turkish `say` in character, no action claims. Record latency.
- [ ] **Step 8: Commit** `feat: add conversation turns with JARVIS character through Core`.

### Task 6: Voice service environment and GPU smoke test

**Files:**
- Create: `workers/voice/pyproject.toml`, `workers/voice/uv.lock`, `workers/voice/jarvis_voice/__init__.py`, `workers/voice/jarvis_voice/smoke.py`, `workers/voice/README.md`

**Interfaces:**
- Produces: a locked environment (`requires-python ==3.12.*`; `pipecat-ai[webrtc,silero,whisper,local-smart-turn]==1.12.0`, `chatterbox-tts==0.1.7`, `speechbrain==1.1.2`, `torch`/`torchaudio` from the `https://download.pytorch.org/whl/cu128` index declared as an explicit uv index); `python -m jarvis_voice.smoke` prints JSON lines `{"check": name, "ok": bool, …}`.

- [ ] **Step 1: Create the project and lock:** `uv lock --project workers/voice`. If chatterbox-tts pins a torch without sm_120 support, record the conflict and switch TTS to pipecat's `piper` extra with Turkish and English Piper voices (spec fallback); note the decision in `workers/voice/README.md`.
- [ ] **Step 2: Write `smoke.py`** checks, in order: `torch.cuda.is_available()` and device name; faster-whisper `large-v3` on `cuda` (`compute_type "float16"`) transcribes a generated Turkish sample; Chatterbox Multilingual synthesizes "Merhaba efendim, sizi dinliyorum." (`language_id "tr"`) and an English line, saved to `data/voice/samples/*.wav`; SpeechBrain `speechbrain/spkrec-ecapa-voxceleb` embeds a sample; peak VRAM (`torch.cuda.max_memory_allocated`) and per-step latency. Import torch before faster-whisper so its CUDA DLLs load.
- [ ] **Step 3: Run** `uv run --project workers/voice python -m jarvis_voice.smoke` — expect every check `ok: true`, peak VRAM < 7.5 GB, Chatterbox first sentence < 1.5 s. Model downloads (~6 GB) go to the Hugging Face cache.
- [ ] **Step 4: Listen** to the generated Turkish and English samples with the operator; record the chosen voice in `workers/voice/README.md`.
- [ ] **Step 5: Commit** `build: add voice service environment and GPU smoke test`.

### Task 7: Voice gating logic

**Files:**
- Create: `workers/voice/jarvis_voice/addressee.py`, `speaker.py`, `core_client.py`
- Test: `workers/voice/tests/test_addressee.py`, `test_speaker.py`, `test_core_client.py`

**Interfaces:**
- Produces:
  - `is_named(text: str) -> bool`; `class FollowUpWindow(seconds: float = 8.0, clock: Callable[[], float] = time.monotonic)` with `open() -> None` and `is_open() -> bool`.
  - `class SpeakerGate(store: Path, threshold: float)` with `enrolled() -> bool`, `enroll(embeddings: list[np.ndarray]) -> None` (mean, L2-normalised, saved as `operator.npy`), `accepts(embedding: np.ndarray) -> bool` (cosine ≥ threshold; `False` when not enrolled), `delete() -> None`; `embed(audio: bytes, sample_rate: int) -> np.ndarray` (SpeechBrain, not unit-tested).
  - `class CoreClient(base_url: str, token: str, transport: httpx.AsyncBaseTransport | None = None)` with `async turn(utterance: str, follow_up: bool) -> Turn | None`; `Turn` dataclass mirrors `TurnResult`; non-2xx or network error → `None`. `FALLBACK = {"tr": "Şu an yanıt veremiyorum, efendim.", "en": "I can't answer right now, sir."}`.

- [ ] **Step 1: Write the failing tests** (unittest):
  - `is_named` true: `"Jarvis, ışıkları kapat"`, `"jarvis'e sor bakalım"`, `"Carvis ne haber"`, `"Cervis?"`, `"JARVIS"`, `"jarvisciğim"`, `"çarvis"`, `"jarvıs"`. False: `"servis geldi mi"`, `"Travis Scott"`, `"bugün hava güzel"` (Review Focus 3).
  - `FollowUpWindow` with a fake clock: closed initially; open at t=0 → open at 7.9, closed at 8.1.
  - `SpeakerGate`: not enrolled → `accepts` False; enroll `[v, v]` writes `operator.npy`; `accepts(v)` True; `accepts(orthogonal)` False; `delete()` removes the file and `enrolled()` is False.
  - `CoreClient` with `httpx.MockTransport`: sends `POST /v1/conversation/turns` with bearer token and JSON `{utterance, followUp}`; 200 → `Turn`; 504 → `None`; connection error → `None`.
- [ ] **Step 2: Run** `uv run --project workers/voice python -m unittest discover -s workers/voice/tests` — expect FAIL.
- [ ] **Step 3: Implement.** Name pattern on lowercase NFC text: `\b[jcç][ae]rv[iı]s\w*`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat: add speaker, addressee and Core client logic for the voice service`.

### Task 8: Voice pipeline and local server

**Files:**
- Create: `workers/voice/jarvis_voice/stt_gated.py`, `brain.py`, `tts.py`, `server.py`, `__main__.py`
- Test: `workers/voice/tests/test_brain.py`

**Interfaces:**
- Consumes: Task 7 classes; Task 6 environment.
- Produces:
  - Process contract: env `JARVIS_CORE_URL`, `JARVIS_CORE_TOKEN`, `VOICE_TOKEN`, `VOICE_PORT`, `VOICE_DATA_DIR`; prints `{"event":"voice.ready","port":N}` when listening on 127.0.0.1.
  - HTTP (bearer `VOICE_TOKEN`): `POST /offer` (SmallWebRTC SDP offer → answer, starts a pipeline), `POST /enroll/start`, `POST /enroll/finish` → `{ "enrolled": true }`, `DELETE /enroll` → 204, `GET /health` → `{ "enrolled": bool }`.
  - Data-channel server messages to the UI: `{ "type": "state", "value": "listening" | "thinking" | "speaking" | "idle" }`, `{ "type": "caption", "role": "user" | "jarvis", "text": string }`, `{ "type": "display", "blocks": DisplayBlock[] }`.
  - Log line per turn: `{"event":"turn.timing","sttMs":…,"coreMs":…,"firstAudioMs":…,"totalMs":…}` measured from end of speech.
- [ ] **Step 1: Write the failing tests** for `Brain` (FrameProcessor) driven through a minimal pipeline with a recording sink and a fake `CoreClient`:
  - named transcription → one `TTSSpeakFrame` with the reply `say`, one display message, one jarvis caption; the follow-up window opens.
  - unnamed transcription with closed window → no frames; with open window → Core called with `follow_up=True`; reply `addressed: false` → no speech.
  - Core returns `None` → `TTSSpeakFrame(FALLBACK["tr"])` (Review Focus 4).
  - a second transcription arriving while the first Core call is pending → only the second reply is spoken (Review Focus 5).
- [ ] **Step 2: Run** the unittest command — expect FAIL.
- [ ] **Step 3: Implement.** `stt_gated.py`: subclass of `WhisperSTTService` (`device "cuda"`, settings `model "large-v3"`, `language None`, `hotwords "Jarvis"`) whose `run_stt` embeds the segment, skips it when `SpeakerGate` rejects (when enrolled), and in enrollment mode collects embeddings instead of transcribing. `brain.py`: addressee check, sequence-numbered Core calls, stale-result drop, messages above. `tts.py`: Chatterbox `TTSService` subclass yielding `TTSAudioRawFrame`s at the model sample rate, `language_id` from the reply (or the Piper fallback chosen in Task 6). `server.py`: aiohttp app with SmallWebRTC per pipecat 1.12 docs; transport params enable Silero VAD and Smart Turn v3 (`local-smart-turn`).
- [ ] **Step 4: Run** the unittest command — expect PASS.
- [ ] **Step 5: Commit** `feat: assemble the local voice pipeline and server`.

### Task 9: Desktop shell with secure defaults

**Files:**
- Modify: root `package.json` (`lint` also covers `apps/desktop/src apps/desktop/tests`)
- Create: `apps/desktop/package.json`, `package-lock.json`, `tsconfig.json`, `build.mjs` (esbuild), `src/main/main.ts`, `src/main/env.ts`, `src/main/voice.ts`, `src/preload/preload.ts`, `src/renderer/index.html`, `src/renderer/app.ts`, `src/renderer/styles.css`, `playwright.config.ts`, `tests/shell.spec.ts`

**Interfaces:**
- Consumes: Task 8 process contract; Task 5 HTTP endpoints.
- Produces:
  - `readOperatorEnv(file: string): { coreUrl: string; coreToken: string }` (from `PORT` and `JARVIS_TOKEN` via `util.parseEnv`; throws `ENV_MISSING` / `TOKEN_MISSING`).
  - `startVoiceService(options: { repoRoot: string; coreUrl: string; coreToken: string; dataDir: string }): Promise<{ url: string; token: string; stop(): void }>` (spawns `uv run --project workers/voice python -m jarvis_voice`, random `VOICE_TOKEN`, waits for `voice.ready`).
  - Preload `window.jarvis`: `voice(): Promise<{ url: string; token: string }>`, `onEvent(cb: (e: UiEvent) => void): void`, `turns: { export(): Promise<unknown>; deleteAll(): Promise<void> }`, `enrollment: { start(); finish(); remove() }`, `setListening(on: boolean): void`. `UiEvent` = the Task 8 messages plus `{ type: "error", code: string }`.
  - Env: `JARVIS_ENV_FILE` (required), `JARVIS_DESKTOP_TEST=1` (no voice spawn; enables `test:emit` IPC for state injection).
- [ ] **Step 1: Write the failing Playwright tests** (`_electron.launch`, `JARVIS_DESKTOP_TEST=1`, temp env file with `PORT` and a dummy token): window title `JARVIS`; in the renderer `typeof require === "undefined"` and `Object.keys(window.jarvis)` equals the documented keys; a CSP meta tag exists with `script-src 'self'`; `window.location` stays on the app after `location.assign("https://example.com")`; launching with a missing env file shows `[data-state="error"]` and does not crash; the token string never appears in `document.documentElement.outerHTML`.
- [ ] **Step 2: Run** `npm --prefix apps/desktop test` — expect FAIL.
- [ ] **Step 3: Implement.** `BrowserWindow` with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; block `will-navigate` and `setWindowOpenHandler` → deny; permission handler grants only `media` (audio). Core calls happen in main over IPC; the renderer receives only the voice URL and per-launch voice token.
- [ ] **Step 4: Run** `npm --prefix apps/desktop test` and `npm --prefix apps/desktop run typecheck` — expect PASS.
- [ ] **Step 5: Commit** `feat: add secure Electron shell for JARVIS`.

### Task 10: Presence, stage, captions, overlay and settings

**Files:**
- Create: `apps/desktop/src/renderer/presence.ts`, `stage.ts`, `settings.ts`, `overlay.html`, `overlay.ts`
- Modify: `apps/desktop/src/renderer/app.ts`, `styles.css`, `src/main/main.ts` (tray, `Ctrl+Alt+J`, overlay window)
- Test: `apps/desktop/tests/ui.spec.ts`

**Interfaces:**
- Consumes: Task 9 `UiEvent`, `test:emit`.
- Produces: `document.body.dataset.state` ∈ `idle | listening | thinking | speaking | approval | error`; cards are `[data-card]` elements, at most 3, auto-fading after 20 s unless pinned; caption `[data-caption]` hidden after 6 s.

- [ ] **Step 1: Load the design-taste-frontend skill** and derive the direction from the spec's UI section (dark, quiet, line-drawn presence; no glowing orb, no template dashboard). Record tokens (colour, type, spacing, motion) at the top of `styles.css`.
- [ ] **Step 2: Write the failing tests:** for each state, `test:emit` the state, assert `data-state`, save `artifacts/ui/<state>.png`; display block `{type:"text", body:"<img src=x onerror=alert(1)>"}` renders as literal text with no `img` element; a fourth card replaces the oldest; with `reducedMotion: "reduce"` the presence reports `data-motion="reduced"`; caption, card body and settings text have WCAG contrast ≥ 4.5:1 against their computed background (luminance computed in the test, no new dependency); `electronApp.evaluate` shows `globalShortcut.isRegistered("Control+Alt+J")` and the tray's toggle-listening item flips `body[data-listening]`; overlay window exists, is always-on-top and ignores mouse outside cards.
- [ ] **Step 3: Run** `npm --prefix apps/desktop test` — expect FAIL.
- [ ] **Step 4: Implement** the WebGL presence (line field driven by input/output audio level and state colour, 2D fallback when WebGL is unavailable), stage, captions, settings (voice enrollment flow with three spoken phrases, microphone choice via `enumerateDevices`, delete voice print, export and delete conversation, stop listening), tray menu (Göster, Dinlemeyi durdur/başlat, Çık) and global shortcut.
- [ ] **Step 5: Run** the tests — expect PASS. Review every screenshot against the spec; then run the web-design-guidelines skill on `apps/desktop/src/renderer` and fix findings.
- [ ] **Step 6: Commit** `feat: add JARVIS presence, stage and settings UI`.

### Task 11: End-to-end voice turn

**Files:**
- Modify: `apps/desktop/src/renderer/app.ts` (PipecatClient + SmallWebRTCTransport, `echoCancellation`, `noiseSuppression`, `autoGainControl` all true; bearer voice token on the offer)
- Create: `apps/desktop/tests/e2e.spec.ts` (opt-in: `JARVIS_E2E=1`)

- [ ] **Step 1: Write the opt-in test:** launch Electron with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<repo>/data/voice/samples/e2e-tr.wav` against the dev runtime; enroll from the same file; assert a jarvis caption appears within 15 s, `GET /v1/conversation/turns?limit=1` shows the utterance containing "Jarvis", and the voice log contains `turn.timing`.
- [ ] **Step 2: Generate the test audio** with the Task 6 TTS: "Jarvis, bugün neler yapabiliriz?" plus 1 s of silence, 16 kHz mono WAV.
- [ ] **Step 3: Implement** the client wiring; map server messages to `UiEvent`s.
- [ ] **Step 4: Run** `JARVIS_E2E=1 npm --prefix apps/desktop test -- e2e.spec.ts` with the dev runtime up — expect PASS; copy the `turn.timing` values into the report.
- [ ] **Step 5: Operator live run:** the operator speaks through the real microphone (named, unnamed, follow-up, TV in background); record outcomes and timings; calibrate the speaker threshold from the observed similarity values.
- [ ] **Step 6: Commit** `feat: connect the desktop to the voice service end to end`.

### Task 12: Documentation and final verification

**Files:**
- Create: `docs/ADR/0009-voice-desktop-operator-experience.md`, `apps/desktop/README.md`
- Modify: `docs/ARCHITECTURE.md` (component rows: voice service, desktop app, conversation endpoint), `docs/THREAT_MODEL.md` (spec Security table rows), `.env.example`, `workers/voice/README.md` (run, enrollment, measured VRAM/latency)

- [ ] **Step 1: Write the docs;** the ADR records the decisions table from the spec and the OpenClaw CUA finding.
- [ ] **Step 2: Run** `npm run check`, the voice unittest command, `npm --prefix apps/desktop test` — expect PASS.
- [ ] **Step 3: Stop the dev runtime** (own Core on 2161, `docker rm -f jarvis-voice-pg`); confirm 2160, 18789 and 55432 were untouched.
- [ ] **Step 4: Write the evidence report** in the session notes folder and the final message: each spec item classified as live-verified, tested only, or not run.
- [ ] **Step 5: Commit** `docs: record voice desktop architecture, threats and evidence`.
