# JARVIS v1.0.0 release progress

Last updated: 2026-10-20 (Europe/Istanbul). Working branch: `release/v1.0.0` from
`main` commit `09d064e8f933c4383d4ccff417c2524d23b81778`.

Evidence classes: **live-verified**, **tested only**, **not run**, **blocked**.
No secret values, transcript text, memory text or OAuth files belong in this ledger.

## Verified environment snapshot

| Item | Result | Class |
| --- | --- | --- |
| Checkout | Clean `main` matched `origin/main`; release branch created locally | live-verified |
| Host | Windows 11 Pro build 26200; `tr-TR`; Turkey Standard Time | live-verified |
| Hardware | Ryzen 9 8945HX, 31.2 GiB RAM, RTX 5070 Laptop GPU 8151 MiB, compute capability 12.0 | live-verified |
| Windows Hello | Facial Recognition device status `OK` | live-verified |
| Node | Portable v24.22.0 present; default system Node v24.11.0 | live-verified |
| Python / uv | Python 3.12.10 via launcher; default Python is 3.14.6; uv 0.11.23 | live-verified |
| JS tools | TypeScript 7.0.2, Biome 2.5.15, Vitest 5.0.5, Electron 44.9.0, Playwright 1.64.1, esbuild 0.28.2 | live-verified |
| Docker | CLI/daemon 29.8.2 and Compose 5.6.0; disposable `jarvis-voice-pg` healthy on loopback 55433 | live-verified |
| Ports | Native PostgreSQL listens on 5432; disposable release PostgreSQL listens only on `127.0.0.1:55433`; production 2160/55432 were not bound | live-verified |
| Disk | 44.3 GiB free on C: | live-verified |
| Local data | `.env`, voice models, E2E WAV, Codex home/workspace and `.tools` present; isolated `.env.voice-dev` created; `data/voice/operator.npy` absent | live-verified |
| Credentials | Gemini, OpenRouter, NVIDIA, JARVIS, n8n ingress/encryption, Browser and OpenClaw variables set; Anthropic, OpenAI and n8n callback variables unset | live-verified (presence only) |
| OneDrive exclusions | File attributes do not establish whether `data/` and `.tools/` are excluded from sync | blocked: operator confirmation needed |

## Work ledger

| ID | Work item | State | Evidence | Next step |
| --- | --- | --- | --- | --- |
| P0.1 | Ordered orientation reading | Done | README, architecture, ADR 0001–0017, reports, integration/security/runbook docs, CI, E2E harness and desktop tests read from source | Keep claims evidence-classed |
| P0.2 | Create resumable release ledger | Done | This file | Update after every work item |
| P0.3 | Verify environment facts | Done with drift | Snapshot above; real volume has only the early 8-table schema | Keep production data isolated from release tests |
| P0.4 | Backups and restore drill | Done | Git bundle, PostgreSQL custom dump, n8n archive, DPAPI-protected environment backup and SHA-256 manifest under `C:\JARVIS-Backups\v1.0.0-2026-10-19\phase0`; scratch restore matched 8 tables / 142 rows | Preserve backup set through release acceptance |
| P0.5 | Local baseline gates | Done locally; remote CI pending | Local baseline commands passed; the release commit still needs remote CI | Push the verified baseline fixes to the authorized release branch and inspect CI |
| P0.6 | Fix red baseline findings | Done locally | PostgreSQL cancellation race reproduced 6/20 before fix and 20/20 passed after; full E2E 11/11 | Require fresh remote CI before merge |
| P1.A | Platform × database matrix | Not run | Release prompt §5.2A | Implement only after Gate 0 |
| P1.B | Provider topology matrix | Not run | Release prompt §5.2B | Implement only after Gate 0 |
| P1.C | Privacy × trust matrix | Not run | Release prompt §5.2C | Implement only after Gate 0 |
| P1.D | Exhaustive permissions matrix | Not run | Release prompt §5.2D | Implement only after Gate 0 |
| P1.E | Plan lifecycle matrix | Not run | Release prompt §5.2E | Implement only after Gate 0 |
| P1.F | Conversation matrix | Not run | Release prompt §5.2F | Implement only after Gate 0 |
| P1.G | Memory matrix | Not run | Release prompt §5.2G | Implement only after Gate 0 |
| P1.H | Learning brain matrix | Not run | Release prompt §5.2H | Implement only after Gate 0 |
| P1.I | n8n matrix | Not run | Release prompt §5.2I | Implement only after Gate 0 |
| P1.J | Failure injection matrix | Not run | Release prompt §5.2J | Implement only after Gate 0 |
| P1.K | Security matrix | Not run | Release prompt §5.2K | Implement only after Gate 0 |
| P1.L | Desktop UI / real Core E2E | Not run | Release prompt §5.2L | Implement only after Gate 0 |
| P2.1–9 | Live machine verification | Blocked at C2 | Operator presence, quotas, private-window check and dev runtime required | Finish Gate 1, then request C2 |
| P3.1–12 | Packaged desktop product | Not started | Known blockers in release prompt §7 | Finish Gate 2; obtain C4 decisions where required |
| P4.1–7 | Install and acceptance on laptop | Blocked at C3 | Real-data backup and operator presence required | Finish Gate 3, then request C3 |
| P5.1–5 | Versions, docs, workflow and independent review | Not started | Release prompt §9 | Finish Gate 4 |
| P5.6 | PR, merge, tag and draft release | Blocked at C5 | Outward-facing actions require explicit approval | Finish all earlier gates, then request C5 |

## Baseline gate table

| Gate | Current result | Class |
| --- | --- | --- |
| Root install / typecheck / lint / coverage / build | Portable Node v24.22.0; 55 files passed, 1 skipped; 591 tests passed, 1 skipped; coverage 94.15/85.57/93.90/96.18; build passed | tested only |
| Root audit | 0 vulnerabilities | live-verified |
| Contract generation and schema drift | Export passed; no schema diff | live-verified |
| PostgreSQL suite | Disposable loopback PostgreSQL: 1/1 passed | live-verified |
| Core E2E on PostgreSQL | Pre-fix cancellation race reproduced 6/20; post-fix 20/20 targeted and 11/11 full suite passed; external services and models are fixtures | tested only |
| Desktop typecheck / Electron tests / audit | Portable Node v24.22.0; typecheck passed; 19 passed, 1 opt-in microphone test skipped; targeted overlay regression 5/5; 0 vulnerabilities; Core/voice are fixtures | tested only |
| Browser worker lint / format / mypy / tests | Ruff and mypy passed; 15/15 tests passed using fixture extraction | tested only |
| Voice lint / format / mypy / tests | Ruff and mypy passed; 35/35 tests passed under the locked Python 3.12 environment; this does not exercise CUDA models or the microphone | tested only |
| Benchmark | PGlite and deterministic executor fixture, portable Node v24.22.0: lifecycle p50/p95 18.41/22.96 ms; 500-blocked claim 16.65/22.80 ms; spoken turn 69.19/84.91 ms; working spoken turn 53.84/77.75 ms; RSS 847.43 MiB | tested only |
| GitHub Actions on `main` | Run 39238398696: TypeScript Linux/Windows, desktop, Python and voice passed; PostgreSQL job failed | tested only, failing |
| Backups and restore drill | Backup checksums verified; custom dump restored to scratch and table counts matched | live-verified |

## Checkpoint C1

Satisfied by the operator's delegated local authority on 2026-10-19. Conservative defaults used:

1. Backup destination: `C:\JARVIS-Backups\v1.0.0-2026-10-19\phase0`, outside the repository and OneDrive.
2. OneDrive exclusion status remains unverified; no claim of exclusion is made.
3. Production ports 2160/55432, real data and live providers were left untouched. Release tests use
   disposable PostgreSQL on loopback 55433 and generated development-only credentials.

## Gate 0 fixes

- Limited Vitest to four workers because unrestricted PGlite fan-out timed out on this 32-thread Windows host.
- Applied Electron's explicit `pop-up-menu` always-on-top level for the non-focusable Windows overlay.
- Made plan cancellation persist the task decision before aborting the running executor, eliminating the
  retry-safe browser-read race that incorrectly required reconciliation.
