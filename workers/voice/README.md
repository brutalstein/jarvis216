# JARVIS voice service

Local speech pipeline for the desktop app (Pipecat 1.12, Python 3.12, uv). It listens over a
loopback WebRTC connection, keeps only the operator's speech that is meant for JARVIS, sends each
turn to Core's `POST /v1/conversation/turns` and speaks the reply.

## Setup

```powershell
uv sync --directory workers/voice
uv run --directory workers/voice python -m jarvis_voice.smoke
```

The smoke test prints one JSON line per check (CUDA, TTS, STT, speaker embedding, VRAM) and writes
samples to `data/voice/samples/` (gitignored). Models download on first run into the Hugging Face
cache (Whisper large-v3, about 3 GB) and `data/voice/models/` (Piper voices, ECAPA).

## Decisions and measurements (2026-10-17, RTX 5070 Laptop 8 GB, torch 2.11.0+cu128)

| Item | Result |
| --- | --- |
| STT | faster-whisper large-v3, CUDA float16: 340 ms for a 2-3 s Turkish or English sentence, language detected correctly |
| TTS | Piper `tr_TR-dfki-medium` (Turkish) and `en_GB-alan-medium` (English) on CPU: 53-83 ms per sentence |
| Speaker | SpeechBrain ECAPA (`speechbrain/spkrec-ecapa-voxceleb`), 192 dimensions, about 300 ms |
| VRAM | 5.1 GB used in total with Whisper and ECAPA loaded |

Chatterbox Multilingual (the spec's first choice) was measured and set aside: 4.1 s to synthesise a
2-3 s sentence (target under 1.5 s), an English sample ended in invented speech, and total VRAM
reached 7.6 GB of 8 GB. It also pins torch 2.6.0, which has no kernels for this GPU, and
transformers 5.2.0, which conflicts with Pipecat's Smart Turn. Piper is the spec's documented
fallback. `tr_TR-dfki-medium` is the only Turkish Piper voice published in `rhasspy/piper-voices`.
The voice choice still needs the operator's ear; alternative English sample:
`data/voice/samples/en_GB-northern_english_male-medium.wav`.

`torchaudio` 2.11 needs `torchcodec` for file I/O, so audio files are read and written with
`soundfile`; `torchaudio.functional` is still used for resampling.

## Runtime

Electron starts `uv run --frozen --directory workers/voice python -m jarvis_voice` with
`JARVIS_CORE_URL`, `JARVIS_CORE_TOKEN`, random `VOICE_TOKEN`, `VOICE_PORT=0` and `VOICE_DATA_DIR`.
The service binds only `127.0.0.1` and prints `{"event":"voice.ready","port":N}` after binding.
All HTTP endpoints require `Authorization: Bearer <VOICE_TOKEN>`:

| Method | Path | Purpose |
| --- | --- | --- |
| POST / PATCH | `/offer` | One SmallWebRTC peer, offer/answer and ICE updates |
| GET | `/health` | Enrollment flag and captured enrollment duration |
| POST | `/enroll/start` | Start collecting speaker embeddings in memory |
| POST | `/enroll/finish` | Persist the normalized print (at least 3 segments and 25 seconds); otherwise 409 |
| DELETE | `/enroll` | Delete the print and cancel enrollment |

Only opaque-origin Electron requests receive CORS headers; preflight discloses no data and does
not authorize subsequent requests. The service uses Pipecat's connection directly because its
optional request-handler helper imports FastAPI, which this aiohttp environment does not require.

Smart Turn decides the semantic end before speaker verification and STT. Raw VAD cannot interrupt
playback. Accepted transcripts are checked for the name/follow-up window, then Core is called once.
A newer addressed turn cancels the pending request and stale replies are dropped. Core failure
speaks a fixed apology in the detected Turkish/English language. The follow-up window opens after
bot playback stops. Enrollment never sends its speech to Core.

The default speaker threshold is `0.7`; a manually launched voice process can set
`VOICE_SPEAKER_THRESHOLD` for calibration. This print filters conversation, not security approvals.
Vendor debug logging is disabled to avoid transcript logs. Numeric `turn.timing` output reports
STT, Core, synthesis and first-generated-audio latency; speaker score logs support local calibration.
Physical output-device latency is not measured. Current full-path observations: 3.25–4.75 seconds
to first generated audio, slower than the 2.5-second target.

Verification and operator checks: [M1 evidence](../../docs/VOICE_DESKTOP_EVIDENCE.md).
