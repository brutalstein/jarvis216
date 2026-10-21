# Autonomous-agent hardening implementation plan

**Goal:** Fulfil the user's comprehensive brief through one Core-governed execution path with real acceptance evidence.
**Spec:** `docs/superpowers/specs/2026-10-21-autonomous-agent-hardening.md` and the attached eight-phase user brief.
**Constraints:** Preserve existing edits and all saved operator configuration; never invoke Claude; do not weaken HIGH approval, roots, authentication or sandbox boundaries.

## Gates and ownership

- [x] Preserve baseline patch/report and protected-file hashes; inspect current/relevant branches; create feature branch.
- [ ] Complete source-grounded audit and record findings in `ARCHITECTURE_AUDIT.md`.
- [ ] File worker: existing Action Engine catalog/run/tests; implement contained CRUD with RED→GREEN checks. Preserve snapshot repair.
- [ ] Integration worker: new interactive-browser/GitHub executor modules and focused tests. Parent owns their catalog/Hub/config wiring to avoid concurrent edits.
- [ ] Voice worker: Python voice stages and desktop media/connection/settings/UI/tests; correct telemetry, devices and lifecycle with regression proof.
- [ ] Parent: Codex SDK profile and conversation routing, common contracts/outcomes, capability discovery, IntegrationHub/config wiring and permission/conditional/recovery gates.
- [ ] Integrate workers, inspect complete diff and cross-layer contracts; preserve old providers and migrations.
- [ ] Run full checks, real PostgreSQL, PowerShell, Python, Electron and bounded fault tests. Resolve reproducible defects, rerun affected gates.
- [ ] Execute natural-language acceptance through isolated real JARVIS: Codex-only conversation/voice; standalone authenticated GitHub; file CRUD; browser registration/server readback; mixed tools; fault recovery; memory reuse; permission presets; physical devices where available.
- [ ] Refresh graphify; verify protected hashes and sanitize evidence; stop only owned test resources.
- [ ] Finalize `ARCHITECTURE_AUDIT.md`, `IMPLEMENTATION_REPORT.md`, `E2E_REPORT.md`, `REMAINING_LIMITATIONS.md`; fresh branch review.
- [ ] Commit/push related implementation and reports, create PR, inspect required CI. Merge to release only if all applicable required gates pass.

## Ledger

- Baseline: release/v1.0.0 at 3886783227328920f65876dee3536234ed69b263; original snapshot repair and reports preserved in artifacts/hardening-20261021/.
- Ruling: implement in the existing checkout on a new feature branch, keeping installed native runtimes and protected configuration in place; do not reset or stash user changes.
- Ruling: the explicit written brief asks for plan execution without stopping after analysis; use its stated constraints as design authority and settle routine engineering choices here.
- Source graph: graphify-out/graph.json, 2352 nodes at resumption; graph truncation is not exhaustive evidence. Extension allowlist limits optional MCP use; targeted source evidence remains necessary.
