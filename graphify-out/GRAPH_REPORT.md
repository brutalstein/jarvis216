# Graph Report - jarvis216  (2026-10-21)

## Corpus Check
- 272 files · ~291,478 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 5, .xml 2, .lock 2)

## Summary
- 2505 nodes · 5184 edges · 185 communities (162 shown, 14 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 201 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ba81c588`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- vitest
- ConversationService
- package.json
- Request
- PlanService
- budget
- MASTER_DIRECTIVE.md
- Engineering report — JARVIS Core foundation
- items
- properties
- biome.json
- scripts
- FakeCore
- compilerOptions
- desktop/package.json
- properties
- README.md
- task.schema.json
- dependencies
- 2. MANDATORY CURRENT-DOCUMENTATION RESEARCH
- Subscription providers and local OpenClaw — design
- envelope.schema.json
- properties
- objective
- 17. TESTING AND CODE-LEVEL GUARANTEES
- 1. NON-NEGOTIABLE ENGINEERING PRINCIPLES
- dependencies
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
- Review Focus
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
- telemetry.ts
- devDependencies
- ADR 0008 — Subscription CLI harnesses on native Windows
- action-engine/src/types.ts
- 6. DECISION ENGINE AND MODEL ROUTING
- recipient
- sender
- type
- jarvis-browser-worker
- TaskService
- contracts.ts
- services.ts
- fake-claude.mjs
- JARVIS desktop design
- ProviderRegistry
- run.ts
- plans.test.ts
- SpeakerGate
- JARVIS voice desktop experience — design
- config.ts
- Microphone
- Review Focus
- JARVIS intent and action engine (M3, cycle 1) — design
- McpToolPort
- news.ts
- main/main.ts
- app.ts
- Presence
- action-engine/package.json
- run.test.ts
- jarvis-services.ps1
- permissions.ts
- Review Focus
- Task
- Enrollment
- Turn
- guards.ts
- claude-code.test.ts
- snapshot.ts
- settings
- FollowUpWindow
- eval-intents.ts
- compilerOptions
- news.test.ts
- integration-hub/src/index.ts
- integration-hub/package.json
- compilerOptions
- hud.ts
- compilerOptions
- shared.ts
- BilingualTTS
- FakeConnection
- Research and compatibility — 2026-10-17
- JARVIS Core
- Action engine evidence (M3, cycle 1)
- GatedSTT
- run_session
- Integration setup
- core.ts
- smoke.py
- textOf
- JARVIS Core architecture
- dependencies
- services/conversation.ts
- catalog.ts
- github.ts
- interactive-browser.ts
- risk
- ADR 0010: Models propose typed plans; a compiler and the operator admit them
- harness.ts
- assets.d.ts
- jarvis-voice
- Voice integration hub
- controls.ts
- live.ts
- BrainStore
- brain.ts
- Brain
- Review Focus
- Brain
- fake-windows-mcp.ts
- hud.spec.ts
- brain/package.json
- brain.test.ts
- compilerOptions
- server.ts
- settings.spec.ts
- MemoryBrainStore
- .brain
- devDependencies
- contrast
- JARVIS v1.0.0 release progress
- architecture.test.ts
- .experience
- scripts
- .recall
- condition
- JARVIS voice service
- ADR 0011: Measured adaptive routing, durable circuits and usage budgets
- ADR 0012: Operator-approved long-term memory
- ADR 0013: n8n task outcomes through a transactional outbox
- ADR 0014: Operator-managed standing permissions
- memory.ts
- ADR 0016: Duplex conversation and live progress
- ADR 0017: Layered modules, a composition root and end-to-end verification
- cachePrefix
- .choose
- models.ts
- Outbox
- persona.ts
- normalize
- reliability.ts
- Claude Code agent: extensible JARVIS execution
- Windows native JARVIS service manager
- 2026-10-20-snapshot-error-e2e.md
- routing.ts
- matrix/README.md
- JARVIS216 local Windows E2E report
- ServerTest
- generate.ts
- JARVIS216 architecture audit — 2026-10-21
- JARVIS216 autonomous-agent hardening design
- maxOutputTokens
- typed-github.mjs
- Autonomous-agent hardening implementation plan
- privacy

## God Nodes (most connected - your core abstractions)
1. `TaskService` - 73 edges
2. `vitest` - 71 edges
3. `Task` - 66 edges
4. `PlanService` - 64 edges
5. `Database` - 48 edges
6. `ProviderFailure` - 46 edges
7. `invariant()` - 41 edges
8. `ProviderRegistry` - 41 edges
9. `Executor` - 40 edges
10. `ConversationService` - 36 edges

## Surprising Connections (you probably didn't know these)
- `Bridge` --references--> `PlanView`  [EXTRACTED]
  apps/desktop/src/shared.ts → src/services/plans/model.ts
- `evaluate()` --calls--> `scoreIntent()`  [EXTRACTED]
  scripts/eval-intents.ts → packages/action-engine/src/eval-score.ts
- `evaluate()` --calls--> `parseReply()`  [EXTRACTED]
  scripts/eval-intents.ts → src/services/conversation.ts
- `evaluate()` --calls--> `conversationPrompt()`  [EXTRACTED]
  scripts/eval-intents.ts → src/services/persona.ts
- `boot()` --calls--> `createCore()`  [EXTRACTED]
  tests/e2e/harness.ts → src/app/core.ts

## Import Cycles
- None detected.

## Communities (185 total, 14 thin omitted)

### Community 0 - "vitest"
Cohesion: 0.09
Nodes (26): @electric-sql/pglite, pg, vitest, Action, canTransition(), TaskSpecSchema, verified(), Database (+18 more)

### Community 1 - "ConversationService"
Cohesion: 0.15
Nodes (3): ConversationService, learned(), turn()

### Community 2 - "package.json"
Cohesion: 0.10
Nodes (19): engines, node, @types/node, typescript, zod, name, private, type (+11 more)

### Community 3 - "Request"
Cohesion: 0.06
Nodes (30): Exception, Progress, ThreadingHTTPServer, Explicit opt-in public-page smoke test; no credentials, accounts or shared…, BoundaryTests, FakeBrowser, FakePage, Any (+22 more)

### Community 4 - "PlanService"
Cohesion: 0.05
Nodes (44): planApprovalMs, TaskProgress, defaults, durationKey(), Durations, Finisher, finisherOf(), kindOf() (+36 more)

### Community 5 - "budget"
Cohesion: 0.11
Nodes (19): additionalProperties, default, properties, required, type, maxCalls, maxDurationMs, maxOutputTokens (+11 more)

### Community 6 - "MASTER_DIRECTIVE.md"
Cohesion: 0.10
Nodes (20): 10. N8N INTEGRATION ENGINE, 11. INTER-AGENT COMMUNICATION CONTRACT, 12. PERSISTENCE, MEMORY, AND CONTEXT MANAGEMENT, 13. SECURITY ENGINEERING, 14. RESOURCE AND PERFORMANCE MANAGEMENT, 15. FAILURE RECOVERY AND RESILIENCE, 16. OBSERVABILITY AND VERIFICATION, 18. DEVELOPMENT QUALITY STANDARDS (+12 more)

### Community 7 - "Engineering report — JARVIS Core foundation"
Cohesion: 0.08
Nodes (26): 10. Test results and evidence, 11. Security controls, 12. Failure recovery, 13. Known risks and limitations, 14. Unverified external dependencies, 15. Performance baseline, 16. Extension points, 17. Next milestones (+18 more)

### Community 8 - "items"
Cohesion: 0.10
Nodes (20): default, items, maxItems, type, exclusiveMinimum, maximum, type, additionalProperties (+12 more)

### Community 9 - "properties"
Cohesion: 0.05
Nodes (39): additionalProperties, maxLength, type, maximum, minimum, type, additionalProperties, properties (+31 more)

### Community 10 - "biome.json"
Cohesion: 0.14
Nodes (13): formatter, indentStyle, indentWidth, lineWidth, quoteStyle, javascript, formatter, linter (+5 more)

### Community 11 - "scripts"
Cohesion: 0.11
Nodes (18): scripts, benchmark, build, check, check:ci, cli, contracts, coverage (+10 more)

### Community 12 - "FakeCore"
Cohesion: 0.21
Nodes (6): TranscriptionFrame, BrainTest, send(), FakeCore, Brain, transcript()

### Community 13 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, customConditions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir (+5 more)

### Community 14 - "desktop/package.json"
Cohesion: 0.12
Nodes (14): dependencies, @pipecat-ai/client-js, @pipecat-ai/small-webrtc-transport, description, @types/node, typescript, main, name (+6 more)

### Community 15 - "properties"
Cohesion: 0.18
Nodes (11): anyOf, type, properties, causationId, idempotencyKey, protocolVersion, schemaVersion, const (+3 more)

### Community 16 - "README.md"
Cohesion: 0.22
Nodes (7): ADR 0015: A learning brain and a layered intent pipeline, Consequences, Context, Decision, Data recovery, Recovery and operations, Threat model

### Community 17 - "task.schema.json"
Cohesion: 0.22
Nodes (8): type, additionalProperties, $defs, __schema0, required, $schema, anyOf, type

### Community 18 - "dependencies"
Cohesion: 0.17
Nodes (13): default, items, maxItems, type, format, pattern, type, dependencies (+5 more)

### Community 19 - "2. MANDATORY CURRENT-DOCUMENTATION RESEARCH"
Cohesion: 0.25
Nodes (8): 2. MANDATORY CURRENT-DOCUMENTATION RESEARCH, Browser Use, Claude, Codex, Gemini, n8n, OpenClaw, Research Requirements

### Community 20 - "Subscription providers and local OpenClaw — design"
Cohesion: 0.17
Nodes (11): ClaudeCodeExecutor (new, `src/integrations/claude-code.ts`), Codex subscription mode (existing `CodexExecutor`), Components, Constraints from primary sources, Deployment, Intent, Open item resolved during implementation, OpenClaw and Gemini (+3 more)

### Community 21 - "envelope.schema.json"
Cohesion: 0.25
Nodes (7): additionalProperties, $defs, __schema0, required, $schema, anyOf, type

### Community 22 - "properties"
Cohesion: 0.08
Nodes (24): enum, type, enum, type, format, pattern, type, format (+16 more)

### Community 23 - "objective"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, objective

### Community 24 - "17. TESTING AND CODE-LEVEL GUARANTEES"
Cohesion: 0.29
Nodes (7): 17. TESTING AND CODE-LEVEL GUARANTEES, End-to-End Tests, Failure Injection, Integration Tests, Property-Based Tests, Security Tests, Unit Tests

### Community 25 - "1. NON-NEGOTIABLE ENGINEERING PRINCIPLES"
Cohesion: 0.29
Nodes (7): 1.1 Correctness Before Features, 1.2 Explicit Responsibility Ownership, 1.3 Deterministic Control, Probabilistic Intelligence, 1.4 Fail Closed When Necessary, 1.5 No False Guarantees, 1.6 Progressive Extensibility, 1. NON-NEGOTIABLE ENGINEERING PRINCIPLES

### Community 26 - "dependencies"
Cohesion: 0.14
Nodes (14): dependencies, @anthropic-ai/sdk, fastify, @google/genai, @jarvis/action-engine, @jarvis/brain, @jarvis/integration-hub, @openai/codex-sdk (+6 more)

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
Cohesion: 0.29
Nodes (6): compilerOptions, customConditions, rootDir, extends, include, ./tsconfig.json

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

### Community 38 - "Review Focus"
Cohesion: 0.20
Nodes (9): Global Constraints, Implementation status — 2026-10-17, Review Focus, Subscription Providers and Local OpenClaw Implementation Plan, Task 1: ClaudeCodeExecutor, Task 2: Configuration for Claude Code and Codex ChatGPT mode, Task 3: Host setup — Node 24.22.0 and OpenClaw Gateway, Task 4: Logins and live verification (+1 more)

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

### Community 50 - "telemetry.ts"
Cohesion: 0.27
Nodes (5): @opentelemetry/api, @opentelemetry/sdk-trace-base, @opentelemetry/sdk-trace-node, initTracing(), JsonSpanExporter

### Community 51 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, @biomejs/biome, @electric-sql/pglite, fast-check, tsx, @types/node, @types/pg, typescript (+2 more)

### Community 52 - "ADR 0008 — Subscription CLI harnesses on native Windows"
Cohesion: 0.50
Nodes (3): ADR 0008 — Subscription CLI harnesses on native Windows, Alternatives, Consequences and implementation rulings

### Community 53 - "action-engine/src/types.ts"
Cohesion: 0.22
Nodes (10): ActionDef, done, narrate(), NarrationEvent, Pair, Kind, Lang, Risk (+2 more)

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

### Community 64 - "TaskService"
Cohesion: 0.08
Nodes (21): ContextStore, insertContext(), ContextEntrySchema, fingerprint(), invariant(), taskDeadline(), TaskState, Sql (+13 more)

### Community 65 - "contracts.ts"
Cohesion: 0.08
Nodes (22): attemptedStatuses, BrowserPageSchema, CapabilitySchema, EnvelopeSchema, EventType, EventTypeSchema, OutcomeSchema, ResultSchema (+14 more)

### Community 66 - "services.ts"
Cohesion: 0.12
Nodes (13): BrowserInputSchema, CoreError, WorkflowInputSchema, serviceUrl(), BrowserExecutor, browserPages(), N8nClient, OpenClawExecutor (+5 more)

### Community 68 - "JARVIS desktop design"
Cohesion: 0.10
Nodes (17): JARVIS desktop design, Layout and motion, Source, Tokens, Type, shape and icons, JARVIS desktop (M1, M3 plan cards), Run on this Windows checkout, Use (+9 more)

### Community 69 - "ProviderRegistry"
Cohesion: 0.12
Nodes (15): Progress, Budget, Observation, ProviderRegistry, Lane, Worker, model(), provider() (+7 more)

### Community 70 - "run.ts"
Cohesion: 0.14
Nodes (21): Args, bad(), bindings, bringToFront(), Evidence, exists(), failed(), frontTitle() (+13 more)

### Community 71 - "plans.test.ts"
Cohesion: 0.14
Nodes (18): claude(), close, desktop(), gemini(), headlines, Input, news, newsFeed() (+10 more)

### Community 72 - "SpeakerGate"
Cohesion: 0.12
Nodes (10): Vector, Path, embed(), Path, Operator voice print: a conversation filter, not a security boundary., ECAPA embedding of 16-bit mono PCM., SpeakerGate, _unit() (+2 more)

### Community 73 - "JARVIS voice desktop experience — design"
Cohesion: 0.10
Nodes (19): Architecture, Character, Constraints and evidence, Core changes, Desktop application (`apps/desktop`, Electron, TypeScript), Intent, JARVIS voice desktop experience — design, M2 Memory (interface) (+11 more)

### Community 74 - "config.ts"
Cohesion: 0.11
Nodes (19): ids, Config, configuredProviders(), containedPath(), EnvSecrets, n8nMcpConfig(), openClawMcpConfig(), playwrightMcpConfig() (+11 more)

### Community 75 - "Microphone"
Cohesion: 0.10
Nodes (8): connect(), CONSTRAINTS, Link, Microphone, @pipecat-ai/client-js, @pipecat-ai/small-webrtc-transport, Options, sdk

### Community 76 - "Review Focus"
Cohesion: 0.11
Nodes (17): Global Constraints, Intent and Action Engine (M3 cycle 1) Implementation Plan, Review Focus, Task 10: Conversation routing, endpoints and SSE, Task 11: Voice announcements, Task 12: Desktop HUD — cards, panels, control indicator, Task 13: Eval, live verification and documentation, Task 14: Independent review (+9 more)

### Community 77 - "JARVIS intent and action engine (M3, cycle 1) — design"
Cohesion: 0.11
Nodes (17): Architecture, Catalog (cycle 1), Compilation, plans and approval, Core (host), Display panels and UI, Evidence (checked 2026-10-18), Execution, verification and replanning, Intent (+9 more)

### Community 78 - "McpToolPort"
Cohesion: 0.16
Nodes (7): inherited, McpOptions, McpToolPort, ToolPort, ToolResult, server, @modelcontextprotocol/client

### Community 79 - "news.ts"
Cohesion: 0.15
Nodes (15): blocked, bounded(), capped(), editions, fetchNews(), named, NewsArgs, NewsContext (+7 more)

### Community 80 - "main/main.ts"
Cohesion: 0.11
Nodes (14): readOperatorEnv(), broadcast(), plans, receivePlan(), setListening(), streamStop, updateTray(), streamPlans() (+6 more)

### Community 81 - "app.ts"
Cohesion: 0.11
Nodes (34): caption, fail(), notice, NOTICES, presence, receive(), relay(), restart() (+26 more)

### Community 82 - "Presence"
Cohesion: 0.20
Nodes (7): KEYS, Look, LOOKS, Presence, rgb(), UNIFORMS, State

### Community 83 - "action-engine/package.json"
Cohesion: 0.14
Nodes (13): description, devDependencies, @modelcontextprotocol/server, exports, zod, name, private, scripts (+5 more)

### Community 84 - "run.test.ts"
Cohesion: 0.13
Nodes (12): text(), CompiledStep, behind, Call, closed, dialog, notepad, notepadText (+4 more)

### Community 85 - "jarvis-services.ps1"
Cohesion: 0.22
Nodes (27): Assert-OpenClawNative(), Command-Exists(), Compose(), Compose-Running(), Die(), Do-Stop(), Enabled(), Ensure-Dirs() (+19 more)

### Community 86 - "permissions.ts"
Cohesion: 0.14
Nodes (10): defaultMode(), defaults, Grant, maxGrantMs, PermissionChange, PermissionChangeSchema, PermissionService, Preset (+2 more)

### Community 87 - "Review Focus"
Cohesion: 0.12
Nodes (15): Global Constraints, JARVIS Voice Desktop M1 Implementation Plan, Review Focus, Task 10: Presence, stage, captions, overlay and settings, Task 11: End-to-end voice turn, Task 12: Documentation and final verification, Task 1: Contract additions: `personal` privacy, `non-empty` verification, listed provider order, Task 2: Trusted providers for private data (+7 more)

### Community 88 - "Task"
Cohesion: 0.19
Nodes (12): ExecutionResult, Task, ProviderFailure, failure(), failure(), jsonRequest(), networkCode(), neverDispatched() (+4 more)

### Community 89 - "Enrollment"
Cohesion: 0.12
Nodes (7): Application, Enrollment, Voice-print enrollment state: collected in memory, saved only as a normalized…, create_app(), main(), Enrollment, Authenticated loopback signalling and enrollment for one operator desktop.

### Community 90 - "Turn"
Cohesion: 0.12
Nodes (9): AsyncBaseTransport, Protocol, Core, Addressed speech goes through Core. A newer turn supersedes an unfinished…, CoreClient, Client for Core's conversation endpoint. Failures become None so JARVIS can…, Turn, CoreClientTest (+1 more)

### Community 91 - "guards.ts"
Cohesion: 0.17
Nodes (17): blockedApp(), blockedShortcut(), containedPath(), distance(), escapeTitles, GuardError, inside(), keyAliases (+9 more)

### Community 92 - "claude-code.test.ts"
Cohesion: 0.21
Nodes (9): ClaudeAgentOptions, claudeCodeEnvKeys, ClaudeCodeExecutor, Output, dir, fixture, flags, run() (+1 more)

### Community 93 - "snapshot.ts"
Cohesion: 0.23
Nodes (11): secretNote(), describePrompt(), elements(), parseSnapshot(), redactSecrets(), screenSummary(), secrets, section() (+3 more)

### Community 94 - "settings"
Cohesion: 0.23
Nodes (9): message(), Mode, NOTES, PHRASES, settings(), action(), progress(), refresh() (+1 more)

### Community 95 - "FollowUpWindow"
Cohesion: 0.20
Nodes (6): FollowUpWindow, is_named(), Decides whether speech is meant for JARVIS: its name, or the follow-up window…, Any, FollowUpWindowTest, IsNamedTest

### Community 96 - "eval-intents.ts"
Cohesion: 0.29
Nodes (7): evaluate(), integrations, paceMs, percentile(), registered, rows, { values }

### Community 97 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, customConditions, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+3 more)

### Community 98 - "news.test.ts"
Cohesion: 0.18
Nodes (4): briefPrompt(), NewsItem, readBrief(), png

### Community 99 - "integration-hub/src/index.ts"
Cohesion: 0.16
Nodes (12): agent, browser, browserMany, claudeAgent, createIntegrationHub(), exactUrl(), HubTask, IntegrationError (+4 more)

### Community 100 - "integration-hub/package.json"
Cohesion: 0.17
Nodes (11): dependencies, zod, description, exports, zod, name, private, scripts (+3 more)

### Community 101 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+2 more)

### Community 102 - "hud.ts"
Cohesion: 0.36
Nodes (10): hud(), button(), render(), update(), liveText(), node(), Progress, seconds() (+2 more)

### Community 103 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, customConditions, declaration, outDir, rootDir, extends, include, ../../tsconfig.json

### Community 104 - "shared.ts"
Cohesion: 0.07
Nodes (8): bridge, BrainView, Bridge, Enrollment, MemoryNote, Window, electron, PermissionView

### Community 105 - "BilingualTTS"
Cohesion: 0.21
Nodes (6): TTSService, BilingualTTS, Frame, FrameDirection, Two local Piper voices, selected from Core's validated reply language., The first synthesis of each voice is slow; do it before JARVIS first speaks.

### Community 107 - "Research and compatibility — 2026-10-17"
Cohesion: 0.25
Nodes (8): Browser Use, Claude, Codex, Evidence boundaries, Gemini, n8n, OpenClaw, Research and compatibility — 2026-10-17

### Community 108 - "JARVIS Core"
Cohesion: 0.22
Nodes (9): Configuration, Control API, Developer commands, Documentation, JARVIS Core, Layout, Native subscription mode (Windows), One-command Windows background startup (+1 more)

### Community 109 - "Action engine evidence (M3, cycle 1)"
Cohesion: 0.33
Nodes (6): Action engine evidence (M3, cycle 1), Automated verification, Follow-up (2026-10-18, branch `feature/jarvis-latest-v2`), Intent eval, Known gaps, Live checks

### Community 110 - "GatedSTT"
Cohesion: 0.21
Nodes (7): VADUserStoppedSpeakingFrame, WhisperSTTService, GatedSTT, run(), Frame, FrameDirection, Pay first-use costs (CUDA kernels, the speaker model) before the operator…

### Community 111 - "run_session"
Cohesion: 0.27
Nodes (10): handle_offer(), finished(), session(), set_brain(), offer(), Any, Brain, run_session() (+2 more)

### Community 112 - "Integration setup"
Cohesion: 0.15
Nodes (13): Browser Use, Claude and Gemini APIs, Claude Code subscription, Codex SDK, Integration setup, Learning brain, Live progress from the browser worker, Long-term memory (+5 more)

### Community 113 - "core.ts"
Cohesion: 0.15
Nodes (14): ConfigSchema, Core, CoreOptions, createCore(), terminal, postgres(), loadObservations(), purgeObservations() (+6 more)

### Community 114 - "smoke.py"
Cohesion: 0.48
Nodes (6): gpu_used_mib(), main(), Any, GPU smoke test: CUDA, Piper TTS voices, faster-whisper STT and ECAPA speaker…, report(), timed()

### Community 115 - "textOf"
Cohesion: 0.53
Nodes (6): attr(), decode(), first(), imageUrl(), parseFeed(), textOf()

### Community 116 - "JARVIS Core architecture"
Cohesion: 0.22
Nodes (9): Code organization, Event-driven coordination, Event families, Execution and failure classification, JARVIS Core architecture, Model-proposed plans (M3), Not enabled, Risk and approval (+1 more)

### Community 117 - "dependencies"
Cohesion: 0.50
Nodes (4): dependencies, fast-xml-parser, @modelcontextprotocol/client, zod

### Community 118 - "services/conversation.ts"
Cohesion: 0.10
Nodes (16): detect(), DisplayBlock, DisplayBlockSchema, onScreen, parseReply(), Reply, TurnRecord, TurnResult (+8 more)

### Community 119 - "catalog.ts"
Cohesion: 0.10
Nodes (29): catalog, catalogLines(), compile(), content, definitions, files, JsonProperty, limit (+21 more)

### Community 120 - "github.ts"
Cohesion: 0.11
Nodes (16): evidence(), File, githubActionSchemas, GitHubExecutor, inherited, Issue, issueNumber, limit (+8 more)

### Community 121 - "interactive-browser.ts"
Cohesion: 0.14
Nodes (10): Element, elements(), interactiveBrowserActionSchemas, InteractiveBrowserExecutor, InteractiveBrowserPort, interactiveBrowserTools, label, result() (+2 more)

### Community 122 - "risk"
Cohesion: 0.50
Nodes (4): risk, default, enum, type

### Community 123 - "ADR 0010: Models propose typed plans; a compiler and the operator admit them"
Cohesion: 0.50
Nodes (4): ADR 0010: Models propose typed plans; a compiler and the operator admit them, Consequences, Context, Decision

### Community 124 - "harness.ts"
Cohesion: 0.12
Nodes (22): fixture, plan(), planOf(), read(), settled(), body(), boot(), database() (+14 more)

### Community 129 - "Voice integration hub"
Cohesion: 0.50
Nodes (3): Interactive browser automation via Claude, Native Windows setup, Voice integration hub

### Community 132 - "controls.ts"
Cohesion: 0.22
Nodes (17): controls(), guarded(), loadBrain(), loadMemories(), loadPermissions(), renderPermissions(), select(), GROUPS (+9 more)

### Community 133 - "live.ts"
Cohesion: 0.21
Nodes (14): capitalize(), doing(), hostOf(), hostsOf(), LiveEvent, LiveStep, mainStep(), narrateLive() (+6 more)

### Community 135 - "brain.ts"
Cohesion: 0.23
Nodes (12): BrainOptions, Doc, BrainStats, Consolidation, Embedder, IntentRecord, Lang, Outcome (+4 more)

### Community 136 - "Brain"
Cohesion: 0.35
Nodes (3): Brain, signature(), Skill

### Community 137 - "Review Focus"
Cohesion: 0.13
Nodes (14): Deferred linkage, Global Constraints, JARVIS v1 End-to-End Matrix Implementation Plan, Review Focus, Task 10: Matrix verification and evidence closure, Task 1: Reviewable matrix inventory and generator, Task 2: Platform and database CI matrix, Task 3: Provider topology and integration flags (+6 more)

### Community 138 - "Brain"
Cohesion: 0.24
Nodes (7): FrameProcessor, Announcement, Brain, later(), Frame, FrameDirection, Queue what Core announced; it is spoken at the next natural gap.

### Community 139 - "fake-windows-mcp.ts"
Cohesion: 0.17
Nodes (10): server, @modelcontextprotocol/server, anything, calls, launchable, row(), server, snapshot() (+2 more)

### Community 140 - "hud.spec.ts"
Cohesion: 0.22
Nodes (10): coreSecret, emit(), launch(), calls, plan, server, shots, shots (+2 more)

### Community 141 - "brain/package.json"
Cohesion: 0.17
Nodes (11): dependencies, minisearch, description, exports, name, private, scripts, build (+3 more)

### Community 142 - "brain.test.ts"
Cohesion: 0.24
Nodes (8): contextDependent(), deictic, filler, normalize(), utteranceKey(), notepad, setup(), spotify

### Community 143 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 144 - "server.ts"
Cohesion: 0.12
Nodes (11): fastify, HttpContext, ServerOptions, TaskId, conversationRoutes(), healthRoutes(), settingsRoutes(), buildServer() (+3 more)

### Community 145 - "settings.spec.ts"
Cohesion: 0.20
Nodes (8): Action, calls, json(), memories, server, shots, skills, view

### Community 147 - ".brain"
Cohesion: 0.29
Nodes (4): DuplexTest, turn(), Any, JARVIS talks between the operator's turns and never over them.

### Community 148 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, electron, esbuild, @fontsource-variable/eb-garamond, @fontsource-variable/inter, @phosphor-icons/core, @playwright/test, @types/node (+1 more)

### Community 150 - "JARVIS v1.0.0 release progress"
Cohesion: 0.18
Nodes (10): Baseline gate table, Checkpoint C1, Configuration smoke matrix (2026-10-20), Disabled-action admission regression (2026-10-20), Gate 0 fixes, JARVIS v1.0.0 release progress, Latest local verification (2026-10-20), Phase 1 execution decisions (+2 more)

### Community 151 - "architecture.test.ts"
Cohesion: 0.33
Nodes (4): allowed, files(), packages, root

### Community 153 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, start, test, typecheck

### Community 155 - "condition"
Cohesion: 0.13
Nodes (15): additionalProperties, properties, required, type, maxLength, minLength, type, format (+7 more)

### Community 156 - "JARVIS voice service"
Cohesion: 0.40
Nodes (4): Decisions and measurements (2026-10-17, RTX 5070 Laptop 8 GB, torch 2.11.0+cu128), JARVIS voice service, Runtime, Setup

### Community 157 - "ADR 0011: Measured adaptive routing, durable circuits and usage budgets"
Cohesion: 0.50
Nodes (4): ADR 0011: Measured adaptive routing, durable circuits and usage budgets, Consequences, Context, Decision

### Community 158 - "ADR 0012: Operator-approved long-term memory"
Cohesion: 0.50
Nodes (4): ADR 0012: Operator-approved long-term memory, Consequences, Context, Decision

### Community 159 - "ADR 0013: n8n task outcomes through a transactional outbox"
Cohesion: 0.50
Nodes (4): ADR 0013: n8n task outcomes through a transactional outbox, Consequences, Context, Decision

### Community 160 - "ADR 0014: Operator-managed standing permissions"
Cohesion: 0.50
Nodes (4): ADR 0014: Operator-managed standing permissions, Consequences, Context, Decision

### Community 161 - "memory.ts"
Cohesion: 0.26
Nodes (6): failed(), maxMemories, Memory, MemoryExecutor, refused(), seen()

### Community 162 - "ADR 0016: Duplex conversation and live progress"
Cohesion: 0.50
Nodes (4): ADR 0016: Duplex conversation and live progress, Consequences, Context, Decision

### Community 163 - "ADR 0017: Layered modules, a composition root and end-to-end verification"
Cohesion: 0.50
Nodes (4): ADR 0017: Layered modules, a composition root and end-to-end verification, Consequences, Context, Decision

### Community 164 - "cachePrefix"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, cachePrefix

### Community 166 - "models.ts"
Cohesion: 0.17
Nodes (15): @anthropic-ai/sdk, @google/genai, ClaudeEffort, ClaudeExecutor, CodexAuth, conversationalItems, GeminiExecutor, refusalFallbackModels (+7 more)

### Community 168 - "persona.ts"
Cohesion: 0.33
Nodes (10): clip(), ConversationInput, conversationPrompt(), conversationPromptParts(), minutes(), progressLine(), seconds(), stablePart() (+2 more)

### Community 169 - "normalize"
Cohesion: 0.11
Nodes (22): appNames(), groups, spoken, ground(), Grounding, normalize(), UiElement, escapeTarget() (+14 more)

### Community 170 - "reliability.ts"
Cohesion: 0.19
Nodes (8): Capability, Health, minLatencySamples, minReliabilitySamples, percentile(), ReliabilityTracker, Usage, wilsonUpper()

### Community 171 - "Claude Code agent: extensible JARVIS execution"
Cohesion: 0.33
Nodes (5): Architecture and evidence, Claude Code agent: extensible JARVIS execution, Local verification, Official OpenClaw and n8n MCP connectors, Opt in

### Community 172 - "Windows native JARVIS service manager"
Cohesion: 0.33
Nodes (5): Desktop says "Ayar dosyası bulunamadı", Diagnostic codes, Existing .env values are preserved, Service lifecycle, Windows native JARVIS service manager

### Community 174 - "routing.ts"
Cohesion: 0.22
Nodes (6): Executor, outageKinds, SelectionReason, DesktopExecutor, NewsExecutor, step()

### Community 176 - "JARVIS216 local Windows E2E report"
Cohesion: 0.15
Nodes (12): Actual outputs and sanitized traces, Authenticated GitHub evidence and the Codex host distinction, Codex and OpenClaw, Defect fixed and validation, JARVIS216 local Windows E2E report, Local registration and filesystem, Multi-step autonomy and permission controls, PASS / FAIL / BLOCKED matrix (+4 more)

### Community 177 - "ServerTest"
Cohesion: 0.12
Nodes (3): ServerTest, session(), session()

### Community 178 - "generate.ts"
Cohesion: 0.43
Nodes (6): durations, generateCases(), guarded, pairwise(), permissionPolicies(), presets

### Community 179 - "JARVIS216 architecture audit — 2026-10-21"
Cohesion: 0.33
Nodes (5): Evidence limits and pending gates, Existing execution authority, Findings and implementation boundary, JARVIS216 architecture audit — 2026-10-21, Scope and preservation

### Community 180 - "JARVIS216 autonomous-agent hardening design"
Cohesion: 0.40
Nodes (4): Acceptance and release, Architecture and trust boundary, JARVIS216 autonomous-agent hardening design, Non-goals and limits

### Community 181 - "maxOutputTokens"
Cohesion: 0.40
Nodes (5): default, maximum, minimum, type, maxOutputTokens

### Community 182 - "typed-github.mjs"
Cohesion: 0.40
Nodes (4): issue, [mode, record, ...argv], repo, result

### Community 183 - "Autonomous-agent hardening implementation plan"
Cohesion: 0.50
Nodes (3): Autonomous-agent hardening implementation plan, Gates and ownership, Ledger

### Community 184 - "privacy"
Cohesion: 0.50
Nodes (4): default, enum, type, privacy

## Knowledge Gaps
- **893 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+888 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1196 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `vitest` to `ConversationService`, `package.json`, `PlanService`, `live.ts`, `brain.test.ts`, `server.ts`, `architecture.test.ts`, `models.ts`, `normalize`, `routing.ts`, `generate.ts`, `telemetry.ts`, `action-engine/src/types.ts`, `contracts.ts`, `services.ts`, `ProviderRegistry`, `plans.test.ts`, `config.ts`, `Microphone`, `McpToolPort`, `run.test.ts`, `guards.ts`, `claude-code.test.ts`, `snapshot.ts`, `news.test.ts`, `integration-hub/src/index.ts`, `core.ts`, `services/conversation.ts`, `catalog.ts`, `github.ts`, `interactive-browser.ts`, `harness.ts`?**
  _High betweenness centrality (0.166) - this node is a cross-community bridge._
- **Why does `PlanView` connect `PlanService` to `TaskService`, `ConversationService`, `ProviderRegistry`, `hud.ts`, `plans.test.ts`, `shared.ts`, `hud.spec.ts`, `main/main.ts`, `server.ts`, `services/conversation.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `PlanService` connect `PlanService` to `vitest`, `ConversationService`, `TaskService`, `ProviderRegistry`, `plans.test.ts`, `server.ts`, `core.ts`, `services/conversation.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _893 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `vitest` be split into smaller, more focused modules?**
  _Cohesion score 0.09230769230769231 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Request` be split into smaller, more focused modules?**
  _Cohesion score 0.05794556628621598 - nodes in this community are weakly interconnected._