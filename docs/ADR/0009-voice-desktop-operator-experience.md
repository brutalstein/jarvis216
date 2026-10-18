# ADR 0009: Local voice desktop, Core-owned conversation

Status: accepted for M1. Operator decisions: 2026-10-17; continuation verified 2026-10-18.

## Decision

Reuse Core for every model call, routing, private-data trust, task state and conversation record.
Add a sandboxed Electron desktop and a local Pipecat voice process. M1 converses and displays
text-only cards; it cannot execute computer actions.

| Operator choice | Implementation / milestone |
| --- | --- |
| Desktop, tray, hotkey and edge overlay | Electron M1 |
| Local GPU recognition | faster-whisper large-v3 on CUDA; Silero VAD and Smart Turn v3 |
| Only the operator, only when addressed | ECAPA speaker embedding; Turkish-aware name gate; eight-second follow-up |
| Film JARVIS character, warmer with familiarity | Core persona now; long-term memory in M2 |
| Everyday personal context may reach Gemini and free providers | `personal` privacy; listed Gemini / OpenRouter / NVIDIA / Claude Code routing |
| Sensitive context goes to Claude Code | Explicit trusted-private provider configuration; sensitive memory classification in M2 |
| LOW actions automatic, MEDIUM tap, HIGH tap plus Windows Hello | M3; voice never grants approval |
| Existing Windows-MCP / Browser Use / OpenClaw / n8n controllers | M3; no new controller in M1 |
| Local visible automatic memory; sensitive categories asked first | M2; M1 keeps addressed conversation transcripts with export/delete and 30-day purge |
| Reviewed behaviour proposals and code on separate branches | M4; no autonomous code/config changes |
| Claude Code / Codex authored and cross-reviewed automations | M3/M4; no workflow authoring in M1 |

OpenClaw's experimental Windows CUA tool has no per-action confirmation once enabled. It is
therefore unsuitable for bypassing Core's action-by-action approval boundary. Existing OpenClaw
integration remains delegated work under Core, without direct desktop-control authority here.

## Implementation adjustments

Chatterbox was rejected by the earlier live measurements: about 4.1 seconds synthesis, an English
audio artefact, and 7.6 GB total VRAM on the 8 GB GPU. The spec's Piper fallback is used instead:
`tr_TR-dfki-medium` and `en_GB-alan-medium` on CPU. Voice preference still needs operator listening.

The pinned SDK's WAV media manager requires blob AudioWorklets, which the renderer's `script-src
'self'` policy blocks. A small native `getUserMedia` adapter supplies audio tracks to the existing
SmallWebRTC transport and uses a native analyser for levels. Camera and screen capture remain
disabled. Microphone replacement uses the pinned transport's `pc` peer; this integration must be
checked when upgrading that dependency.

The Pipecat request-handler helper imports FastAPI, absent from the approved voice environment.
The aiohttp signalling endpoints use Pipecat's existing `SmallWebRTCConnection` directly, retaining
one authenticated peer and no extra web framework. Smart Turn runs before segmented STT with
`wait_for_transcript=False`; only its semantic end-of-turn flushes speech for verification/STT.
Raw VAD never interrupts playback. Only addressed, speaker-verified transcripts can replace a reply.

The first renderer was replaced on the operator's request by a from-scratch design, recorded in
[apps/desktop/DESIGN.md](../../apps/desktop/DESIGN.md): stone neutrals derived from the
ElevenLabs DESIGN.md token base, one state colour per presence state, WebGL hairline rings,
Inter and EB Garamond, and Phosphor icons, all bundled locally under the unchanged CSP. Settings is
a right-hand sheet. An abandoned enrollment left the service collecting a print instead of
transcribing, so the voice service gained `POST /enroll/cancel`, and closing the sheet cancels.
Retry after a voice error restarts a service that crashed or failed to start.

Core credentials stay in Electron main and the voice child. The renderer receives only a random
per-launch voice token. Navigation, popups, webviews and non-audio permission requests are blocked.
Display cards use DOM text nodes, with no model-provided HTML or executable code.

## Consequences

The measured first generated audio is currently slower than the 2.5-second target. Real microphone
quality, voice preference, TV rejection, speaker threshold and physical speaker playback require
the operator. M1 does not establish voice authentication or production readiness. See the
[evidence report](../VOICE_DESKTOP_EVIDENCE.md) for measured and unverified gates.
