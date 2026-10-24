# JARVIS desktop (M1, M3 plan cards)

Electron shell for the approved talking-JARVIS milestone. Turkish and English microphone input
stays local until an addressed transcript is sent to Core. Core owns model routing and records.
Since M3 the desktop also shows plan cards, candidate choices, progress and news panels streamed
from Core (`GET /v1/stream`); Core executes the actions. Long-term memory belongs to a later
milestone.

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

Core exits on an uncaught exception (logging the error's name and code frames, never its
message); the app restarts it after 2 s, doubling up to a minute while it keeps failing.

`VOICE_SPEAKER_THRESHOLD` (default `0.25`) in the operator `.env` is passed to the voice
service for calibration with the operator's microphone; each speaker score is written to
`data/voice/voice.log` in the checkout.

## Use

- **Güncellemeler**, beside Settings: check GitHub for a stable desktop release,
  choose **İndir**, then **Yeniden başlat ve yükle**. Downloads and installation
  require an explicit click; ordinary quit never installs an update. Development
  copies are not updated. A missing release or failed integrity/signature check
  produces a retryable error, not an installation.

- Say “Jarvis” (Turkish spelling variations are accepted), then speak normally. Without a voice
  print, the assistant requires its name. With a print, once addressed it keeps listening to
  your voice without the name while it works or speaks and for eight seconds after.
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
- Settings has four tabs (arrow keys move between them):
  - **Genel**: microphone, voice print, conversation export and deletion.
  - **İzinler**: one level for everything (**Güvenli**, **Dengeli**, **Tam yetki**) or **Sor**,
    **İzin ver**, **Engelle** per action, grouped by area, with risk and availability. **Yeni
    izinlerin süresi** makes new grants expire after 1 hour, 8 hours or 1 day instead of lasting
    until changed. An allowed action runs from
    voice without a card; an action turned off is never offered or run. Core audits every change
    ([ADR 0014](../../docs/ADR/0014-operator-standing-permissions.md)).
  - **Öğrenme**: what JARVIS has learned (experiences, skills, success and correction rates),
    switches for learning and for learned shortcuts, **Şimdi pekiştir**, forgetting one skill and
    resetting everything after a confirmation
    ([ADR 0015](../../docs/ADR/0015-learning-brain-and-layered-intent.md)).
  - **Hafıza**: long-term notes, forget one or all.

  All Settings calls go from the main process to Core with the operator token, which the
  renderer never receives; the main process validates every change first.

- Spoken commands become plans when Core enables the action engine (`ENABLE_DESKTOP`,
  `ENABLE_NEWS`). A plan whose steps are all allowed runs at once (by default LOW only). Any
  other plan shows a card with its steps and risk badges: **Enter** or a tap approves it within
  two minutes, **Esc** rejects it. Saying "dur", "iptal" or "stop" cancels a running plan, and
  "durum ne?" reports it; voice never approves one.
- When several on-screen elements match, a numbered candidate panel appears; tap one or say its
  number. JARVIS remembers the pick for the same situation.
- A running plan's card shows a live line (where the step looks, page i of n, seconds spent and
  roughly how many are left, or that it is taking longer) and an estimated progress bar. JARVIS
  keeps talking meanwhile: long work is acknowledged at once and narrated between your turns;
  progress lines are spoken, not shown as captions. News briefs open as panels with Core-fetched thumbnails; tapping a card opens the
  article in the default browser.

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

## Windows installer and release gate

`npm run package:win` builds an x64 NSIS installer and `latest.yml` with publishing
disabled. It requires a Windows signing certificate via electron-builder's standard
signing configuration. Keep the app id and package name stable across releases;
the existing `jarvis-desktop` profile and data must survive upgrades.

`npm run package:win:test` explicitly permits an **unsigned test candidate**. This
is not a stable release. `node verify-package.mjs` inspects the actual archive and
manifest and opens the packaged shell in a disposable profile without Core/voice.
The Windows desktop candidate workflow provides the installer, blockmap, manifest,
checksums and verification receipt as a GitHub Actions artifact; it never publishes
a GitHub release. Unsigned candidates are for verification, not daily installation.

This is a **desktop client installer**, not a bundled Core/PostgreSQL/voice runtime.
Keep the existing deployment and Node/uv/models installed. Start its Core separately;
launch the installed client from a session containing these paths:

```powershell
$env:JARVIS_ENV_FILE = 'C:\path\to\jarvis216\.env'
$env:JARVIS_REPO_ROOT = 'C:\path\to\jarvis216'
& 'C:\path\to\installed\JARVIS216.exe'
```

Use the actual installation path if it differs. `VOICE_DATA_DIR` may retain an
existing external voice data directory; by default it is `data/voice` in the
deployment checkout. The installer contains neither `.env` nor models, credentials,
the Core checkout or personal files. Installed desktop updates do not upgrade Core
or the voice worker. Keep their API versions compatible manually.

Publish the signed installer, its `.exe.blockmap`, `latest.yml` and checksums
together on a stable GitHub release only after live E2E acceptance passes. Do not
replace an already released version's assets. Test a signed version-to-version
upgrade before claiming the update path is verified. See [E2E report](../../E2E_REPORT.md)
for the current failures and blocked checks. No stable release has been published.

Packaging pins electron-builder 26.15.3 and electron-updater 6.8.9. The scoped
`@electron/get` override selects global-agent 4.1.3 to remove its obsolete vulnerable
sprintf-js chain; the downloader's bootstrap export is retained. Package downloads
were exercised directly; a corporate proxy environment has not been certified.
