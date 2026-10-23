# Desktop updates implementation plan

> Execute sequentially with superpowers:executing-plans; no subagents, as requested.

**Goal:** Prepare a Windows desktop installer and in-app updates without publishing
an unverified stable release.

**Architecture:** electron-updater in main, fixed preload bridge, an update dialog
beside Settings; electron-builder NSIS with an explicit files allowlist.

**Tech stack:** Existing Electron/TypeScript/Playwright/Vitest, electron-builder and
electron-updater pinned in the desktop lockfile.

**Spec:** ../specs/2026-10-22-desktop-updates-design.md

## Constraints and review focus

Preserve protected files and data. No Claude or subagents. No implicit publish.
Exercise duplicate clicks, network failure/retry, premature install, unsupported
development mode, renderer authority, packaged paths and package secret exclusions.

## Tasks

- [x] Write failing updater transition tests in tests/desktop-updates.test.ts and
  an Electron button/IPC test in apps/desktop/tests/updates.spec.ts. Observe failures.
- [x] Implement apps/desktop/src/main/updates.ts; connect main.ts, shared.ts,
  preload/preload.ts, renderer/updates.ts, app.ts, index.html and styles.css.
  Update the shell bridge contract test. Check transitions and Electron behavior.
- [x] Configure desktop packaging/build.mjs/package.json/lockfile and a manual
  Windows artifact workflow with --publish never. Keep signing required for release
  builds. Resolve packaged worker paths from the external deployment.
- [x] Typecheck/lint, run affected and desktop tests, inspect a real installer and
  isolated packaged shell, record limits and fresh evidence in the reports/README.
- [ ] Refresh graph, review diff, commit/push and inspect CI. Publish only if the
  stable release gate actually passes; otherwise record BLOCKED and leave PR draft.

Ruling: candidate workflow also runs for desktop-related PR changes, so an unmerged
candidate can have a GitHub download artifact without publishing a stable release.
Existing draft PR #6 and its checkout are reused. No additional worktree or agents.
Ruling: tests use controlled updater events for destructive install transitions;
the actual signed upgrade stays BLOCKED rather than changing the operator's install.
Regression found: test helper previously used the real profile. A failing userData
assertion demonstrated it; --user-data-dir now isolates every desktop test.
Verification helper fixes: normalize Windows ASAR separators, select main window
by URL rather than first-window order, and poll IPC status outside the browser's
async predicate. Final packaged run checks GitHub's missing-release error visibly.
