# JARVIS216 architecture audit — 2026-10-21

Status: implementation and acceptance testing in progress. This is an evidence ledger, not a functionality certification.

## Scope and preservation

Base: `release/v1.0.0`, commit `3886783227328920f65876dee3536234ed69b263`. Work branch: `codex/autonomous-agent-hardening`. Existing snapshot repair, E2E report and graph changes were preserved before edits in `artifacts/hardening-20261021/preexisting.patch`. Protected configuration hashes are in `protected-before.json`; no saved operator configuration is intentionally edited. Claude is disabled in every live acceptance Core's process environment.

Source retrieval used local graphify queries followed by the relevant source. The initial graph had 2,352 nodes; truncated queries do not establish exhaustive coverage. Optional graph MCP extensions were not invoked because of the supplied extension allowlist. Relevant branch comparison found reusable native GitHub CLI handling on `feature/live-acceptance-20261020-133005`; merging that older branch wholesale would remove newer infrastructure and CI work, so only compatible behavior was reused.

## Existing execution authority

`ConversationService` combines addressee/reflex handling, recent conversation, working memory, Brain recall and notes, then asks a configured text provider for an intent. Action Engine's catalog/compiler validates that intent. `PlanService` persists an ordered plan and dependent Core tasks. Task Service, Gateway and workers own authorization, exact approval hashes, leases, cancellation, dispatch, verification, usage and bounded recovery. IntegrationHub supplies recipes; it does not own policy or orchestration. These boundaries should be retained.

Brain already stores intent experiences, outcomes and choices; recalls them into the prompt; and consolidates verified outcomes into skills. A saved note is not proof that a reusable autonomous skill was learned. That distinction must remain visible in acceptance results.

## Findings and implementation boundary

| Priority | Observed finding | Responsible boundary / disposition |
|---|---|---|
| P0 | Non-empty agent prose, including a refusal, can satisfy delegated-task verification. Earlier browser/file requests were falsely COMPLETED. | Add a structured executor outcome and a postcondition verification mode. Delegated agent reports without independent evidence remain unverified. |
| P0 | Read-only Codex plus network-disabled sandbox still reached host GitHub connectors in the earlier E2E. | Keep the general executor HIGH. Add a distinct conversation profile with shell/apps/plugins/hooks/MCP/browser/computer/delegation tools disabled, and reject unexpected tool-execution items. Native integration evidence must name its provenance. |
| P1 | `conversationProviders()` excludes general Codex, so a Codex-only Core returned NO_PROVIDER. | Register/select the separate `codex-live` profile; do not lower the original agent executor's approval floor. |
| P1 | The desktop executor's risk check only rejects MEDIUM→LOW downgrades. | Compare ordered risks so a crafted LOW/MEDIUM task cannot dispatch new HIGH deletion. |
| P1 | Plan refresh cancels an awaiting HIGH desktop action because it only recognizes HIGH integration actions. Reproduced on the real file-delete test. | Keep any exact action approval actionable while its task deadline remains valid. |
| P1 | Later tasks share admission time but each received only one step's duration budget; dependency waiting can exhaust later tasks prematurely. | Include cumulative dependency waiting within the existing bounded plan deadline. |
| P1 | Existing file actions do not provide typed bounded text create/read/write/delete. | Add these at the existing contained filesystem Action Engine boundary; no general shell. Verify readback/absence. |
| P1 | Existing browser worker is public HTTPS extraction, not interactive form automation. | Separate plan-scoped official Playwright MCP integration with fresh element grounding and observable postconditions. Preserve the extraction worker's egress rules. |
| P1 | Existing GitHub success used a Codex host connector, not standalone JARVIS integration. | Native `gh api` executor with fixed typed routes, native credential store, schema validation, bounded reads and explicit write approval/readback. |
| P1 | STT reads mutable VAD timing after asynchronous inference. Later speech can overwrite earlier segment timing. | Queue immutable per-segment timing and separately measure queue, speaker embedding and decoding. This repairs telemetry; it does not establish the cause of missed physical speech. |
| P1 | TTS buffers all synthesized chunks before yielding the first; announcements can contaminate user-turn timing. | Stream chunks, distinguish announcement timing, and retain actual browser playback timing separately. |
| P1 | Failed voice pipelines can retain a stale session; concurrent offers can create competing sessions. | Serialize offers, clear failed peers and clean failed connection/device resources. |
| P2 | Output selection is missing; playback uses the OS default output. | Add live output enumeration/selection and retain it across reconnects within the current app process. Bluetooth remains dependent on an actual connected device. |
| P2 | MCP discovery only returns names from a single page, and readiness marks configured providers without probing them. | Paginated allowlisted descriptors plus an authenticated capabilities endpoint; distinguish configured credentials, connected tools and verified account access. |
| P2 | Adding Codex conversation made two topology fixtures accidentally select a real SDK executor with fixture credentials. | Explicitly inject `codex-live` in those test configurations and preserve the native registration override boundary. Mock tests must never invoke external providers. |

## Evidence limits and pending gates

The earlier physical test showed an active microphone track and transport, but energy was largely before connection and then flat. It did not establish intelligible post-connect speech reaching STT. Neither hardware failure nor an STT decoding root cause can be concluded from that trace. A fresh physical test is required.

The pinned Playwright MCP README explicitly states that allowed origins are not a security boundary and do not cover redirects. Local acceptance uses only the controlled loopback fixture. External origins require a separately verified egress-isolation attestation; none is claimed by this audit.

Fresh baseline before this implementation: 701 tests passed, one live-PostgreSQL test skipped. Current acceptance has verified a real Codex-only Turkish conversational reply and standalone authenticated GitHub profile access. More complex requests have also hit the current 20-second turn deadline; those failures remain evidence, not hidden retries. Final test counts, physical voice results, protected hashes and remaining limitations belong in the final reports after reruns.

Official configuration references: [OpenAI Codex SDK](https://developers.openai.com/codex/sdk), [OpenAI configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json), [pinned Microsoft Playwright MCP README](https://github.com/microsoft/playwright-mcp/blob/v0.0.83/README.md).
