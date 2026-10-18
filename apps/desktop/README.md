# JARVIS desktop (M1)

Electron shell for the approved talking-JARVIS milestone. Turkish and English microphone input
stays local until an addressed transcript is sent to Core. Core owns model routing and records.
Computer actions and long-term memory belong to later milestones.

## Run on this Windows checkout

From the repository root, with Node 24 and `uv` on PATH:

```powershell
npm --prefix apps/desktop ci
uv sync --frozen --directory workers/voice
npm run build
$env:JARVIS_ENV_FILE = (Resolve-Path .env).Path
npm --prefix apps/desktop start
```

The Core named by `JARVIS_ENV_FILE` must be running and built from this revision: it serves the
`/v1/conversation` endpoints the voice service calls. A Core started before this code was merged
lacks them, so rebuild and restart it first. `JARVIS_ENV_FILE` must be an absolute path to the
Core configuration containing its `PORT` and `JARVIS_TOKEN`. Only the main process reads that
token. It launches an authenticated loopback voice service automatically and terminates its
process tree on exit. Provider credentials are never copied into the desktop directory or voice
child environment. The voice models live in the gitignored `data/voice/models`.

`VOICE_SPEAKER_THRESHOLD` (default `0.7`), when set before launch, is passed to the voice
service for calibration with the operator's microphone.

## Use

- Say “Jarvis” (Turkish spelling variations are accepted), then speak normally. Without a voice
  print, the assistant requires its name. After a reply, an eight-second follow-up window opens.
- Settings (gear, top right) → **Sesimi tanıt**: read the rotating sentences aloud while the line
  fills; **Tamamla** unlocks after 25 of 30 seconds. **Vazgeç**, or closing the sheet, cancels and
  returns the service to listening. Only an embedding is saved, never a recording. **Ses izini
  sil** removes it after a confirmation. The similarity threshold still needs calibration.
- **Ctrl+Alt+J**, the footer control and tray menu toggle listening. Closing the main window
  leaves the tray and edge overlay running; **Çık** quits. The overlay accepts pointer input only
  over its cards. After a voice error, **Yeniden dene** reconnects and restarts a crashed service.
- Cards expire after 20 seconds; pin a card to keep it. Up to three show beside the presence.
  Captions stay 7–14 seconds depending on length. Settings exports conversation records as JSON
  and confirms before deleting them.

The visual system is recorded in [DESIGN.md](DESIGN.md).

Voice prints default to `data/voice/operator.npy` in this checkout. `VOICE_DATA_DIR` can select
another local directory; the end-to-end test uses a disposable directory. Audio denoising, echo
cancellation and automatic gain control are requested from Chromium. Reduced-motion preferences
disable animated presence and card transitions.

## Verify

```powershell
npm run check
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop test
uv run --frozen --directory workers/voice python -m unittest discover -s tests
uv run --frozen --directory workers/voice ruff check jarvis_voice tests
uv run --frozen --directory workers/voice mypy jarvis_voice
```

The opt-in GPU/WebRTC test requires the development Core and the generated fixture
`data/voice/samples/e2e-tr.wav` (16 kHz mono PCM):

```powershell
$env:JARVIS_E2E = '1'
npm --prefix apps/desktop test -- e2e.spec.ts
Remove-Item Env:JARVIS_E2E
```

Run Electron tests sequentially: concurrent app instances compete for the global shortcut.
Evidence and remaining operator checks: [M1 report](../../docs/VOICE_DESKTOP_EVIDENCE.md).
