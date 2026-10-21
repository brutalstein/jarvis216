# JARVIS216 local Windows E2E report

Date: 20 October 2026, Europe/Istanbul. Tests executed by Codex against the local checkout of `brutalstein/jarvis216`, base commit `3886783227328920f65876dee3536234ed69b263`.

**Result: partially functional; the six requested scenarios do not all pass.** Authenticated GitHub reads, real Codex/OpenClaw calls, desktop directory operations, recorded Turkish speech and an approved two-step memory plan were observed. Codex-only conversation, complete registration, full file CRUD, physical-microphone speech recognition and Bluetooth playback are not verified working.

## Test boundary and preservation

- Existing PostgreSQL, Core on port 2160 and OpenClaw on port 18789 were already running. They were not restarted. PostgreSQL was the real Docker PostgreSQL 18.3 instance on host port 55432, not PGlite.
- Test Core A: loopback port **2166**, PostgreSQL schema **`e2e_20261020`**; real Codex, OpenClaw, Windows-MCP and memory providers. All Claude flags and other model-provider flags were disabled in the test process environment.
- Supplemental test Core B: port **2167**, schema **`e2e_20261020_voice`**; the existing Gemini configuration supplied conversation responses. **Gemini-backed results below are explicitly identified and do not prove Codex conversation support.** Claude remained disabled.
- Actions were requested through JARVIS HTTP APIs. Core admitted tasks, selected executors, requested approvals, invoked integrations and recorded events. Codex supplied the localhost fixture, test scaffolding and independent filesystem/server readback; those setup/check operations are not counted as JARVIS capabilities.
- HIGH actions received exact-action approval through Core. The memory plan received hash-bound plan approval. No standing permissions or saved presets were changed.
- The saved configuration still enables Claude Code/agent paths. It was preserved exactly; Claude disablement applied to test processes only. Starting the ordinary saved configuration later is not equivalent to the Claude-free test setup.
- Desktop launches used separate Electron profiles and `VOICE_DATA_DIR` folders under the isolated evidence directory. `JARVIS_DESKTOP_TEST=0`: the real Python worker and WebRTC path ran. Recorded-input runs used Chromium's WAV capture fixture; these are not physical-microphone passes.
- No Claude executable or Anthropic request was invoked by the test harness. Test registries/actions show no Claude targets. JARVIS's four Codex child runs were inspected: the only actual connector calls were the three GitHub read operations listed below. OpenClaw's selected agent was configured for `openai/gpt-5.6-sol`.
- SHA-256 comparisons verified unchanged `.env`, `.env.voice-dev`, the configured isolated Codex `auth.json`, OpenClaw `openclaw.json` and the existing desktop `Preferences`. See `artifacts/e2e-20261020/preservation.json`. This is a bounded file-preservation check, not a hash audit of every personal file.
- Local test resources: `artifacts/e2e-20261020/`, the two named schemas and localhost test site port 2186. No external accounts were created. Private repository names and unrelated window titles are omitted from this report.

## PASS / FAIL / BLOCKED matrix

PASS means the specific row's postcondition was observed. BLOCKED means a required tool, integration, permission or hardware condition was unavailable. A Core task marked `COMPLETED` is not automatically a scenario PASS.

| ID | Scenario / acceptance condition | Result | Observable evidence / limitation |
| --- | --- | --- | --- |
| I1 | PostgreSQL connection and durable Core execution | PASS | Real SQL returned PostgreSQL 18.3; separate test schemas exist; task/action/event records persisted. |
| I2 | Core authenticated readiness | PASS | `/healthz` alive; authenticated `/readyz` database ready. Unauthenticated readiness returned 401. Readiness itself explicitly says live connectivity is not checked. |
| I3 | JARVIS → Codex SDK | PASS | Task `1a17067e-01b7-4c5b-bfd0-ba4452134e04` returned exact `JARVIS216_CODEX_E2E_OK`, source `codex:gpt-5.6-sol:model-output`, after approval. |
| I4 | JARVIS → OpenClaw → OpenAI agent | PASS | Task `3887ac67-a3da-43b7-a9f8-ddd003d5067c` returned exact `JARVIS216_OPENCLAW_E2E_OK`; Core measured 44,836 ms. This proves the configured response path, not privileged OpenClaw tools. |
| I5 | Real Electron and voice signalling | PASS | Actual Electron renderer, isolated profile, authenticated voice `/health` 200, live WebRTC audio track; no fake voice-service stub. |
| I6 | Action Engine → Windows-MCP | PASS | Real directory listing and window snapshots returned observed postconditions. `file.mkdir` uses the Action Engine's local filesystem implementation; listing exercised MCP. |
| I7 | Brain and memory integration | PASS | Natural-language Gemini-backed plan executed two memory steps. Brain readback showed 2 experiences and plan success rate 1; no learned skill was claimed. |
| I8 | Browser Use worker available for form submission | BLOCKED | Saved worker enablement/egress flags are false. Implemented worker contract is public HTTPS extraction, not localhost form registration. It was not enabled by falsifying the egress attestation. |
| G1 | Authenticated GitHub identity and repository listing through JARVIS task | PASS | Codex child actually called authenticated-user, owned-repository-list and repository-detail tools; login `brutalstein`, 23 repositories including 6 private. See host-bridge limitation below. |
| G2 | Retrieve `brutalstein/jarvis216` details | PASS | Actual connector output: repository ID `1422808023`, public, branch `main`, admin/push/pull permissions true. Authentication was established independently of this public repository. |
| G3 | GitHub request through Codex-only conversation entrypoint | BLOCKED | `/v1/conversation/turns` returned HTTP 503 `NO_PROVIDER`; Codex/OpenClaw are excluded from conversation routing. |
| B1 | JARVIS navigates to local registration fixture | PASS | Test server observed browser GET `/` and favicon after the JARVIS desktop launch request; JARVIS later observed the test browser title. |
| B2 | Verify browser foreground and target field | FAIL | Desktop launch task reported `no browser came to the front`; later Name-field action reported `I can't see "Name"`. Earlier attempt yielded `USER_CONTROL`. Active-window context was not reliable. |
| B3 | Fill fields, submit registration, verify stored registration | BLOCKED | Codex child explicitly reported no browser interaction tool; desktop path did not reach a verified target field. Server readback contained **zero registrations**, no registration POST. No direct HTTP submission was substituted. |
| C1 | Create isolated directory and list it | PASS | JARVIS created `workspace/jarvis-created`; independent filesystem readback and real MCP listing confirmed it. |
| C2 | Create/read/modify/delete a test file through JARVIS | BLOCKED | Codex task reported read-only permissions and performed no file mutations. `jarvis-crud.txt` was absent. The typed file catalog lacks content-create/read/write/delete actions; folder creation/listing is not full file CRUD. |
| C3 | Refuse access outside configured test roots | PASS | Request for the parent test directory returned `ok:false`, `evidence:"refused"`, `that path is outside the allowed folders`; Core recorded `verification.failed` and FAILED. No personal directory was used as the denial target. |
| V1 | Physical built-in microphone acquisition/transport | PASS | Live enabled Senary microphone track, 48 kHz capture; outbound audio bytes and nonzero source energy observed in JARVIS's actual WebRTC peer. |
| V2 | Recognize the operator's physical spoken command | FAIL | Operator reported speaking without a reply. Physical runs produced no user transcript. Audio transport alone does not establish intelligible speech or correct VAD/STT segmentation; precise cause remains unresolved. |
| V3 | Recorded Turkish STT and addressed-name detection | PASS | Initial run and final recorded rerun recognized `Jarvis, bugün neler yapabiliriz?` and triggered Core requests. This is Whisper transcription plus name matching, not a separate acoustic wake-word engine. |
| V4 | Repeatable, responsive speech recognition | FAIL | Later runs were inconsistent; one emitted `sttMs:24578`. A successful first run is insufficient to establish reliable physical or recorded recognition. |
| V5 | AI answer with only Codex/OpenClaw enabled | FAIL | Repeated Core HTTP 503 `NO_PROVIDER`; working SDK credentials did not make the conversation router accept Codex. Voice generated a fallback, not an AI answer. |
| V6 | Supplemental Gemini conversational response | PASS | Direct greeting returned `gemini-live`, latency 7066 ms. Final recorded run completed STT → Core → Gemini → Piper → playback twice. Across this Core's run, 5 Gemini actions succeeded and 2 failed; reliability is not a pass. |
| V7 | Piper synthesis and software playback | PASS | Recorded fallback synthesis produced timing/audio events; physical-output run received `Tamamdır, efendim.` with nonzero inbound audio energy and advancing, unpaused HTML audio playback. This does not certify subjective loudspeaker audibility. |
| V8 | Explicit speaker/output selection | BLOCKED | Observed sink was the OS default (`sinkId:""`). The inspected media/settings/connection path offers microphone selection but no tested speaker-selection control. No system audio settings were changed. |
| V9 | Bluetooth headset microphone/playback | BLOCKED | MediaTek Bluetooth adapter exists, but no connected Bluetooth audio endpoint/headset was available. |
| A1 | Natural-language multi-step planning and tool selection | PASS | **Gemini-backed** Core selected `memory.save` then `memory.forget`; both executed through JARVIS with verified evidence. Does not prove Codex-only conversational planning. |
| A2 | Approval, sequencing and idempotency | PASS | Wrong plan hash 409; correct hash 204; second step initially `WAITING_FOR_DEPENDENCY`; consumed action approval 409; duplicate admission retained task ID/call count; changed payload with same key 409. |
| A3 | Autonomous error recovery/replanning | BLOCKED | Failed desktop attempts did not demonstrate a successful autonomous recovery. Provider recovery observed here required a tester retry. No claim of autonomous repair is made. |
| A4 | Scenario-level result verification | FAIL | Text tasks using `non-empty` were COMPLETED even when their model text said BLOCKED. Desktop contracts using `contains: '"ok":true'` correctly rejected refusals. Report results use actual postconditions, not the generic text-task completion flag. |
| F1 | Repair snapshot-error false observations | PASS | Three regression cases failed before the fix; affected tests passed after it; fresh real JARVIS snapshot succeeded after restart. Live occurrence of every injected error case was not forced. |

## Actual outputs and sanitized traces

### Codex and OpenClaw

```text
Codex: WAITING_FOR_APPROVAL → [approval HTTP 204] → RUNNING → VERIFYING → COMPLETED
text: JARVIS216_CODEX_E2E_OK
source: codex:gpt-5.6-sol:model-output
execution/verification duration: 7349 ms

OpenClaw: WAITING_FOR_APPROVAL → [approval HTTP 204] → RUNNING → VERIFYING → COMPLETED
text: JARVIS216_OPENCLAW_E2E_OK
source: openclaw:output-contract
execution/verification duration: 44836 ms
```

Full Core task/action/event envelopes: `artifacts/e2e-20261020/codex-smoke.json` and `openclaw-smoke.json`.

### Authenticated GitHub evidence and the Codex host distinction

JARVIS task: `0adc062f-436a-4e59-a9ed-4bb2995d2ced`. SDK child session: `01a15a89-1001-7532-b695-b15fe3af36af`.

The child's actual tool invocation, not merely its final prose, was inspected:

```text
mcp__codex_apps__github_get_user_login({})
  → login: brutalstein; id: 225531622; isError: false
mcp__codex_apps__github_list_repositories_by_affiliation(
  {affiliation:"owner", page_offset:0, page_size:100})
  → 23 repositories, including 6 private
mcp__codex_apps__github_get_repo(
  {repository_full_name:"brutalstein/jarvis216"})
  → id: 1422808023; default_branch: main; visibility: public
    permissions: {admin:true, maintain:true, pull:true, push:true, triage:true}
```

**Boundary:** Core invoked its configured Codex executor; that child obtained GitHub access through the Codex desktop host's connected-app bridge. The testing agent did not make these GitHub calls itself. This is real authenticated access along this JARVIS task path, but it is not proof of a native standalone JARVIS GitHub adapter or availability outside this host. Read-only/network-disabled SDK settings did not remove this remote connector surface; do not infer connector isolation from those flags.

Sanitized tool evidence: `github-tool-evidence.json`. Child tool-call inventory: `codex-child-tools.json`. Private names are redacted from the deliverable evidence.

### Local registration and filesystem

```text
Fixture: http://127.0.0.1:2186
GET / observed: 2026-10-20T18:23:51.339Z
GET /favicon.ico observed: 2026-10-20T18:23:51.377Z
registrations: []

file.mkdir → {"ok":true,"evidence":"postcondition",
              "observation":"jarvis-created is ready"}
file.list rerun → directory contains [DIR] jarvis-created
outside-root request → {"ok":false,"evidence":"refused",
                         "observation":"that path is outside the allowed folders"}
```

The fixture was supplied by Codex; it was never directly registered against by Codex. `final-runtime.json` contains independent server/filesystem readback. The first file-list diagnostic used an insufficient `non-empty` verifier and returned a USER_CONTROL error inside a COMPLETED task; it was not counted as a pass. The corrected rerun used the same `"ok":true` postcondition as JARVIS desktop plans.

### Voice observations

```text
Initial recorded run:
  user caption: Jarvis, bugün neler yapabiliriz?
  JARVIS caption: Şu an yanıt veremiyorum, efendim.
  one timing: sttMs=672, coreMs=47, ttsMs=62, firstAudioMs=1012
  Core: HTTP 503 {"error":"NO_PROVIDER"}

Physical Senary microphone rerun:
  local track: live, enabled, sampleRate=48000
  outbound audio bytesSent=280561
  source totalAudioEnergy=0.538734527134559
  user caption events: 0
  plan announcement received: Tamamdır, efendim.
  inbound totalAudioEnergy=0.33238224199062943
  audio: paused=false; currentTime=76.962; sinkId=""

Final recorded Gemini run (real models, WAV input rather than hardware):
  two user captions: Jarvis, bugün neler yapabiliriz?
  two AI replies began: Bugün sizin için sistem görevlerini yönetebilir...
  first answer: sttMs=23172, coreMs=2875, ttsMs=328
  second answer: sttMs=20406, coreMs=10391, ttsMs=312
  inbound bytesReceived=294340; totalAudioEnergy=3.27599312055778
  later partial transcription "Jarvis" received a fallback response
```

The initial recorded-run values above were captured from the live test console; that harness's shutdown wait stalled before its JSON export. Subsequent runs save observations before a bounded shutdown wait. `desktop-recorded-final.json` and `voice-final-summary.json` preserve the final complete speech round trips. `desktop-hardware-rerun.json`, `desktop-real.json`, other recorded-run JSON files and matching PNGs preserve additional observations. The report does not reinterpret delayed/missing captions as successful recognition.

The implemented addressed-name mechanism is `workers/voice/jarvis_voice/addressee.py:is_named`, after STT. A dedicated always-listening acoustic wake-word detector was not tested or claimed.

### Multi-step autonomy and permission controls

```text
Plan aa897560-0651-4518-ab30-0ad448efce96
goal: E2E_CANARY_216 notunu kaydet ve ardından sil
steps: memory.save({note:"E2E_CANARY_216"})
       memory.forget({about:"E2E_CANARY_216"})
AWAITING_APPROVAL → RUNNING → COMPLETED
step 2 before step 1 completed: WAITING_FOR_DEPENDENCY
step 1 evidence: remembered
step 2 evidence: 1 notes forgotten
final /v1/memories: []

No Authorization header: 401 UNAUTHORIZED
Empty utterance: 400 INVALID_REQUEST
Consumed approval replay: 409 APPROVAL_NOT_PENDING
Identical idempotency key/payload: same task ID; calls remained 1
Different payload with that key: 409 IDEMPOTENCY_CONFLICT
```

Evidence: `plan.json`, `controls.json`, and `final-runtime.json` in the isolated evidence directory. The planning provider was `gemini-live`. One preceding planning request failed with Core classification `provider-unavailable`; the exact upstream HTTP reason was suppressed by existing logging and was not guessed.

## Defect fixed and validation

Changed only `packages/action-engine/src/run.ts` and its existing regression test file for the product fix. The shared `look()` reader previously parsed failed Snapshot tool responses as ordinary screen content. Consequences reproduced in tests:

- `window.list` falsely returned `ok:true`, `0 windows`.
- `screen.describe` falsely returned `ok:true` with an error payload as its observation.
- `app.focus` lost the actual USER_CONTROL reason and said the app was not open.

The reader now rejects failed Snapshot results; `runStep` converts only this known observation failure to sanitized `observed-failure` evidence. Unrelated transport errors still propagate. No retries, user-control bypasses, approval changes or sandbox relaxations were added.

Validation performed:

```text
Before fix: snapshot regression tests — 3 failed (expected false observations reproduced)
After fix: affected action/MCP/Core adapter tests — 54 passed
Broader Action Engine + Core adapter tests — 13 files, 292 passed
npm run typecheck — exit 0
Biome check of both modified code/test files — exit 0
npm run build — exit 0
git diff --check — exit 0
graphify update . — AST-only refresh succeeded; no model/API extraction
```

Fresh live rerun on restarted isolated Core: task `e6f99deb-439f-4b4d-9d5d-0bcf90550aa7`, Windows-MCP snapshot, observed 3 windows, postcondition verified. These unit/regression checks support the repair; they do not replace the real integration scenarios above. The main Core on 2160 was not restarted and therefore has not loaded this source repair.

## Root causes, missing integrations and prioritized fixes

1. **P0 — Provide a safe Codex conversation path.** `src/services/conversation.ts:conversationProviders` includes Gemini, Claude and configured compatible models, but excludes both `codex` and `openclaw`. Codex-only turns therefore return NO_PROVIDER despite a working executor. Simply adding Codex to this list is insufficient: its HIGH approval floor would cause `runText` to settle at WAITING_FOR_APPROVAL, while the conversation path does not expose an approval flow for that task. Implement that flow or a separately constrained conversational runtime; preserve the existing approval boundary.
2. **P1 — Diagnose speech segmentation/inference latency on the physical device.** Capture bounded VAD/Smart Turn/Whisper stage timing and test controlled speech near the Senary microphone. Nonzero capture energy is proven; successful physical transcription is not. Recorded tests also varied, including a 24.6-second STT measurement. Do not change thresholds or declare the microphone fixed without a hardware rerun.
3. **P1 — Give delegated action requests a verifiable result contract.** The generic Codex adapter returns text; `non-empty` only validates that text exists. Browser/CRUD refusal messages consequently satisfied the task contract. Require structured action outcomes and independent postconditions before promoting an action request to scenario success. Keep generic text generation semantics distinct.
4. **P1 — Add the missing Codex browser/action integration with scoped permissions.** This SDK child had no browser interaction tool. Browser Use's current contract cannot register on localhost. Desktop navigation reached the fixture but foreground/field grounding failed, and USER_CONTROL yielded correctly. A form-capable integration and an exclusive, observable test window are required before filling/submission can pass; no egress or account-approval safeguards were disabled here.
5. **P1 — Bound the Codex child's connector surface explicitly.** Authenticated GitHub access worked through host-provided apps even with SDK read-only/network settings. This host-specific bridge must not be mistaken for a Core-governed per-tool allowlist. Verify connector availability and approval behavior in the intended deployment environment.
6. **P2 — Implement scoped file-content CRUD if required.** Current typed catalog supports directory listing/creation and transfer/rename, not content CRUD/delete. The configured Codex adapter is deliberately read-only. Add narrow actions with root containment and content/deletion readback rather than globally increasing SDK filesystem permissions.
7. **P2 — Add and test output-device selection.** Only default speaker playback was observed; the inspected desktop path lacks a tested output selector. Bluetooth validation requires an actual connected headset and another physical run.

The missing routes/integrations were not “fixed” by enabling Claude, changing credentials, weakening approvals, granting full filesystem access or claiming public GitHub access as authentication. They need broader implementation and acceptance tests beyond the safe snapshot-error repair.

## Remaining limits and evidence location

All evidence paths above are relative to `C:/Users/cenke/OneDrive/Desktop/jarvis216/artifacts/e2e-20261020/`. Local scaffolding and logs are ignored by Git; the product repair and this report remain reviewable working-tree changes. Generated graphify files were refreshed as required by project instructions.

Cleanup completed: test Cores 2166/2167, the local fixture server 2186 and the stalled test harness were stopped. The temporary `desktop.env` credential file was removed. Existing Core 2160, OpenClaw 18789 and PostgreSQL 55432 remained on their original process IDs. The isolated schemas and evidence directory were retained for review; no schema or personal data was dropped. The text evidence/report scan found zero matches for configured secret values. See `cleanup.json` and `preservation.json`.

No claim is made for all hardware, disconnected Bluetooth devices, standalone connector availability, full CRUD, successful registration, autonomous error recovery, learned skill consolidation or 100% functionality. No external account was created, no destructive operation targeted personal resources, and no full repository test suite was substituted for live integration evidence.
