# Windows desktop releases and updates

The operator requested a GitHub download and an update button beside Settings, with
publication conditional on good E2E results. Their standing direction is to proceed
sequentially without subagents or repeated questions. Routine implementation choices
below are made under that authorization.

Use electron-builder NSIS and electron-updater: a manual check, explicit download,
then explicit restart/install. Native Electron's Windows updater would require a
different installer; opening a releases page alone would not update the app.
Only the main window may invoke fixed updater IPC methods. No renderer-supplied
URL, token, path or update channel is accepted. Stable releases only; no downgrades,
automatic download, or installation on ordinary quit. Keep default signature checks.

The installer contains the desktop client only. Existing Core/PostgreSQL, uv, voice
worker checkout and model data remain external. An installed client uses
JARVIS_ENV_FILE and JARVIS_REPO_ROOT to locate that existing deployment. No secrets,
operator settings, models or personal files enter the installer. Keep the existing
jarvis-desktop user-data identity; do not delete user data on uninstall.

Build local unsigned candidates for verification only. Production packaging requires
code signing. CI may build downloadable workflow artifacts with publishing disabled.
Do not publish a stable release until the documented live E2E failures and required
blocked acceptance checks are resolved. A green CI is necessary but insufficient.

Verify updater transitions/errors with a controlled driver; verify the actual
Electron button/IPC and unsupported development mode separately; build and inspect
the real Windows installer and packaged shell in isolated resources. Real signed
version-to-version installation remains BLOCKED until signed versions exist.
