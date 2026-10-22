# JARVIS216 remaining limitations — 2026-10-21

JARVIS completed real supported tasks; acceptance is incomplete. Passing fixture/contract tests and a green CI run cannot replace the failed live repeat or missing hardware evidence.

2026-10-22 release follow-up: a Windows desktop candidate and in-app update button
are implemented and locally checked. Stable publication remains BLOCKED by the live
E2E matrix (25 PASS / 3 FAIL / 5 BLOCKED). The candidate is unsigned; production
packaging correctly refuses missing signing credentials. A real signed upgrade,
restart and data-preservation test remains BLOCKED. The installer updates the
desktop client only; Core/PostgreSQL, Python/uv, voice checkout and models remain
external. A user must supply JARVIS_ENV_FILE/JARVIS_REPO_ROOT for the existing
deployment. GitHub Actions candidate downloads are not a stable GitHub Release.

| Priority | Remaining issue / exact evidence | Next action / release implication |
|---|---|---|
| P0 | Codex conversation is intermittent: real replies completed in approximately 4.5–9.4 seconds, while repeated larger requests and profile-learning attempts returned `504 TURN_TIMEOUT` at the 20-second task deadline. A controlled recorded-voice repeat transcribed correctly but spoke the failure fallback after Core took 20,078 ms. | Diagnose upstream time-to-first-output and SDK/native CLI version/transport compatibility with sanitized phase diagnostics. No larger deadline or alternative provider was silently substituted. The upstream cause is not established. Keep broad reliability acceptance open. |
| P1 | Complex GitHub + conditional file requests timed out twice. A shorter GitHub-profile + file-read plan completed, and a separate conditional plan completed. | Repeat complex and concurrent workloads after the Codex latency issue is understood; do not extrapolate the simpler PASS to arbitrary autonomy. |
| P1 | Real transient-provider fault/recovery acceptance has not completed. Deterministic fixture tests cover routing, retry, unsafe interruption, checkpoint/restart and recovery; they are not live-provider evidence. | Exercise a bounded transient fault through JARVIS with an observable recovery and no duplicate side effects once live planning is stable. |
| P1 | Physical microphone transported audio, but the operator could not speak during the final test. Human audibility was not observed. | Repeat the wake word and Turkish utterance with the operator available; confirm the audible response. Both gates remain BLOCKED. |
| P1 | Bluetooth adapter presence is insufficient; no connected Bluetooth headset/output was available. | Connect a named headset and repeat selection, reconnect, capture and audible playback. BLOCKED. |
| P1 | Playwright allowed origins are not an egress/redirect security boundary. Only the controlled loopback registration was exercised. | Enforce and independently verify network isolation before attesting external origins. No external-account registration is authorized by the local test. |
| P1 | Windows read-only Codex is not a strong host-read sandbox. Conversation tools are disabled through runtime configuration and unexpected stream items are rejected, while general Codex remains HIGH. | Re-attest the isolated profile when SDK/runtime/tool registration changes; do not treat stream-item rejection as proof that an unexpected tool could never begin. |
| P2 | GitHub GET failures conservatively require recovery because the executor shares a non-retry-safe classification with writes. The pre-fix oversized repository response was correctly left uncertain, never completed. | Consider a task-aware read/write safety contract at Core's existing execution boundary. Do not automatically replay an interrupted issue creation. |
| P2 | Repository listing is bounded to one page, maximum 30. The real retest returned 27 repositories, including 7 private, with `truncated:false`; accounts larger than the page remain partial. | Add typed pagination only when needed; preserve the explicit truncation indicator. |
| P2 | Native GitHub file/issue reads and issue creation have contract/fixture coverage, but no real external issue mutation was performed. General desktop application interactions are not exhaustively tested. | Use an explicitly disposable repository/application fixture for further acceptance. Current tests do not certify all applications or accounts. |
| P2 | Contained file operations reject observed junction/link/path escapes, but Node filesystem calls cannot guarantee safety against a hostile concurrent parent-directory replacement. | Use an OS sandbox/handle-relative filesystem boundary for an adversarial local process threat model. No recursive delete is exposed by these new actions. |
| P2 | Current OpenClaw was stopped when this continuation resumed. The earlier OpenClaw real marker passed; no fresh task was routed through OpenClaw during Codex-only acceptance. | Validate a verified non-Claude backend before rerunning that optional integration. Do not count an open TCP port as authenticated task execution. |
| P2 | Protected configuration was preserved; the normal saved operator provider switches were not made Codex-only. Full tests used explicit process overrides and an isolated Core, not the normal Core on 2160. | Review the documented test boundary before starting the normal saved configuration. No claim that default startup now excludes Claude. |

The learning/reflex acceptance result is PASS; remote CI is independently visible in [draft PR #6 checks](https://github.com/brutalstein/jarvis216/pull/6/checks), with the local completion receipt in `artifacts/hardening-20261021/ci-final.json`. No 100% functionality, universal autonomy, hardware compatibility or production readiness is claimed. The release merge remains gated by all applicable acceptance and CI results.
