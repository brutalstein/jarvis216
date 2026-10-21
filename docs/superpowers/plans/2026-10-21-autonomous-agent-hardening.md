# Autonomous-agent hardening implementation plan

**Goal:** Fulfil the user's comprehensive brief through one Core-governed execution path with real acceptance evidence.
**Spec:** `docs/superpowers/specs/2026-10-21-autonomous-agent-hardening.md` and the attached eight-phase user brief.
**Constraints:** Preserve existing edits and all saved operator configuration; never invoke Claude; do not weaken HIGH approval, roots, authentication or sandbox boundaries.

## Gates and ownership

- [x] Preserve baseline patch/report and protected-file hashes; inspect current/relevant branches; create feature branch.
- [x] Complete source-grounded audit and record findings in `ARCHITECTURE_AUDIT.md`.
- [x] Contained CRUD with RED→GREEN checks; preserve snapshot repair.
- [x] Standalone interactive-browser/GitHub modules and catalog/Hub/config wiring.
- [x] Voice timing, device selection, connection lifecycle and signalling regressions.
- [x] Codex conversation profile, outcomes, discovery, permissions and persisted conditions.
- [x] Integrate and inspect cross-layer contracts; preserve old providers and migrations.
- [x] Full local gates, real PostgreSQL, copied PowerShell fixtures, Python, Electron and deterministic fault checks; fix/rerun reproducible defects.
- [x] Execute available real JARVIS acceptance and record every failed/blocked gate: complex planning/voice repeat FAIL; physical speech/Bluetooth/live fault recovery BLOCKED. Learned-plan reuse PASS.
- [x] Refresh graphify and sanitize evidence; protected hashes unchanged. Owned service cleanup is recorded in the final report.
- [x] Four reports and source review; evidence bundle contains observed outputs, not mock successes.
- [x] Commit/push related implementation and reports; open draft PR #6 and inspect CI. Repair missing desktop/Torch CI dependencies exposed by fresh jobs.
- [ ] Release merge: intentionally withheld while live Codex reliability acceptance remains failed and physical gates are blocked, regardless of CI results.

## Ledger

- Baseline: release/v1.0.0 at 3886783227328920f65876dee3536234ed69b263; original snapshot repair and reports preserved in artifacts/hardening-20261021/.
- Ruling: implement in the existing checkout on a new feature branch, keeping installed native runtimes and protected configuration in place; do not reset or stash user changes.
- Ruling: the explicit written brief asks for plan execution without stopping after analysis; use its stated constraints as design authority and settle routine engineering choices here.
- Source graph: graphify-out/graph.json, 2352 nodes at resumption; graph truncation is not exhaustive evidence. Extension allowlist limits optional MCP use; targeted source evidence remains necessary.
- Continuation: no subagents, per the user's later instruction. Existing implementation commit ba81c58 preserved; follow-up fixes c3c7683. Developer-required Tier 2 graph queries/coverage checks supplemented with direct source for stale/excluded paths.
- Release is not accepted merely because fixture tests or CI pass. Live Codex reliability and unavailable hardware gates remain explicit in E2E_REPORT.md and REMAINING_LIMITATIONS.md.
