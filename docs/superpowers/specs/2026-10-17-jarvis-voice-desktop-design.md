# JARVIS voice desktop experience — design

Date: 2026-10-17. Status: approved section by section in conversation; pending written-spec review.

## Intent

The operator talks to JARVIS, in Turkish or English, and JARVIS answers by voice only when it is
addressed. JARVIS has its own character (calm, very capable, dry wit, loyal; formal at first and
warmer over time), routes across many models, shows things on screen by itself, later controls the
computer under Core's approval model, remembers the operator like a friend, and proposes its own
improvements for operator review.

Success for this session: milestone M1 (below) works end to end on this laptop, with passing tests,
visual verification of every UI state, and an honest record of what was verified live.

## Operator decisions (2026-10-17)

| Topic | Decision |
| --- | --- |
| Platform | Desktop application (Electron), tray resident, global hotkey, edge overlay |
| Computer control | Tiered: LOW automatic, MEDIUM one tap, HIGH tap plus Windows Hello; no payments or passwords |
| Control technology | Reuse proven systems (Windows-MCP, Browser Use, OpenClaw, n8n); no from-scratch controller |
| Self-improvement | Behaviour proposals with on-screen diff and approval; code proposals only on a separate git branch with passing tests; the operator merges |
| Character | The film's JARVIS, becoming warmer as it learns the operator |
| Risky-action confirmation | MEDIUM: tap the on-screen card. HIGH: tap plus Windows Hello. Voice is never an approval |
| Memory capture | Automatic and visible; sensitive categories are asked first; audio is never stored |
| Speech recognition | Local GPU |
| Privacy routing | Tiered: everyday and non-sensitive personal context may reach Gemini and free models; sensitive context only reaches Claude Code |
| Architecture | Electron UI + local Python voice service (Pipecat) + Core as the authority |
| Automations | n8n workflows authored by Claude Code and reviewed by Codex (or the reverse) |

## Constraints and evidence

Host: Windows 11 native (no WSL), RTX 5070 Laptop 8 GB (Blackwell), Ryzen 9 8945HX, 31 GB RAM,
Python 3.12 + uv, Node 24. Windows Hello reports `Available` (checked 2026-10-17).

Primary sources and live checks (2026-10-17):

- Pipecat ([README](https://github.com/pipecat-ai/pipecat)): open-source voice pipeline with Silero
  VAD, RNNoise, local Whisper, SmallWebRTC and local transports.
- Smart Turn v3.2 ([README](https://github.com/pipecat-ai/smart-turn)): audio-native end-of-turn
  model, 23 languages including Turkish, about 10–65 ms on CPU.
- CTranslate2 4.6.3 added CUDA 12.8 support
  ([changelog](https://github.com/OpenNMT/CTranslate2/blob/master/CHANGELOG.md)); faster-whisper
  can therefore run on Blackwell. No neutral Turkish head-to-head STT benchmark was found; Whisper
  large-v3 is the practical choice and will be measured on the operator's speech.
- Chatterbox Multilingual (MIT, 23 languages including `tr`)
  ([repo](https://github.com/resemble-ai/chatterbox)) gives one voice for Turkish and English.
  No independent Turkish quality evaluation exists; the final voice is chosen by a listening test.
- Windows-MCP (MIT, about 6k stars) ([README](https://github.com/CursorTouch/Windows-MCP)): typed
  tools (App, Click, Type, Scroll, Shortcut, Snapshot, Screenshot, FileSystem, Clipboard, Process,
  PowerShell, Registry, …) with `--tools` / `--exclude-tools` allowlisting.
- OpenClaw 2026.10.4 local docs (`docs/nodes/computer-use.md`): the Windows CUA computer tool is
  experimental and has no per-action confirmation once enabled. Core therefore cannot gate each
  input through it, so it is not used for per-action desktop control.
- Gemini API Additional Terms (effective 2026-03-23, [terms](https://ai.google.dev/terms)): unpaid
  quota inputs and outputs may be used to improve Google products and may be read by human
  reviewers.
- OpenRouter free models: 20 requests/minute and 50/day, or 1000/day after a 10 USD top-up
  ([OpenRouter comparison](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)); data
  use depends on the upstream provider.
- NVIDIA API Catalog: a trial for evaluation and prototyping; rate limits vary per model and load
  ([NVIDIA NIM FAQ](https://forums.developer.nvidia.com/t/nvidia-nim-faq/300317)).
- mem0 supports a pgvector backend ([docs](https://docs.mem0.ai/components/vectordbs/dbs/pgvector));
  an independent LoCoMo study found mem0 more efficient than Graphiti with no significant accuracy
  difference ([arXiv 2601.07978](https://arxiv.org/abs/2601.07978v1)).

Live model probes (one streamed Turkish persona turn each, single sample; details in the session
notes `live-model-probes.md`): Gemini 3.5 Flash answered in about 1.3 s with fluent Turkish and
consistent character. Working free models: OpenRouter `dots-studio/dots-3-note-preview:free`
(about 2.9 s), `nvidia/nemotron-3-super-120b-a12b:free` (about 4.4 s), NVIDIA `openai/gpt-oss-20b`
(about 3.7 s), NVIDIA `nvidia/nemotron-3-super-120b-a12b` (about 16 s). Many free endpoints timed
out (60 s), returned 404 for this account, 429 upstream, or spent the whole budget on reasoning.
Conclusion: free models are fallbacks and background workers, not the realtime primary.
Gemini also claimed it had "set" a reminder it could not set: action claims need a structural guard.

## Milestones

- **M1 Talking JARVIS (this session):** desktop shell and UI, voice capture, speaker and addressee
  gating, local STT, multi-model conversation through Core, character, voice reply, on-screen
  display blocks. No computer actions.
- **M2 Memory (this session if time allows, else next):** local long-term memory in Core.
- **M3 Actions:** Windows-MCP desktop control, Browser Use, OpenClaw long tasks, n8n automations.
- **M4 Self-improvement:** reviewed behaviour and code proposals.

M2–M4 are fixed here at the interface level; each gets its own spec and plan cycle.

## Architecture

```
Microphone → Electron renderer (getUserMedia: echo cancellation, noise suppression, AGC)
  → WebRTC on 127.0.0.1 → voice service (workers/voice, Pipecat, Python)
      Silero VAD + Smart Turn end-of-turn → speaker verification → faster-whisper large-v3 (GPU)
      → addressee gate
  → Core POST /v1/conversation/turns (operator token)
      character + recent turns (+ memory in M2) → privacy class → provider order → task
      → ActionGateway → executor → verification → result
  ← reply { addressed, say, lang, display[] }
  → Chatterbox TTS (GPU) → WebRTC → speakers;  display[] → data channel → UI stage
```

Core stays the only authority for tasks, routing, privacy policy, approvals and records. The voice
service holds no policy; the Electron renderer holds no secrets.

### Core changes

1. **OpenAI-compatible executor** (`src/integrations/openai-compatible.ts`): one class for
   OpenRouter (`https://openrouter.ai/api/v1`) and NVIDIA (`https://integrate.api.nvidia.com/v1`),
   built on `fetch` with no new SDK. Each configured model is its own provider id
   (`or-<model-slug>`, `nv-<model-slug>`, at most 40 characters), so each has its own circuit
   breaker. Failure classification: 429 → `rate-limited`; 401/403 → `authentication-required`;
   404 → `permanent` (model not served to this account); 5xx → `provider-unavailable`; network
   errors → `transient` with the existing never-dispatched rule; empty content or
   `finish_reason: length` with no text → `invalid-response`. OpenRouter requests ask to exclude
   reasoning. `external: true`, `retrySafe: true`.
2. **Configuration:** `ENABLE_OPENROUTER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` (comma list);
   `ENABLE_NVIDIA`, `NVIDIA_API_KEY`, `NVIDIA_MODELS`. Only models that passed a live probe are
   listed in `.env`.
3. **Privacy:** add `personal` to the privacy enum. Gateway floor becomes: external provider and
   `private` and provider not in `JARVIS_PRIVATE_PROVIDERS` → HIGH (today's behaviour for every
   external provider). `personal` adds no floor: it records the operator's standing consent that
   non-sensitive personal context may reach any configured provider. The trust list is part of
   the provider configuration string, so an approval hash changes when trust changes.
4. **Verification:** add `{ kind: "non-empty" }` for conversational replies: the trimmed result
   text must be non-empty. Reconciliation treats it the same way.
5. **Conversation endpoint:** `POST /v1/conversation/turns` with
   `{ utterance (1–4000 chars), followUp: boolean }`. Core builds the prompt, classifies privacy,
   chooses the provider list, admits a `text.generate` task, wakes the worker, waits for a
   terminal state up to the turn deadline (20 s), parses the reply and stores the turn. One HTTP
   request per turn, so the existing operator rate limit is not exhausted by polling.
   `GET /v1/conversation/turns` exports turns; `DELETE /v1/conversation/turns` deletes all.
   Turns older than 30 days are purged at startup.
6. **Worker wake:** admission wakes an idle worker immediately instead of waiting for the 500 ms
   idle delay.

### Provider order and privacy classes

| Turn class | When | Providers, in order |
| --- | --- | --- |
| `personal` | no sensitive context | `gemini` → configured `or-*` → configured `nv-*` → `claude-code` |
| `private` | sensitive context included (M2) | `claude-code` only (listed in `JARVIS_PRIVATE_PROVIDERS`) |

`budget.maxCalls` covers the fallbacks; each provider failure is classified before fallback as
Core does today. Codex is not in the realtime order: its HIGH floor would require an approval per
turn.

### Reply contract

The prompt asks for one JSON object; the parser is tolerant:

```json
{ "addressed": true, "say": "…", "lang": "tr", "display": [ { "type": "list", "title": "…", "items": ["…"] } ] }
```

- `addressed: false` (only meaningful in the follow-up window) → JARVIS stays silent.
- `display` blocks are validated with Zod: `text { title?, body }`, `list { title?, items[] }`,
  `code { language?, code }`; at most 3 blocks; bounded sizes. Invalid blocks are dropped. No HTML,
  images or URLs are rendered in M1.
- Unparseable output becomes `{ addressed: true, say: <text> }`.
- The character prompt forbids claiming actions; in M1 JARVIS has none and says so plainly. From
  M3 the UI shows only Core's recorded action states, never model claims.

### Character

A Core-owned prompt (`src/persona.ts`): JARVIS knows it is JARVIS, the operator's personal
assistant running on this computer; calm, precise, dry understated wit, loyal; replies in the
operator's language, usually one or two sentences; addresses the operator as "efendim"/"sir"
initially and grows warmer as memory accumulates (M2); never invents facts or completed actions.

### Voice service (`workers/voice`, Python 3.12, uv, Pipecat)

- Transport: SmallWebRTC on 127.0.0.1 with a per-launch token. Chromium provides echo
  cancellation for JARVIS's own voice because playback runs through the same WebRTC session.
- Pipeline: Silero VAD and Smart Turn v3 (end of turn) → speaker gate → faster-whisper `large-v3` on CUDA →
  addressee gate → Core client → Chatterbox Multilingual TTS → output. Barge-in is allowed only for
  verified operator speech.
- Speaker gate: ECAPA embedding (SpeechBrain, Apache-2.0) compared with the enrolled operator
  embedding by cosine similarity. Enrollment records about 30 s of the operator's speech through
  the same pipeline and stores only the embedding under `data/voice/` (gitignored, deletable).
  The threshold is calibrated on this microphone with the operator's speech and TV/other speech.
  Unverified speech is never transcribed. Before enrollment, JARVIS answers only when named.
- Addressee gate: a turn is addressed if the transcript contains JARVIS's name (Turkish-aware
  fuzzy match: jarvis, carvis, cervis, jarvıs, çarvis) or arrives within 8 s after JARVIS spoke
  (follow-up window, sent with `followUp: true`). Everything else is dropped without storage.
- Per-turn timing is logged (speech end, STT done, Core done, first TTS audio) to measure the
  2.5 s target from end of speech to first audio. The target is measured, not guaranteed.
- The Core token arrives through the process environment from Electron's main process.

### Desktop application (`apps/desktop`, Electron, TypeScript)

- Main process: reads the operator `.env` path given by `JARVIS_ENV_FILE`, starts the voice
  service with only the variables it needs, owns the tray, the global hotkey (toggle listening)
  and the overlay window, and relays Core calls over IPC. It never passes secrets to the renderer.
- Renderer: `contextIsolation`, `sandbox`, strict CSP, no Node integration, no remote content.
- UI: a dark, quiet, precise surface. The centre is a living line-drawn presence (WebGL) that
  reacts to the operator's and JARVIS's voice; states are expressed by colour and motion, not
  text: sleeping, listening, thinking, speaking, awaiting approval. The stage shows up to 3 display
  cards that fade with time and can be pinned. Captions show only the latest sentence, briefly.
  The edge overlay shows a small presence and approval cards while the main window is hidden;
  only card areas receive clicks. Settings: voice enrollment, microphone, memory (M2), stop
  listening. Reduced motion, keyboard approval and AA contrast are required.
- Design direction uses the design-taste-frontend guidance; verification uses Playwright's
  Electron support with screenshots of every state.

## Security

| Threat | Control |
| --- | --- |
| Spoofed or replayed voice, TV, other people | Speaker gate only opens conversation; voice never approves; MEDIUM needs a tap, HIGH needs a tap plus Windows Hello (M3) |
| Background speech leakage | Unverified or unaddressed speech is dropped before STT or immediately after; no audio is stored |
| Personal data to providers that may train | Privacy classes; sensitive context only to `JARVIS_PRIVATE_PROVIDERS`; every dispatch is a recorded Core action |
| Secret exposure | Keys stay in the main checkout `.env`; only Electron main reads it; renderer has none; loopback only |
| Model output injection into UI | Zod-validated display blocks, text-only rendering, CSP |
| False action claims | No actions in M1; from M3 the UI shows Core action records only |
| Local service abuse | Voice service and Core bind 127.0.0.1 and require tokens |

## M2 Memory (interface)

Core-owned PostgreSQL tables: `memories` (kind: episode, fact, habit; text; sensitivity; strength;
last_used_at; source turn) with Turkish full-text search (`to_tsvector('turkish', …)`); no vector
database until a measured retrieval need exists (directive §12). After each turn a background
`text.generate` task proposes memory operations in mem0's add/update/delete/no-op style; normal
items are written automatically, sensitive ones are asked first. Strength decays unless the item is
used. Endpoints list, edit, delete, delete all, and export JSON; a memory screen exposes them.

## M3 Actions (interface)

- New capability `desktop.act`: Core is the only MCP client of Windows-MCP (stdio, allowlisted
  tools). Risk map: Screenshot, Snapshot, App launch/switch = LOW; Click, Type, Scroll, Shortcut,
  Clipboard, FileSystem write/move inside allowed folders = MEDIUM; FileSystem delete, Process kill
  = HIGH; PowerShell and Registry excluded by default; payments and passwords never.
- Browser tasks use the existing Browser Use worker; long agent jobs use OpenClaw (HIGH per task).
- n8n automations: Claude Code drafts workflow JSON, Codex reviews it (or the reverse); Core
  validates it; creating an inactive draft is MEDIUM; activation is HIGH.
- Approvals: MEDIUM by tapping the card; HIGH by tap plus Windows Hello (UserConsentVerifier),
  bound to Core's exact action hash.

## M4 Self-improvement (interface)

Proposals queue in Core. Behaviour proposals (character notes, routines, routing preferences,
memory consolidation) show a diff and need approval. Code proposals are produced by Claude Code or
Codex in a separate git worktree branch with tests passing; the operator merges. Nothing applies
itself.

## Testing and verification

- Core: Vitest, test first: executor classification with stubbed `fetch`, configuration parsing,
  privacy floors, `non-empty` verification, conversation endpoint with a fake executor, worker
  wake, retention purge; regenerated JSON schemas.
- Voice service: Python unit tests for the addressee matcher, follow-up window, speaker gate
  decisions on synthetic embeddings and the reply contract; an end-to-end run with recorded
  Turkish audio files.
- Desktop: Playwright Electron tests for IPC wiring, CSP and every UI state, with screenshots;
  Chromium fake audio capture for a full pipeline run.
- Live evidence is reported in three classes: live-verified, tested only, not run.

## Out of scope for M1

Computer actions, approvals UI, memory, self-improvement, wake word without speech recognition,
token streaming from providers, installers and code signing.

## Risks

- faster-whisper and PyTorch on Windows need matching CUDA 12.8 runtime DLLs; setup is verified
  before the pipeline is built on it.
- 8 GB VRAM must hold Whisper and Chatterbox together; measured early, with Piper Turkish voices
  as the documented fallback if it does not fit.
- Free model availability changes daily; the configured list is re-probed before use.
- Speaker verification accuracy depends on calibration; it is a conversation filter, not a
  security boundary.
