# ADR 0017: Layered modules, a composition root and end-to-end verification

Status: accepted, 2026-10-19.

## Context

`src/` had grown to thirty files in one folder; the plan service was 1140 lines and the HTTP
server 440. `main.ts` wired every service and had no test at all, so a wiring fault (a routing
wrapper that dropped the progress callback) surfaced only in an integration test written for
something else. The desktop, voice service and browser worker were not exercised in CI.

## Decision

1. **Layers with one dependency direction**, enforced by `tests/architecture.test.ts`:
   `core` (task authority, gateway, workers, routing, database) ← `integrations` (adapters) ←
   `services` (plans, conversation, narration, permissions, learning stores, outbox) ← `http`
   (route modules) ← `app` (configuration, composition) ← entry points. Core imports no
   workspace package; the packages never import Core or the desktop; the desktop takes only
   types from Core.
2. **Cohesive modules over large files.** The plan service is split into model, view (pure),
   finishers, working memory and the service; HTTP routes live in modules over a shared context.
3. **One composition root.** `createCore(config, { db, env, executors? })` wires every service
   in dependency order and owns an idempotent, ordered `stop()` (stop accepting requests, let
   in-flight ones finish, drain workers, close the MCP child). The caller owns the database, so
   a restart can reuse it. `main.ts` only reads configuration, handles signals and owns tracing
   and the pool. Injected executors are registered like configured ones; they are the only
   seam end-to-end tests need.
4. **End-to-end tests through the composition root** (`tests/e2e`): the real HTTP API, live
   stream, workers and executors against fake services over real HTTP and a simulated
   Windows-MCP over real stdio; on PGlite locally and on PostgreSQL in CI.
5. **Every component in CI**: Core on Linux and Windows with coverage floors, PostgreSQL with
   the end-to-end suite, the desktop under xvfb, the voice service without its GPU models, and
   the browser worker.

## Consequences

- A new import that crosses a layer the wrong way fails the build.
- Wiring is tested by the same path production uses; the end-to-end suite found two faults on
  its first run (page reads and cancelled safe calls ending as "uncertain").
- Paths changed (`src/core/tasks.ts` instead of `src/tasks.ts`); `dist/main.js` and the image
  are unchanged.
