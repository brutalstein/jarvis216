# Release matrix inputs and evidence

`npm run matrix:generate` regenerates `coverage.cases.json`. `npm run matrix:check`
fails on drift; CI runs it before the root gates. No credentials or live endpoints are needed.

| Input / suite | Current coverage | Evidence class |
| --- | --- | --- |
| `actions` | All 24 catalog actions; drift fails the generator test | tested only |
| `permissions` / `permissions-matrix.test.ts` | 720 action × policy rows, executed as 30 batched HTTP scenarios; permanent/1h/8h/1d grants, presets, expiry, audit and reload | tested only |
| `topology` / `topology-matrix.test.ts` | All 19 deterministic all-pairs rows executed: six flags, three language inputs, idle/busy and provider family; readiness, all 24 actions' availability, model catalog and persisted conversation execution checked | tested only |
| `providers-matrix.test.ts` | 27 cases: five provider families alone, no provider, seven classified failures, daily-budget restart, four unavailable-action/confidence cases and nine invalid startup configurations | tested only |
| `privacy-matrix.test.ts` | All 12 privacy × provider-trust combinations plus trust-change/restart invalidation of an old approval hash; task/action/approval records checked | tested only |
| `core.test.ts` auth sweep | Every registered route with operator/n8n/missing/wrong credentials, including a bounded real SSE connection | tested only |

`npm run test:e2e` uses PGlite. Set `E2E_DATABASE_URL` to the disposable PostgreSQL
instance for the same suites on PostgreSQL 18.3. Every suite gets its own schema.
Never point it at production ports 2160/55432 or the operator's PostgreSQL on 5432.

CI runs the whole E2E directory on Linux/PGlite, Windows/PGlite and Linux/PostgreSQL.
Windows/PostgreSQL is run on the release laptop. Desktop Playwright runs sequentially
on Linux and Windows. There are no matrix shards yet: measured local E2E duration is
under 30 seconds; shard when the expanded suite needs it.

Topology is a configuration smoke matrix, not a claim that every action was dispatched in every
row or that a real model answered correctly in each language. Busy rows hold both background slots
while conversation completes (or returns `NO_PROVIDER`). Enabled Codex uses temporary empty homes
and a generated dummy key for registration only; no SDK task, live news fetch or paid call runs.

Still required: transport-specific fallback variants, token/circuit/adaptive
restart combinations, permissions across every dispatch/approval path, the rest of the lifecycle,
conversation, memory/brain, n8n and failure-injection matrices, IPC fuzzing, desktop against Core,
voice crash/restart, bilingual GPU measurements and packaged-app/installer tests. Generated inputs
alone never satisfy those gates.
