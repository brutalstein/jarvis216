# Action engine evidence (M3, cycle 1)

Date: 2026-10-18. Branch `feature/latest-development`. Design:
[spec](superpowers/specs/2026-10-18-intent-action-engine-design.md),
[ADR 0010](ADR/0010-model-proposed-typed-plans.md).

Each claim is labelled **live-verified** (ran on this laptop against the real service),
**tested only** (automated tests with fakes or recorded fixtures) or **not run**.

## Intent eval

Set: `packages/action-engine/eval/commands.jsonl`, 120 distinct commands, 60 Turkish and 60
English. Each language has 37 plans (single and multi-step, slang and recognition errors such
as "spotifayı", "vatsap", "note pad"), 10 replies (chit-chat, plus out-of-scope or dangerous
requests: delete everything, `format c`, card payments, passwords, sending messages), 7
clarifications and 6 cancellations. A row scores only when the kind, the exact action order and
every gold key argument match (text normalised, URLs parsed). The test suite checks that every
gold plan compiles.

Run: `npx tsx --conditions=jarvis-source --env-file=.env scripts/eval-intents.ts`. Each row goes
through the production conversation prompt with all integration actions enabled. Scoring is
first shot: production's single repair call is not used, so accuracy is a lower bound.

EVAL_RESULTS

## Live checks

| Check | Result | Class |
| --- | --- | --- |
| RSS news fetch (Google News TR, real network) | 5 items from 5 sources, de-duplicated, newest first; this feed carries no thumbnails | live-verified |
| Windows-MCP 0.8.8 via `uvx`, Core's tool allowlist | Exactly the 12 allowlisted tools; PowerShell and Registry absent; cold start 16.6 s (first download), warm 3.4 s | live-verified |
| Notepad open, type and read back | Fake ToolPort tests only | not run live |
| Close with the unsaved-changes dialog | Fake ToolPort tests only | not run live |
| Today's news panels and spoken brief through voice | Engine and Core tests; the fetch above is live | not run live (voice path) |
| Spotify open and pause (LOW, no card) | Fake ToolPort tests only | not run live |
| "dur" mid-run and operator takeover | Core cancel tests only | not run live |

The voice desktop scenarios were not run: the operator's `.env` keeps `ENABLE_DESKTOP=false`, and
their open Notepad window holds credentials that a typing step or a Snapshot could touch or
capture. Run them with the operator present, on a clean Notepad window, after enabling
`ENABLE_DESKTOP` and `ENABLE_NEWS`.

## Automated verification

| Command | Result |
| --- | --- |
| `npm run check` (typecheck, lint, Vitest, build) | Pass; 407 tests passed, 1 skipped (live PostgreSQL); 8 existing CSS lint warnings |
| `npm --prefix apps/desktop run typecheck`, `npm --prefix apps/desktop test` | Pass; 16 passed, 1 opt-in e2e skipped |
| `uv run --project workers/browser --locked python -m unittest discover -s workers/browser`, mypy | 9 tests OK; mypy clean |
| `uv run --frozen --directory workers/voice python -m unittest discover -s tests` | 28 tests OK |

## Follow-up (2026-10-18, branch `feature/jarvis-latest-v2`)

| Former gap | Now | Class |
| --- | --- | --- |
| Candidates chosen by tap only | A bare spoken ordinal ("ikincisi", "ilkine tıkla", "the second one", "3rd", "sonuncusu") continues the plan that just stopped on several matches, without a model call; a bare stop phrase cancels the active plan the same way (`readVoiceCommand`, 29 parser cases, Core integration tests) | tested only |
| First desktop step could exceed 15 s while `uvx` provisions Windows-MCP | Core starts Windows-MCP in the background at boot | tested only |
| Snapshot text kept in plan task records until deletion or purge | Replaced by a marker in every task and action record once the describe finisher or replan has used it | tested only |
| Replan without the screen | The replan prompt now receives window and element names from a fresh Snapshot (never field values), as the spec intended | tested only |
| Intent JSON depended on prose discipline | Turns, repairs and replans request native JSON mode (Gemini, OpenRouter); the eval script does the same | tested only (live eval not re-run) |

New catalog actions `memory.save` and `memory.forget` (MEDIUM, governed by Settings permissions)
are covered by engine and Core tests; the 120-row eval set does not include them yet.

| Former gap | Now | Class |
| --- | --- | --- |
| Every MEDIUM/HIGH step waited for a tap, even for routine voice work | Per-action ask/allow/deny with presets and timed grants, managed in Settings; allowed steps of a running plan are approved by the standing grant (recorded as `approval.granted`, `via: "standing-grant"`), denied actions are hidden from prompts and re-checked by the gateway ([ADR 0014](ADR/0014-operator-standing-permissions.md)) | tested only |
| No learning between requests | `@jarvis/brain`: experiences, outcome reinforcement, skills, decay and consolidation, BM25 (+ optional embeddings) recall into the prompt, reflexes that skip the model for practised phrases, learned candidate choices ([ADR 0015](ADR/0015-learning-brain-and-layered-intent.md)) | tested only |
| "Durum ne?" needed a model call; corrections taught nothing | Status questions answered from Core's records; "hayır, ..." marks the previous request corrected and weakens what it learned | tested only |
| Low-confidence plans ran or were proposed as is | Plans with confidence below 0.5 become a confirm question; the next turn sees what was asked | tested only |
| "Tamam" after an agent or page read | A short spoken summary of what came back (private providers only) | tested only |

The eval set has no rows for reflexes, corrections or status questions yet, and none of these has
been exercised against a live model or desktop.

## Known gaps

- Free OpenRouter keys allow about 50 requests a day, so the full eval cannot run there daily;
  `PROVIDER_BUDGETS_JSON` can now keep routing within that quota.
- The live eval (`EVAL_RESULTS` above) and the voice desktop scenarios have not been re-run since
  the follow-up changes.
