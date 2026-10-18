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

## Known gaps

- A candidate is chosen by tap only; the spec's spoken choice ("ikincisi") is not implemented.
- The first desktop step after a fresh install can exceed the 15 s step limit while `uvx`
  provisions Windows-MCP.
- Plan task records keep Snapshot text locally until conversation deletion or the 30-day purge.
- Free OpenRouter keys allow about 50 requests a day, so the full eval cannot run there daily.
