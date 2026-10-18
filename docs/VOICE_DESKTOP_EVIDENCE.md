# Voice desktop M1 evidence

Continuation date: 2026-10-18 (Europe/Istanbul). Branch: `claude/jarvis-voice-ui-12a172`,
merged into `main`. Resumed from Claude's completed tasks 1–7 and its uncommitted desktop package
manifest; task 8 was not implemented when the previous session hit its limit. Existing changes
were preserved. Claude then replaced the renderer with a from-scratch design at the operator's
request ([DESIGN.md](../apps/desktop/DESIGN.md)) and added enrollment cancel and voice restart.

## Live verification

The opt-in Electron test uses a synthetic Turkish WAV as Chromium's microphone, an ephemeral
authenticated Python voice process, GPU Whisper, Core on `127.0.0.1:2161`, its configured live
provider, and local Piper TTS. It checks a transcript in Core's conversation export, a reply
caption, generated-audio timing, and an actively playing remote audio stream. It also gathers
real ECAPA embeddings from the same input, enrolls into a disposable directory, verifies the
enrollment flag and deletes the print. No operator enrollment is overwritten.

| Run | STT | Core | Piper synthesis | End of speech → first generated audio |
| --- | ---: | ---: | ---: | ---: |
| Initial successful WebRTC turn | 719 ms | 1984 ms | 281 ms | 3247 ms |
| Turn with enrollment exercise | 625 ms | 3594 ms | 297 ms | 4747 ms |
| Turn through the redesigned renderer | 672 ms | 1656 ms | 1859 ms | 4450 ms |
| After the final review fixes (Gemini answered) | 844 ms | 1375 ms | 359 ms | 2825 ms |

These are individual measurements, not a latency distribution. The 2500 ms target is **not met**.
The third run's Piper time is six times the earlier runs; its cause (reply length, a cold voice or
CPU contention) was not isolated.

Two end-to-end runs after the final review fixes then failed at a later step. Gemini's free tier
returned `rate-limited` and `provider-unavailable`; the OpenRouter fallback answered, but more
slowly than the looping test audio repeats (about every 6 s), so each new repetition superseded
the pending reply before it was spoken. In the second run the first turn passed (row above) and
the post-enrollment turn failed this way. Core's task events show the provider failures; no code
fault was found. A live run with an available Gemini quota is still needed after these fixes.
`firstAudioMs` and `totalMs` currently identify first server-generated audio; they exclude output
device latency and do not claim microphone-to-physical-speaker measurement.

## Automated verification

- Core: typecheck, Biome lint and build pass; Vitest, run in two parts so the inherited flaky
  Claude child-process file runs alone. On `main` after the merge: 129 tests pass, one opt-in
  PostgreSQL test skipped.
- Voice: unittest suite — 21 tests pass, including the enrollment-cancel test; Ruff
  (lint and format) and strict mypy pass.
- Desktop: Twelve ordinary Electron tests. Two cover isolation, the bounded preload bridge,
  CSP, blocked navigation and missing configuration. Ten cover the redesigned renderer: a distinct
  colour, word and capture for all six states, latest-only captions styled by speaker and their
  expiry, inert HTML in cards, the three-card limit, pin and expiry, reduced motion, the listening
  toggle from button and tray path, shortcut and always-on-top overlay, the settings sheet and its
  confirmed delete, the error notice with retry, 4.5:1 text contrast, overlay mirroring, and
  layout without overflow at 700×560, 1080×760 and 1440×900. The GPU end-to-end test is opt-in.
- Desktop typecheck and the root Biome lint pass.
- Captures are under gitignored `artifacts/ui/`; they were reviewed against DESIGN.md, and the
  Vercel Web Interface Guidelines review found a missing `h1`, an unconfirmed voice-print
  deletion, missing overscroll containment, a missing hover state and errors without a next step;
  all were fixed.
- Retry restarting a crashed voice service is implemented but not exercised by a test.

An intermediate UI test failed because the simultaneously running end-to-end app owned
Ctrl+Alt+J. The suites must run sequentially; this is not evidence of a working multi-instance mode.
Live testing also exposed and corrected a non-serializable voice IPC reply, blob-worklet CSP
incompatibility, and an uninstalled FastAPI dependency in Pipecat's optional HTTP helper.

## Evidence boundaries / operator checks

| Item | Classification |
| --- | --- |
| Synthetic Turkish speech → local STT → Core → reply audio | Live verified |
| Speaker enrollment from the synthetic source; local print deletion | Live verified |
| English recognition and both Piper voices | Previous Claude GPU smoke evidence; English fallback covered by current unit tests |
| Ignored unnamed speech, rejected follow-up, stale reply suppression and network-failure apology | Automated tests |
| Cancelled enrollment returns to listening and keeps an existing print | Automated test |
| Redesigned renderer states, settings, overlay and layout | Automated tests with captures; not operator-reviewed |
| Real microphone accuracy, echo/TV rejection and speaker threshold | Not operator-verified |
| Operator preference for the Turkish/English voice | Not operator-verified; samples remain in `data/voice/samples/` |
| Physical playback quality and latency at the operator's speakers | Not operator-verified |
| Overlay pointer forwarding on real Windows desktop interactions | Implemented; visual/native interaction check remains |
| Memory, computer actions, Windows Hello approval, self-improvement | M2–M4, outside M1 |

The inherited development Core (`2161`) and its disposable PostgreSQL (`55433`) were reused,
then stopped and removed at the end. Test-owned voice
process trees are terminated when each Electron app closes. The original services on 2160, 18789,
55432 and the operator's PostgreSQL on 5432 were not stopped or reconfigured.

Run instructions: [desktop README](../apps/desktop/README.md).
