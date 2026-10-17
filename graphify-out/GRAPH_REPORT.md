# Graph Report - jarvis216  (2026-10-17)

## Corpus Check
- 67 files · ~33,264 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 5, .example 1, .lock 1)

## Summary
- 651 nodes · 1179 edges · 64 communities (58 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4b4d1cd9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- contracts.ts
- TaskService
- package.json
- BoundaryTests
- Task
- budget
- MASTER_DIRECTIVE.md
- Engineering report — JARVIS Core foundation
- items
- result.schema.json
- biome.json
- scripts
- CoreError
- compilerOptions
- verification
- properties
- README.md
- task.schema.json
- providers
- 2. MANDATORY CURRENT-DOCUMENTATION RESEARCH
- Research and compatibility — 2026-10-17
- envelope.schema.json
- properties
- Integration setup
- 17. TESTING AND CODE-LEVEL GUARANTEES
- 1. NON-NEGOTIABLE ENGINEERING PRINCIPLES
- JARVIS Core
- input
- 20. EXECUTION ORDER
- 21. ACCEPTANCE CRITERIA
- 3. ARCHITECTURAL AUTHORITY MODEL
- JARVIS Core Implementation Plan
- tsconfig.build.json
- payload
- ADR 0001: Modular monolith with PostgreSQL as the only scheduler
- ADR 0002: Durable intent and dispatch classification
- ADR 0003: Exact approvals and deterministic risk floors
- ADR 0004: Operators submit typed plans; models only propose
- JARVIS Core architecture
- 8. HUMAN APPROVAL AND RISK CLASSIFICATION
- items
- ADR 0005: Provider integration modes
- ADR 0006: n8n ingress boundary
- ADR 0007: Circuit breaker, graceful drain and network segmentation
- correlationId
- expiresAt
- messageId
- taskId
- timestamp
- deadline
- dependencies
- objective
- parentId
- privacy
- 6. DECISION ENGINE AND MODEL ROUTING
- recipient
- sender
- type
- jarvis-browser-worker

## God Nodes (most connected - your core abstractions)
1. `TaskService` - 41 edges
2. `Task` - 27 edges
3. `invariant()` - 25 edges
4. `buildServer()` - 21 edges
5. `Engineering report — JARVIS Core foundation` - 20 edges
6. `Executor` - 17 edges
7. `vitest` - 16 edges
8. `ProviderFailure` - 15 edges
9. `ProviderRegistry` - 15 edges
10. `Database` - 14 edges

## Surprising Connections (you probably didn't know these)
- `runApproved()` --calls--> `ActionGateway`  [EXTRACTED]
  tests/hardening.test.ts → src/gateway.ts
- `configuredProviders()` --calls--> `GeminiExecutor`  [EXTRACTED]
  src/config.ts → src/integrations/models.ts
- `containedPath()` --calls--> `invariant()`  [EXTRACTED]
  src/security.ts → src/contracts.ts
- `authenticate()` --calls--> `invariant()`  [EXTRACTED]
  src/server.ts → src/contracts.ts
- `GeminiExecutor` --implements--> `Executor`  [EXTRACTED]
  src/integrations/models.ts → src/contracts.ts

## Import Cycles
- None detected.

## Communities (64 total, 1 thin omitted)

### Community 0 - "contracts.ts"
Cohesion: 0.06
Nodes (51): @anthropic-ai/sdk, @electric-sql/pglite, fastify, pg, vitest, zod, ConfigSchema, configuredProviders() (+43 more)

### Community 1 - "TaskService"
Cohesion: 0.17
Nodes (11): ContextStore, insertContext(), fingerprint(), invariant(), taskDeadline(), TaskState, Sql, buildServer() (+3 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (37): dependencies, @anthropic-ai/sdk, fastify, @google/genai, @openai/codex-sdk, @opentelemetry/api, @opentelemetry/sdk-trace-base, @opentelemetry/sdk-trace-node (+29 more)

### Community 3 - "BoundaryTests"
Cohesion: 0.16
Nodes (13): Exception, Explicit opt-in public-page smoke test; no credentials, accounts or shared…, BoundaryTests, authorize(), encode(), extract(), main(), do_GET() (+5 more)

### Community 4 - "Task"
Cohesion: 0.17
Nodes (10): @google/genai, ExecutionResult, Task, jsonRequest(), networkCode(), neverDispatched(), notConnected, classify() (+2 more)

### Community 5 - "budget"
Cohesion: 0.08
Nodes (24): additionalProperties, default, properties, required, type, maxCalls, maxDurationMs, maxOutputTokens (+16 more)

### Community 6 - "MASTER_DIRECTIVE.md"
Cohesion: 0.10
Nodes (20): 10. N8N INTEGRATION ENGINE, 11. INTER-AGENT COMMUNICATION CONTRACT, 12. PERSISTENCE, MEMORY, AND CONTEXT MANAGEMENT, 13. SECURITY ENGINEERING, 14. RESOURCE AND PERFORMANCE MANAGEMENT, 15. FAILURE RECOVERY AND RESILIENCE, 16. OBSERVABILITY AND VERIFICATION, 18. DEVELOPMENT QUALITY STANDARDS (+12 more)

### Community 7 - "Engineering report — JARVIS Core foundation"
Cohesion: 0.10
Nodes (20): 10. Test results and evidence, 11. Security controls, 12. Failure recovery, 13. Known risks and limitations, 14. Unverified external dependencies, 15. Performance baseline, 16. Extension points, 17. Next milestones (+12 more)

### Community 8 - "items"
Cohesion: 0.10
Nodes (20): default, items, maxItems, type, exclusiveMinimum, maximum, type, additionalProperties (+12 more)

### Community 9 - "result.schema.json"
Cohesion: 0.12
Nodes (16): additionalProperties, maxLength, type, properties, externalId, source, text, required (+8 more)

### Community 10 - "biome.json"
Cohesion: 0.14
Nodes (13): formatter, indentStyle, indentWidth, lineWidth, quoteStyle, javascript, formatter, linter (+5 more)

### Community 11 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, benchmark, build, check, cli, contracts, dev, format (+5 more)

### Community 12 - "CoreError"
Cohesion: 0.19
Nodes (3): CoreError, serviceUrl(), N8nClient

### Community 13 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir, skipLibCheck (+4 more)

### Community 14 - "verification"
Cohesion: 0.17
Nodes (12): const, type, kind, value, verification, maxLength, minLength, type (+4 more)

### Community 15 - "properties"
Cohesion: 0.18
Nodes (11): anyOf, type, properties, causationId, idempotencyKey, protocolVersion, schemaVersion, const (+3 more)

### Community 16 - "README.md"
Cohesion: 0.33
Nodes (3): Data recovery, Recovery and operations, Threat model

### Community 17 - "task.schema.json"
Cohesion: 0.22
Nodes (8): type, additionalProperties, $defs, __schema0, required, $schema, anyOf, type

### Community 18 - "providers"
Cohesion: 0.25
Nodes (9): items, format, pattern, type, providers, items, maxItems, minItems (+1 more)

### Community 19 - "2. MANDATORY CURRENT-DOCUMENTATION RESEARCH"
Cohesion: 0.25
Nodes (8): 2. MANDATORY CURRENT-DOCUMENTATION RESEARCH, Browser Use, Claude, Codex, Gemini, n8n, OpenClaw, Research Requirements

### Community 20 - "Research and compatibility — 2026-10-17"
Cohesion: 0.25
Nodes (8): Browser Use, Claude, Codex, Evidence boundaries, Gemini, n8n, OpenClaw, Research and compatibility — 2026-10-17

### Community 21 - "envelope.schema.json"
Cohesion: 0.25
Nodes (7): additionalProperties, $defs, __schema0, required, $schema, anyOf, type

### Community 22 - "properties"
Cohesion: 0.25
Nodes (8): enum, type, properties, capability, risk, default, enum, type

### Community 23 - "Integration setup"
Cohesion: 0.29
Nodes (6): Browser Use, Claude and Gemini APIs, Codex SDK, Integration setup, n8n, OpenClaw

### Community 24 - "17. TESTING AND CODE-LEVEL GUARANTEES"
Cohesion: 0.29
Nodes (7): 17. TESTING AND CODE-LEVEL GUARANTEES, End-to-End Tests, Failure Injection, Integration Tests, Property-Based Tests, Security Tests, Unit Tests

### Community 25 - "1. NON-NEGOTIABLE ENGINEERING PRINCIPLES"
Cohesion: 0.29
Nodes (7): 1.1 Correctness Before Features, 1.2 Explicit Responsibility Ownership, 1.3 Deterministic Control, Probabilistic Intelligence, 1.4 Fail Closed When Necessary, 1.5 No False Guarantees, 1.6 Progressive Extensibility, 1. NON-NEGOTIABLE ENGINEERING PRINCIPLES

### Community 26 - "JARVIS Core"
Cohesion: 0.29
Nodes (7): Configuration, Control API, Developer commands, Documentation, JARVIS Core, Layout, Windows quick start

### Community 27 - "input"
Cohesion: 0.29
Nodes (7): $ref, additionalProperties, default, propertyNames, type, input, type

### Community 28 - "20. EXECUTION ORDER"
Cohesion: 0.33
Nodes (6): 20. EXECUTION ORDER, PHASE A — SOURCE RESEARCH AND ARCHITECTURE, PHASE B — MINIMAL WORKING FOUNDATION, PHASE C — REAL TECHNOLOGY INTEGRATIONS, PHASE D — ROBUST DECISION AND EXECUTION, PHASE E — HARDENING

### Community 29 - "21. ACCEPTANCE CRITERIA"
Cohesion: 0.33
Nodes (6): 21. ACCEPTANCE CRITERIA, Architecture, Execution, Integration, Quality, Security

### Community 30 - "3. ARCHITECTURAL AUTHORITY MODEL"
Cohesion: 0.33
Nodes (6): 3.1 JARVIS Core Backend — FINAL SYSTEM AUTHORITY, 3.2 OpenClaw — AGENT RUNTIME AND COORDINATION, 3.3 Browser Use — DEDICATED BROWSER EXECUTION, 3.4 n8n — EVENT AND WORKFLOW AUTOMATION, 3.5 Claude, Codex, and Gemini — MODEL AND SPECIALIST EXECUTION, 3. ARCHITECTURAL AUTHORITY MODEL

### Community 31 - "JARVIS Core Implementation Plan"
Cohesion: 0.33
Nodes (5): Execution gates, Global constraints, JARVIS Core Implementation Plan, Progress, Review focus

### Community 32 - "tsconfig.build.json"
Cohesion: 0.33
Nodes (5): ./tsconfig.json, compilerOptions, rootDir, extends, include

### Community 33 - "payload"
Cohesion: 0.33
Nodes (6): $ref, additionalProperties, propertyNames, type, payload, type

### Community 34 - "ADR 0001: Modular monolith with PostgreSQL as the only scheduler"
Cohesion: 0.40
Nodes (4): ADR 0001: Modular monolith with PostgreSQL as the only scheduler, Consequences, Context, Decision

### Community 35 - "ADR 0002: Durable intent and dispatch classification"
Cohesion: 0.40
Nodes (4): ADR 0002: Durable intent and dispatch classification, Consequences, Context, Decision

### Community 36 - "ADR 0003: Exact approvals and deterministic risk floors"
Cohesion: 0.40
Nodes (4): ADR 0003: Exact approvals and deterministic risk floors, Consequences, Context, Decision

### Community 37 - "ADR 0004: Operators submit typed plans; models only propose"
Cohesion: 0.40
Nodes (4): ADR 0004: Operators submit typed plans; models only propose, Consequences, Context, Decision

### Community 38 - "JARVIS Core architecture"
Cohesion: 0.40
Nodes (5): Event families, Execution and failure classification, JARVIS Core architecture, Not enabled, Risk and approval

### Community 39 - "8. HUMAN APPROVAL AND RISK CLASSIFICATION"
Cohesion: 0.40
Nodes (5): 8. HUMAN APPROVAL AND RISK CLASSIFICATION, CRITICAL RISK, HIGH RISK, LOW RISK, MEDIUM RISK

### Community 40 - "items"
Cohesion: 0.40
Nodes (5): items, type, enum, type, capabilities

### Community 41 - "ADR 0005: Provider integration modes"
Cohesion: 0.50
Nodes (3): ADR 0005: Provider integration modes, Consequences, Decision

### Community 42 - "ADR 0006: n8n ingress boundary"
Cohesion: 0.50
Nodes (3): ADR 0006: n8n ingress boundary, Consequences, Decision

### Community 43 - "ADR 0007: Circuit breaker, graceful drain and network segmentation"
Cohesion: 0.50
Nodes (3): ADR 0007: Circuit breaker, graceful drain and network segmentation, Consequences, Decision

### Community 44 - "correlationId"
Cohesion: 0.50
Nodes (4): format, pattern, type, correlationId

### Community 45 - "expiresAt"
Cohesion: 0.50
Nodes (4): format, pattern, type, expiresAt

### Community 46 - "messageId"
Cohesion: 0.50
Nodes (4): format, pattern, type, messageId

### Community 47 - "taskId"
Cohesion: 0.50
Nodes (4): taskId, format, pattern, type

### Community 48 - "timestamp"
Cohesion: 0.50
Nodes (4): timestamp, format, pattern, type

### Community 49 - "deadline"
Cohesion: 0.50
Nodes (4): format, pattern, type, deadline

### Community 50 - "dependencies"
Cohesion: 0.50
Nodes (4): default, maxItems, type, dependencies

### Community 51 - "objective"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, objective

### Community 52 - "parentId"
Cohesion: 0.50
Nodes (4): format, pattern, type, parentId

### Community 53 - "privacy"
Cohesion: 0.50
Nodes (4): default, enum, type, privacy

### Community 54 - "6. DECISION ENGINE AND MODEL ROUTING"
Cohesion: 0.67
Nodes (3): 6. DECISION ENGINE AND MODEL ROUTING, Fallback Policy, Model Integration Requirements

### Community 55 - "recipient"
Cohesion: 0.67
Nodes (3): recipient, const, type

### Community 56 - "sender"
Cohesion: 0.67
Nodes (3): sender, const, type

### Community 57 - "type"
Cohesion: 0.67
Nodes (3): type, enum, type

## Knowledge Gaps
- **321 isolated node(s):** `$schema`, `indentStyle`, `indentWidth`, `lineWidth`, `enabled` (+316 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 364 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `properties` connect `properties` to `budget`, `items`, `verification`, `task.schema.json`, `dependencies`, `deadline`, `objective`, `parentId`, `privacy`, `providers`, `input`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `TaskService` connect `TaskService` to `contracts.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `scripts` connect `scripts` to `package.json`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `buildServer()` (e.g. with `.list()` and `.actions()`) actually correct?**
  _`buildServer()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `indentStyle`, `indentWidth` to the rest of the system?**
  _321 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `contracts.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06443298969072164 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05204872646733112 - nodes in this community are weakly interconnected._