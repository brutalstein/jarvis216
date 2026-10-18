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
$env:JARVIS_ENV_FILE = (Resolve-Path .env.voice-dev).Path
npm --prefix apps/desktop start
```

The inherited development Core on `127.0.0.1:2161` and its disposable PostgreSQL on `55433`
must be running. `.env.voice-dev` is an existing gitignored development configuration, not a
shipped credential file. The original Core on `2160` does not include this branch's conversation
endpoint; do not point this UI at it until the branch is integrated.

If the development Core needs starting, use a separate terminal at this repository root:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=C:\Users\cenke\OneDrive\Desktop\jarvis216\.env --env-file=.env.voice-dev dist/main.js
```

For another installation, `JARVIS_ENV_FILE` must be an absolute path to the Core configuration
containing its `PORT` and `JARVIS_TOKEN`. Only the main process reads that token. It launches an
authenticated loopback voice service automatically and terminates its process tree on exit.
Provider credentials are never copied into the desktop directory or voice child environment.

## Use

- Say “Jarvis” (Turkish spelling variations are accepted), then speak normally. Without a voice
  print, the assistant requires its name. After a reply, an eight-second follow-up window opens.
- Settings → **Sesimi tanı**: read the three prompts for about 30 seconds, then **Kaydı tamamla**.
  More speech may be required; only an embedding is saved, never a recording. **Ses izini sil**
  removes it. The similarity threshold still needs calibration using the operator's microphone.
- **Ctrl+Alt+J**, the footer control and tray menu toggle listening. Closing the main window
  leaves the tray and edge overlay running; **Çık** quits. The overlay accepts pointer input only
  over its cards.
- Cards expire after 20 seconds; pin a card to keep it. Captions disappear after six seconds.
  Settings exports conversation records as JSON and confirms before deleting them.

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
