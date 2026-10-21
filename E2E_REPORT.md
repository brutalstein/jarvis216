# JARVIS216 verified Windows E2E — 2026-10-21

**Result: supported real tasks work; overall reliability acceptance remains incomplete.** Tests were driven through JARVIS HTTP APIs/Electron. Codex supplied fixtures, repaired code and independently observed results. No direct Codex filesystem/browser/account action is counted as JARVIS execution. No real Claude or Claude Code was invoked.

Code: existing hardening commit `ba81c58830544278ed2c249b9e0e596937700027`, follow-up `c3c76832d85f425c39c38f894f9ab57b70738d4c`, branch `codex/autonomous-agent-hardening`, release base `3886783227328920f65876dee3536234ed69b263`. [Draft PR #6](https://github.com/brutalstein/jarvis216/pull/6) targets `release/v1.0.0`. The earlier report is retained as a historical baseline at the end.

## Test boundary

Real PostgreSQL 18.3 on `127.0.0.1:55432`, Core `2168`, fixture website `2188`, isolated schema `hardening_1792570275755`, disposable Electron/enrollment profiles and `artifacts/hardening-20261021/workspace`. All Claude flags and other model providers were disabled in the acceptance process environment; Codex used the existing isolated authentication. GitHub used its own native CLI authentication. Normal saved `.env` switches and Core on port 2160 were not changed.

The operator subsequently said **“Şu anda konuşamıyorum”**. Physical spoken recognition and human audibility therefore remain BLOCKED. A recorded Turkish WAV through the actual Electron capture/STT/Core/TTS transport is a separate software-path test. Chromium fake input/output devices in that run do not establish hardware compatibility.

## PASS / FAIL / BLOCKED matrix

| Scenario / assertion | Result | Observable evidence and limit |
|---|---|---|
| PostgreSQL | PASS | Real 18.3 server; scoped concurrent-bootstrap/claim/reconnect opt-in test passed. |
| Core | PASS | Isolated authenticated HTTP API, persistent tasks/plans and successful restart; no public liveness response counted as account proof. |
| Electron | PASS | Real test-profile window/voice launch; 21 UI tests passed, one physical opt-in skipped. |
| Brain notes | PASS | Saved `LANTERN_216` through a JARVIS plan, retrieved correctly in a later model reply and after Core restart. |
| Brain learned skill reuse | PASS | Three successful real file-read plans; fourth request used a learned plan with `provider:null`, `taskId:null`, 82 ms. Core executed/verified the read again. Brain skill has four successes and one use. |
| Action Engine | PASS | Real contained CRUD and conditional actions; independent filesystem observations. |
| MCP connections | PASS | Fresh authenticated discovery connected Windows-MCP (13 allowlisted descriptors) and Playwright MCP (5 allowed names). Discovery is not proof every tool works. |
| OpenClaw fresh acceptance | BLOCKED | Service was stopped at continuation; earlier real marker passed. No fresh optional OpenClaw task was run without a verified non-Claude backend. |
| GitHub authenticated profile | PASS | Real native-auth `/user` returned `brutalstein`; standalone provenance, not Codex's host connector. |
| GitHub repositories, natural request | PASS | JARVIS's natural-language first-page plan completed; first 10 included private repositories, with truncation explicitly reported. |
| GitHub complete available page | PASS | Typed Core task retest returned 27 repositories, 7 private, `truncated:false`. Native command output was independently schema-checked. This is a typed API retest, not a new natural-language full-list PASS. |
| `brutalstein/jarvis216` details | PASS | Typed Core task returned repository ID `1422808023`, branch `main`, public visibility and observed outcome. Natural requests for the details also timed out; that reliability failure remains below. |
| Browser registration | PASS | Natural JARVIS plan completed navigate/snapshot/fill Name/fill Email/approve Register/verify. Real `POST /register` and fixture server record `JarvisTest`, `jarvis216@example.invalid`; no external account. |
| File create | PASS | Natural five-step plan; independent readback `FIRST_216`. |
| File read / modify / reread | PASS | Independent readbacks `FIRST_216`, then `SECOND_216`; UI panels match observed contents. |
| File delete | PASS | Same rerun plan completed HIGH deletion under the isolated autonomous preset; independent `ENOENT`. Earlier approval-cancellation failure is retained. |
| Conditional execution | PASS | Natural matching branch completed. Typed Core API false-branch retest returned SKIPPED with zero actions; independent contents stayed NO_BRANCH. A natural-language false-branch repeat timed out, so runtime and language reliability are distinct. |
| Conditional natural-language repeat | FAIL | False-branch natural request returned `504 TURN_TIMEOUT`; the separately supplied typed Core condition is not counted as natural-language planning success. |
| Mixed tools | PASS | Natural GitHub-profile → local file-read plan completed both typed executors and displayed actual results. |
| Complex mixed-task reliability | FAIL | Two larger GitHub + conditional file requests returned `504 TURN_TIMEOUT`; a smaller mixed-plan PASS does not supersede these failures. |
| Permissions | PASS | Real guarded/ask flow and exact HIGH action approval earlier; autonomous preset completed isolated CRUD without repeated prompts. Permission/risk matrix and stale-approval tests passed. General Codex remains HIGH. |
| HTTP disconnect cancellation | PASS | Real local HTTP regression aborts in-flight provider for retry-safe and unsafe variants; statuses are CANCELLED and RECOVERY_REQUIRED respectively, preserving uncertainty. Fixture provider, not an upstream cancellation latency claim. |
| Transient recovery, live-provider acceptance | BLOCKED | Mock/fault-injection and restart tests pass; a complete real-provider fault/recovery workflow has not been demonstrated while Codex planning is intermittent. |
| Built-in microphone capture/transport | PASS | Senary microphone track live, outbound bytes increased after connection (421,867 final bytes); no intelligible physical utterance is inferred from that. |
| Physical wake word / Turkish recognition | BLOCKED | Operator could not speak during the final physical test. Prior “no answer” symptom does not establish a hardware/STT root cause. |
| Recorded Turkish STT / addressee handling | PASS | Actual WAV recognized “Jarvis, bugün neler yapabiliriz?” through real Whisper; repeat recognized it once before fixture input was muted. This is name/addressee detection, not proof of a standalone always-on keyword engine. |
| Recorded Codex → TTS software path | PASS | First run contained an actual Codex answer, Piper synthesis, received RTP/audio energy and playback. Timing below. |
| Recorded voice repeated reliability | FAIL | Controlled repeat reached STT but Core timed out; JARVIS spoke “Şu an yanıt veremiyorum, efendim.” This is failure handling, not a successful AI answer. |
| TTS playback transport | PASS | First run inbound bytes 343,929 and energy 6.2997, advancing unpaused audio; renderer playback-start event 19 ms. Human audibility remains unverified. |
| Native speaker selection | PASS | Selected real “Hoparlör (Senary Audio)” output; media element `sinkId` matched its enumerated non-default ID. No human hearing confirmation. |
| Physical audible response | BLOCKED | No operator hearing confirmation. |
| Bluetooth compatibility | BLOCKED | No connected Bluetooth headset/output available; an adapter alone is insufficient. |
| Protected configuration | PASS | Five baseline SHA-256 comparisons unchanged: dotenv files, isolated Codex auth, OpenClaw config, existing Electron Preferences. |

## Actual outputs and evidence identifiers

Sanitized, reviewable outputs are committed in [docs/evidence-hardening-20261021.json](docs/evidence-hardening-20261021.json). Detailed local logs remain under `artifacts/hardening-20261021/` (ignored; do not publish raw auth/session dumps).

| Execution | ID / artifact | Result excerpt |
|---|---|---|
| Codex-only conversation | task `a46bb55c…`, `conversation-v3.json` | “Merhaba efendim. Sistemler sakin, ben hazırım; siz nasılsınız?”; 5,881 ms. |
| Native GitHub profile | plan `987bc833-c198-4f19-aa1b-7209d0c4cde3` | `authenticated:true`, `login:brutalstein`, provenance `standalone:gh-native-auth`. |
| Repository list retest | task `4ec4c9ac-3efa-44ab-88d5-3e31d6f14bfe` | COMPLETED, 27 repositories / 7 private / not truncated. Private names/IDs are redacted from shared evidence. |
| Target metadata | task `e6c79ab3-602a-46ac-a8aa-882dfb3886e5` | `1422808023`, `brutalstein/jarvis216`, `main`. |
| Local registration | plan `45ff5de1-7701-4945-a743-763963a0ec37` | Six completed actions; server `POST /register` at `2026-10-21T08:20:49.257Z`; “Registration successful”. |
| CRUD rerun | plan `06467d93-b0a5-4451-af3b-b38cd6e601e8` | Five completed actions; FIRST_216 → FIRST_216 → SECOND_216 → SECOND_216 → ENOENT. |
| Conditional true branch | plan `75f11e32-9784-40a8-8265-f4cd5392c4e5` | Read MATCH_216 then HIGH delete completed. |
| Mixed tools | plan `993c2783-d1ea-4409-8275-49bcb7e3c109` | GitHub profile COMPLETED; file.read COMPLETED with MIXED_216. |
| Memory after restart | task `9f439e0a-6c40-4743-9609-8205267418f8` | “Your test code is LANTERN_216, sir.”; 4,525 ms. |
| Learned skill reuse | plan `d7c2bb26-bffc-4190-8b1a-d5e5842548ac` | No model task; reused verified read plan, completed. Skill `2b0a9fad-451f-4d16-84fd-e7ca792a7be6`, `successes:4`, `uses:1`. |
| Conditional false runtime | task `d0c8e3c4-1a97-4eeb-84a5-a2d14f81e535` | SKIPPED; zero actions; independent file contents remain NO_BRANCH. Typed API request. |

Recorded first-run timing (ms):

```json
{"turnEndMs":231,"segmentQueueMs":0,"speakerMs":0,"transcribeMs":625,"sttMs":625,"coreMs":5687,"replyWaitMs":0,"firstAudioMs":6856,"totalMs":6918,"ttsMs":375,"ttsFirstAudioMs":313}
```

Actual first reply: “Bugün GitHub depolarınızı inceleyebilir, açık sorunları gözden geçirebilir, izinli web işlemleri yapabilir veya bilgisayarınızdaki dosya ve uygulamalarla çalışabiliriz, efendim. Ne yapmak istersiniz?”

Controlled repeat: STT 594 ms, Core 20,078 ms, first audio 20,996 ms; spoken fallback rather than an AI answer. The first run's repeating WAV interrupted several turns; its one successful answer is evidence of capability, not repeatability. Old mutable VAD timings must not be used to claim a measured 20-second STT speedup.

## Reproduced defects and retests

| Defect | Cause established by evidence | Repair / retest |
|---|---|---|
| False delegated completion | Any non-empty agent prose satisfied old verification, including a refusal. | Structured postcondition gate; unsafe unverified outcomes require recovery. Fixture tests confirm. |
| Approval disappears before file delete | Plan refresh recognized awaiting HIGH integration actions but not HIGH desktop actions. | All awaiting exact approvals retained until deadline; regression and complete real CRUD rerun pass. |
| Later steps prematurely expire | Per-step duration omitted earlier dependency waiting. | Cumulative admission budget within plan window; regression passed. |
| Abandoned voice HTTP requests retain model work | Disconnect signal stopped at the HTTP boundary. | Propagated to intent/repair wait and Task Service/worker cancellation; real-socket regression passes for safe/unsafe executors. Not claimed as the root cause of all upstream timeouts. |
| Full GitHub page becomes uncertain | Independent inspection measured 144,613 raw response bytes, exceeding the 128,000-byte subprocess capture bound. | Fixed field projection before capture; noisy-response RED→GREEN and actual 27-repo retest pass. Bound was not raised; independent inspection is not counted as JARVIS execution. |
| Capabilities connection dropped | 10-second HTTP idle timeout could precede MCP discovery completion. | Bounded initialize/shared-page discovery and endpoint idle allowance; fresh connected descriptors, stalled child eventually reaped. |
| Malformed ICE yields 500/partial batch | Candidate field types/SDP assertions unvalidated and list silently sliced. | Reject invalid/overlarge batches before application; server regression passes, valid end-of-candidates accepted. |
| Root CI cannot typecheck voice renderer imports | CI installed only root dependencies; desktop has a separate lockfile. | Install desktop dependencies in TypeScript job; fresh CI remains an independent gate. |
| Intermittent Codex timeout | Authoritative deadline reached before a useful model result. Native failed sessions show no completed answer. | Upstream transport/model cause unresolved; FAIL retained. Saved model/provider settings and deadlines were not changed to conceal it. |

## Quality gates and release

Last full local coverage: **769 PASS / 1 SKIP**, existing coverage floors passed (lines 95.43%, statements 93.34%, functions 93.26%, branches 84.80%). Expanded two-variant HTTP cancellation regression passed afterward. Real PostgreSQL: 1 PASS; Electron: 21 PASS / 1 SKIP; Python voice: 42 PASS, affected server rerun 10 PASS; Python browser: 15 PASS. Typechecks, lint, builds, matrix check, Ruff, mypy and four isolated PowerShell CI blocks passed. Both npm audits reported zero vulnerabilities. Unit/fixture checks are not counted as real integration successes in the matrix.

Cleanup: JARVIS deleted the remaining isolated `condition.txt` and `mixed.txt` fixtures; independent checks confirm all CRUD/conditional fixture files absent. Owned Core/site ports 2168/2188 closed; disposable Electron/voice sessions closed. PostgreSQL remains healthy/available. Isolated schemas and sanitized evidence are retained for investigation. Final protected-file comparisons remained unchanged.

The earlier remote run for `ba81c58` failed TypeScript because of the missing desktop dependencies; other Python/PostgreSQL/voice/service-manager/desktop jobs passed. The current code fixes that installation gap. Commit `d1f5fd9` also includes voice timing regressions in CI with the pinned Whisper/Piper extras. The first expanded voice run at `75e1ca4` exposed the missing Torch import dependency; CI now adds the hash-pinned CPU wheel corresponding to the production lockfile's Torch 2.11.0 version, from the [official PyTorch CPU index](https://download.pytorch.org/whl/cpu/torch/). Production CUDA configuration is unchanged and no GPU models are downloaded by CI.

Remote CI status and exact tested head are available at [PR #6 checks](https://github.com/brutalstein/jarvis216/pull/6/checks). The local completion receipt is `artifacts/hardening-20261021/ci-final.json`; earlier failures are retained in that directory. **No release merge while failed live reliability acceptance remains open, even if CI is green.**

### CI continuation — 2026-10-22

The complete [push run for c0b38dd](https://github.com/brutalstein/jarvis216/actions/runs/39638428313) passed all eight jobs, including voice timing and both operating systems. Ubuntu reported 769 passing tests / two platform or opt-in skips, with coverage floors passed. The same commit's PR run passed seven jobs but hit a Python HTTP-test race: urllib kept sending a chunked body after the server had correctly rejected its headers and closed the connection, producing BrokenPipe before the client read the 400 response.

The test now sends only the rejected headers and reads the response directly; it still requires HTTP 400 and the exact denial payload. No browser-worker production behavior was relaxed and no exception was suppressed. All 15 browser Python tests, 20 consecutive repetitions of the affected case, Ruff, format and mypy passed locally. New-head CI is independently verified through the linked checks and completion receipt; the earlier failed run remains evidence.

The next PR run passed Python but exposed a separate Windows fixture deadline: `spawnSync` killed a cold PowerShell startup at exactly 10 seconds (`status:null`), before the fake OpenClaw script returned. Only this fixture's process allowance is now 30 seconds, with a 65-second budget for its two launches and an explicit spawn-error assertion. The launcher, credential stripping, lock-preservation assertions and all production/Codex deadlines are unchanged. Five consecutive local runs plus typecheck/lint passed; hosted CI remains the independent check of the revised fixture allowance.

## Historical baseline — 2026-10-20

The following original report describes the earlier build and is retained for comparison. Its failures are superseded only where the newer matrix gives explicit retest evidence.

### Original local Windows E2E report

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
