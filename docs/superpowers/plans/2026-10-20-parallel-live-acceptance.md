# Parallel live acceptance implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, with TDD and one bounded final review.

**Goal:** Prove useful independent work through JARVIS Core, beginning with authenticated GitHub
identity and a local registration scenario; retain explicit release blockers.

**Architecture:** Add one fixed-purpose CLI executor and one integration recipe. Reuse the single
Core composition root, E2E harness, gateway, permissions, desktop actions and generated matrix.

**Tech Stack:** Existing Node 24, TypeScript, Zod, Vitest, PostgreSQL/PGlite and Windows-MCP.

**Spec:** `docs/superpowers/specs/2026-10-20-parallel-live-acceptance.md`.

## Global constraints

- No new dependency, arbitrary CLI arguments, credential copying, `.env` modification or third-party signup.
- Default off. Existing error semantics and coverage floors 93/84/92/95 remain.
- Every fixture/live distinction must survive in the evidence ledger; never infer full agent parity.
- Work on the existing operator-designated `release/v1.0.0` checkout, not main or operator data.

## Review focus

- A prompt cannot alter the GitHub endpoint/method or inject shell arguments.
- Credentials and raw child errors never enter task results; cancellation stops the child.
- Missing login/binary, invalid output and timeout must fail definitively, not claim connection.
- Both independent task actions must be simultaneously in flight, and complete independently.
- Opening a page is not registration; require a persisted account receipt from the owned site.

### Task 1: Fixed GitHub profile integration

**Files:** `src/integrations/github.ts`, `src/app/config.ts`, action-engine catalog,
integration-hub recipes, `tests/github.test.ts`, `tests/fixtures/fake-github.mjs`, affected matrix tests.

**Interfaces:** `GitHubExecutor({command: readonly [string, ...string[]]})`, id `github-cli`,
capability `info.fetch`; `createIntegrationHub({github?: boolean})`; action `github.profile({})`.
`ENABLE_GITHUB=true` plus an existing absolute `GITHUB_CLI_PATH` registers the executor/recipe.

- [ ] Write subprocess tests for fixed GET /user, minimal identity, secret isolation, auth/missing
  binary/invalid JSON/oversize/abort. Run `npx vitest run tests/github.test.ts` and observe red.
- [ ] Implement bounded `execFile` with shell disabled, a minimal native-login environment,
  30s maximum/deadline/abort and generic classified errors. Validate identity before returning it.
- [ ] Add the recipe/catalog/config seam, then regenerate 25-action permission inputs and contracts.
- [ ] Run targeted tests and `npm run check:ci`; expected all pass with unchanged coverage floors.
- [ ] Commit the feature and exact evidence.

### Task 2: Independent work and live acceptance

**Files:** `tests/e2e/parallel-work.test.ts`, existing harness as needed, owned-site fixture and
`scripts/live-acceptance.ts` only if an opt-in reusable entry point is needed.

**Interfaces:** Existing `boot`, `database`, Core task/plan APIs and the production GitHub executor.

- [ ] Add a controlled process/HTTP-boundary test: GitHub profile plus registered local signup
  workflow; require both actions running before releasing either, then verify separate task/event
  records and account receipt. Add one-independent-failure case. Run both databases.
- [ ] Run the real CLI via Core on a disposable schema, then the owned-site desktop form through
  Core with the operator present; record exact task IDs/outcomes and any blocked boundary.
- [ ] Record real GPU/model/microphone/voice/desktop checks separately; do not overwrite enrollment.
- [ ] Request bounded review, fix important findings with red/green tests, refresh graph, rerun gates,
  commit/push and verify CI. Preserve original release/matrix/installer work as incomplete until proven.
