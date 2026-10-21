# JARVIS216 implementation report — 2026-10-21

Release base: `3886783227328920f65876dee3536234ed69b263` (`release/v1.0.0`). Feature branch: `codex/autonomous-agent-hardening`, [draft PR #6](https://github.com/brutalstein/jarvis216/pull/6). The existing hardening work was already committed/pushed as `ba81c58830544278ed2c249b9e0e596937700027` when this continuation resumed. Follow-up repairs are in `c3c76832d85f425c39c38f894f9ab57b70738d4c`; later commits include voice timing regressions, pinned CPU-only CI dependencies and reports. No user commit was reset or rewritten.

## Changes and authority

Core remains the sole owner of plans, dependency admission, permissions, exact approvals, leases, verification, cancellation and recovery. IntegrationHub provides recipes. Typed executors observe results; model prose cannot certify a completed side effect.

| Boundary | Implemented behavior | Verification |
|---|---|---|
| Codex conversation | Separate `codex-live` profile; shell, apps, plugins, MCP, hooks, browser, computer and delegation features disabled at runtime; streamed unexpected tool items rejected. General Codex remains HIGH. | SDK fixture tests plus real Codex-only Turkish/English turns. Native Windows containment remains an operator attestation, not a formal filesystem sandbox proof. |
| Outcome contract | Optional structured executor outcome and `postcondition` verification. Unobserved delegated prose remains uncertain. | Contract, Gateway, agent-fixture and topology tests; old false-completion expectations corrected. |
| File operations | Typed bounded UTF-8 create/read/write/delete inside configured roots; exclusive create, prepared replacement, readback/absence checks, link/escape rejection. | Real five-step JARVIS plan and independent reads after every step; filesystem, cancellation, partial-write and risk tests. |
| GitHub | Standalone native-auth `gh api`, fixed routes, schema validation, filtered child environment, bounded output, readback for approved issue creation. Repository metadata projected by fixed `--jq` before bounded capture. | Real authenticated profile, private repository visibility, public target metadata; noisy-response regression. External writes remain fixture-tested only. |
| Interactive browser | Official pinned Playwright MCP; plan-scoped sessions, fresh element references, navigate/snapshot/fill/click/verify actions, explicit HIGH submit. | Local registration POST and server record; no external account created. External egress is a deployment prerequisite. |
| Plan lifecycle | Awaiting HIGH desktop approvals remain actionable; later step budgets include dependency waiting within the bounded plan window. | Reproduced failed deletion before repair; regression and real successful CRUD afterward. |
| Conditions | Backward dependency/result conditions, persisted `SKIPPED` status, migration 12, skipped-branch narration, Brain condition preservation and retention scrubbing. | Compiler/Core/database fixture tests and real conditional read/delete. No arbitrary code evaluation. |
| Brain reuse | Existing verified-experience learning retained; no replacement Brain or fabricated training records. | Three real read plans followed by a fourth learned-plan execution without a model task; 82 ms turn, four successes/one use in skill statistics. |
| Discovery | Authenticated capability endpoint; paginated allowlisted MCP descriptors; credential configuration distinguished from authenticated account proof. Shared 15-second discovery/initialize bounds and 20-second endpoint idle allowance. | Real Windows-MCP/Playwright discovery and stalled-initialize child cleanup test. |
| Cancellation | HTTP disconnect aborts conversational intent/repair tasks through Task Service and worker controllers; admitted background plans retain their lifecycle. | Real local HTTP regression for both retry-safe cancellation and unsafe `RECOVERY_REQUIRED`. |
| Voice telemetry/TTS | Immutable segment timestamps, separate queue/decode/Core/TTS timings, incremental synthesis, announcement/turn separation. | Python timing regressions and real recorded Turkish speech through STT/Core/TTS/WebRTC. |
| Voice devices/lifecycle | Microphone replacement guards, speaker selection/hotplug, cleanup on failed connections, bounded reconnect; serialized offers and failed-peer release. ICE batches validated before application. | Python and renderer regressions, Electron device tests, real built-in output routing; invalid ICE payloads reproduce 500 before repair and return 400 afterward. |
| CI/test isolation | Root CI installs separately locked desktop dependencies used by renderer regression imports. Live PostgreSQL disconnect injection targets only the disposable application's connections. | Previous CI log pinpointed missing Pipecat dependencies; local checks and real PostgreSQL test passed. Fresh remote CI is a separate release gate. |

## Fresh local gates

- Last full coverage run: **769 passed, 1 skipped**, 69 passing files and one opt-in PostgreSQL file skipped. Lines 95.43%, statements 93.34%, functions 93.26%, branches 84.80%; existing thresholds retained. The subsequently expanded cancellation test passed both variants separately. Do not add overlapping counts together.
- Live PostgreSQL opt-in test: **1 passed** on PostgreSQL 18.3, including concurrent bootstrap/claim and a scoped forced reconnect. The pool error log was the injected disconnect, not an unrelated production outage.
- Electron: **21 passed, 1 hardware-opt-in skipped**. Root/desktop typechecks, lint, build and matrix check passed.
- Voice Python: **42 passed**; after extra invalid-ICE cases, the affected server suite passed all 10 tests. Ruff/check-format and mypy passed. Browser Python: **15 passed**, Ruff and mypy passed.
- Four Windows service-manager CI blocks passed in a copied disposable fixture directory: parsing, absent-env diagnostics, duplicate dotenv/portable CLI behavior, detached desktop environment handoff/restart. Synthetic credentials only; the real `.env` was never used as a writable fixture.
- Root and desktop npm audits reported **zero vulnerabilities** at execution time. This is not a full supply-chain or Python vulnerability audit.

## Preservation and remaining trade-offs

SHA-256 comparisons match all five baseline protected files: `.env`, `.env.voice-dev`, isolated Codex auth, OpenClaw configuration and the existing Electron Preferences. Tests used process-only provider overrides, isolated PostgreSQL schemas, a loopback site and disposable Electron/enrollment profiles. Saved model/device/provider settings were not migrated. No real Claude process/API was invoked; compatibility fixtures do not consume Claude quota. No subagents were used in this continuation.

Successful real executions are documented in [E2E_REPORT.md](E2E_REPORT.md) and [sanitized evidence](docs/evidence-hardening-20261021.json). The current implementation can execute supported bounded tasks, but repeated Codex deadlines prevent a reliability claim. General Windows GUI competence, external browser egress isolation, physical spoken recognition, human audibility and Bluetooth compatibility remain unproven. See [REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md) before release.
