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
| POST | `/announce` | Queue something Core announced: `text`, `lang`, `kind` (`progress` or `outcome`), optional `planId` |

Only opaque-origin Electron requests receive CORS headers; preflight discloses no data and does
not authorize subsequent requests. The service uses Pipecat's connection directly because its
optional request-handler helper imports FastAPI, which this aiohttp environment does not require.

Smart Turn decides the semantic end before speaker verification and STT. Raw VAD cannot interrupt
playback. Accepted transcripts are checked for the name/follow-up window, then Core is called once.
A newer addressed turn cancels the pending request and stale replies are dropped. Core failure
speaks a fixed apology in the detected Turkish/English language. With a voice print, JARVIS
keeps listening once addressed: the operator's verified voice needs no name while JARVIS works
or speaks and for eight seconds after each addressed turn and after it stops speaking, so
"Jarvis" ... "saat kaç?" and a new request during a reply are both heard.

Turn-taking has two layers. Smart Turn ends a segment acoustically; then the words decide. A bare
name or a sentence ending on a conjunction or an object pronoun ("Jarvis, bana", "müziği aç ve")
waits 1.5 seconds for the rest, longer while the operator is still talking, and the rest joins it
even before their voice verifies. Anything said before JARVIS answers joins the pending request
(Core is asked again with the whole of it) instead of replacing it; once JARVIS speaks, a new turn
interrupts. Whisper's subtitle credits for noise ("İzlediğiniz için teşekkür ederim.") are
dropped. When Whisper's mean log-probability is below -0.9 the turn goes to Core as `uncertain`,
and Core confirms its reading ("... mı demek istediniz, efendim?") before acting on it.
Enrollment never sends its speech to Core.

JARVIS keeps the conversation going while Core works
([ADR 0016](../../docs/ADR/0016-duplex-conversation-and-live-progress.md)). Announcements wait
in a queue for a natural gap: never while the operator speaks, 1.5 seconds after they stop and a
short pause after JARVIS's own sentence. Outcomes are always spoken; progress keeps the newest
line per plan, is dropped once that plan's outcome is queued and expires after 12 seconds. A turn
Core has not answered within `VOICE_FILLER_SECONDS` (default 1.2; 0 turns it off) gets a short
filler such as "Bir saniye, efendim." and the answer follows it. STT, the speaker model and both
Piper voices warm up when a session opens, so the first turn does not pay their first-use cost.

The default speaker threshold is `0.25`, SpeechBrain's own verification threshold for this ECAPA
model: a one-second wake phrase from the enrolled speaker scores 0.3-0.8, other voices about
0.04-0.17 on average, and the former `0.7` turned the operator away. `VOICE_SPEAKER_THRESHOLD`
(in the operator `.env` for the desktop app) overrides it. On microphones other than the
print's the operator's own speech scored 0.08-0.25, so every segment is decoded: speech that
names JARVIS passes whatever its score, and the print only decides unnamed follow-ups. Each turn
that names JARVIS is kept in memory (last ten) as a second reference for the current microphone,
so follow-ups verify against the voice as this microphone hears it; nothing new is saved.

Each turn's stages go to `VOICE_DATA_DIR/voice.log` as numbers and flags only (segment length,
speaker score, transcript length and language, whether the name was heard, Core's answer), so a
turn that never reaches Core shows where it stopped; `bandwidthHz` near 3400 means a Bluetooth
hands-free microphone. On that narrowband audio Whisper's free language pick heard "Jarvis, saat
kaç?" as Urdu and "Jarvis" as "Yani", so decoding is Turkish unless English leads clearly, with
"Jarvis" as the initial prompt, and a segment is skipped only when Whisper doubts both speech and
words (`no_speech_prob >= 0.6` and `avg_logprob < -1.0`). A wired or built-in microphone still
recognizes better than a Bluetooth headset's. This print filters conversation, not security approvals.
Vendor debug logging is disabled to avoid transcript logs. Numeric `turn.timing` output reports
STT, Core, synthesis and first-generated-audio latency; speaker score logs support local calibration.
Physical output-device latency is not measured. Current full-path observations: 3.25–4.75 seconds
to first generated audio, slower than the 2.5-second target.

Verification and operator checks: [M1 evidence](../../docs/VOICE_DESKTOP_EVIDENCE.md).
