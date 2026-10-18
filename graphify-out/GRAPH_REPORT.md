# Graph Report - jarvis216  (2026-10-18)

## Corpus Check
- 164 files · ~94,611 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 5, .xml 2, .lock 2)

## Summary
- 1483 nodes · 2743 edges · 129 communities (113 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 113 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `049913be`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- contracts.ts
- TaskService
- package.json
- BoundaryTests
- Executor
- budget
- MASTER_DIRECTIVE.md
- Engineering report — JARVIS Core foundation
- items
- result.schema.json
- biome.json
- scripts
- Brain
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
- catalog.ts
- 6. DECISION ENGINE AND MODEL ROUTING
- recipient
- sender
- type
- jarvis-browser-worker
- parentId
- vitest
- PlanService
- fake-claude.mjs
- JARVIS desktop design
- routing.ts
- run.ts
- plans.test.ts
- SpeakerGate
- JARVIS voice desktop experience — design
- config.ts
- Microphone
- Review Focus
- JARVIS intent and action engine (M3, cycle 1) — design
- mcp.ts
- news.ts
- shared.ts
- app.ts
- Presence
- action-engine/package.json
- run.test.ts
- models.ts
- ui.ts
- Review Focus
- Task
- Enrollment
- main/main.ts
- guards.ts
- normalize
- snapshot.ts
- settings
- claude-code.test.ts
- ServerTest
- compilerOptions
- news.test.ts
- plans.ts
- create_app
- TaskSpecSchema
- openai-compatible.test.ts
- compilerOptions
- plan-gateway.test.ts
- BilingualTTS
- FakeConnection
- Research and compatibility — 2026-10-17
- JARVIS Core
- subscription-config.test.ts
- GatedSTT
- run_session
- Integration setup
- narrate.ts
- smoke.py
- textOf
- JARVIS Core architecture
- dependencies
- context
- expiresAt
- planId
- providerOrder
- risk
- hardening.test.ts
- 5. Integration paths
- assets.d.ts
- jarvis-voice

## God Nodes (most connected - your core abstractions)
1. `TaskService` - 53 edges
2. `Task` - 45 edges
3. `vitest` - 37 edges
4. `invariant()` - 31 edges
5. `ProviderFailure` - 30 edges
6. `Executor` - 28 edges
7. `PlanService` - 28 edges
8. `buildServer()` - 24 edges
9. `Brain` - 23 edges
10. `configuredProviders()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `service()` --calls--> `PlanService`  [EXTRACTED]
  tests/plans.test.ts → src/plans.ts
- `runWorker()` --calls--> `ProviderRegistry`  [EXTRACTED]
  tests/plans.test.ts → src/routing.ts
- `runWorker()` --calls--> `Worker`  [EXTRACTED]
  tests/plans.test.ts → src/worker.ts
- `memoryDatabase()` --calls--> `migrate()`  [EXTRACTED]
  tests/fixtures/pglite.ts → src/database.ts
- `runApproved()` --calls--> `ActionGateway`  [EXTRACTED]
  tests/hardening.test.ts → src/gateway.ts

## Import Cycles
- None detected.

## Communities (129 total, 9 thin omitted)

### Community 0 - "contracts.ts"
Cohesion: 0.12
Nodes (21): Action, attemptedStatuses, canTransition(), Capability, CapabilitySchema, ContextEntrySchema, EventType, EventTypeSchema (+13 more)

### Community 1 - "TaskService"
Cohesion: 0.09
Nodes (21): ContextStore, insertContext(), invariant(), taskDeadline(), ConversationService, detect(), DisplayBlock, DisplayBlockSchema (+13 more)

### Community 2 - "package.json"
Cohesion: 0.12
Nodes (16): engines, node, @types/node, typescript, zod, name, private, type (+8 more)

### Community 3 - "BoundaryTests"
Cohesion: 0.16
Nodes (13): Exception, Explicit opt-in public-page smoke test; no credentials, accounts or shared…, BoundaryTests, authorize(), encode(), extract(), main(), do_GET() (+5 more)

### Community 4 - "Executor"
Cohesion: 0.11
Nodes (12): BrowserInputSchema, Executor, WorkflowInputSchema, DesktopExecutor, NewsExecutor, serviceUrl(), BrowserExecutor, N8nClient (+4 more)

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
Cohesion: 0.17
Nodes (12): items, additionalProperties, properties, required, source, text, maxLength, minLength (+4 more)

### Community 9 - "result.schema.json"
Cohesion: 0.12
Nodes (16): additionalProperties, maxLength, type, properties, externalId, source, text, required (+8 more)

### Community 10 - "biome.json"
Cohesion: 0.14
Nodes (13): formatter, indentStyle, indentWidth, lineWidth, quoteStyle, javascript, formatter, linter (+5 more)

### Community 11 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, benchmark, build, check, cli, contracts, dev, format (+5 more)

### Community 12 - "Brain"
Cohesion: 0.06
Nodes (23): AsyncBaseTransport, FrameProcessor, Protocol, TranscriptionFrame, FollowUpWindow, is_named(), Decides whether speech is meant for JARVIS: its name, or the follow-up window…, Brain (+15 more)

### Community 13 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, customConditions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir (+5 more)

### Community 14 - "desktop/package.json"
Cohesion: 0.05
Nodes (35): dependencies, @pipecat-ai/client-js, @pipecat-ai/small-webrtc-transport, description, devDependencies, electron, esbuild, @fontsource-variable/eb-garamond (+27 more)

### Community 15 - "properties"
Cohesion: 0.18
Nodes (11): anyOf, type, properties, causationId, idempotencyKey, protocolVersion, schemaVersion, const (+3 more)

### Community 16 - "README.md"
Cohesion: 0.31
Nodes (3): Data recovery, Recovery and operations, Threat model

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
Cohesion: 0.20
Nodes (10): enum, type, default, enum, type, properties, capability, privacy (+2 more)

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
Cohesion: 0.18
Nodes (11): dependencies, @anthropic-ai/sdk, fastify, @google/genai, @jarvis/action-engine, @openai/codex-sdk, @opentelemetry/api, @opentelemetry/sdk-trace-base (+3 more)

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
Cohesion: 0.22
Nodes (9): devDependencies, @biomejs/biome, @electric-sql/pglite, fast-check, tsx, @types/node, @types/pg, typescript (+1 more)

### Community 52 - "ADR 0008 — Subscription CLI harnesses on native Windows"
Cohesion: 0.50
Nodes (3): ADR 0008 — Subscription CLI harnesses on native Windows, Alternatives, Consequences and implementation rulings

### Community 53 - "catalog.ts"
Cohesion: 0.13
Nodes (22): ActionDef, catalog, catalogLines(), definitions, files, JsonProperty, path, signature() (+14 more)

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

### Community 64 - "parentId"
Cohesion: 0.50
Nodes (4): format, pattern, type, parentId

### Community 65 - "vitest"
Cohesion: 0.17
Nodes (9): @electric-sql/pglite, pg, vitest, Database, migrate(), postgres(), auth, memoryDatabase() (+1 more)

### Community 68 - "JARVIS desktop design"
Cohesion: 0.08
Nodes (21): JARVIS desktop design, Layout and motion, Source, Tokens, Type, shape and icons, JARVIS desktop (M1), Run on this Windows checkout, Use (+13 more)

### Community 69 - "routing.ts"
Cohesion: 0.15
Nodes (10): CoreError, states, ActionGateway, outageKinds, Provider, ProviderRegistry, TaskId, Worker (+2 more)

### Community 70 - "run.ts"
Cohesion: 0.14
Nodes (20): Args, bad(), bindings, bringToFront(), Evidence, exists(), failed(), frontTitle() (+12 more)

### Community 71 - "plans.test.ts"
Cohesion: 0.14
Nodes (19): claude(), close, desktop(), gemini(), headlines, Input, news, newsFeed() (+11 more)

### Community 72 - "SpeakerGate"
Cohesion: 0.15
Nodes (8): Vector, embed(), Path, Operator voice print: a conversation filter, not a security boundary., ECAPA embedding of 16-bit mono PCM., SpeakerGate, _unit(), SpeakerGateTest

### Community 73 - "JARVIS voice desktop experience — design"
Cohesion: 0.10
Nodes (19): Architecture, Character, Constraints and evidence, Core changes, Desktop application (`apps/desktop`, Electron, TypeScript), Intent, JARVIS voice desktop experience — design, M2 Memory (interface) (+11 more)

### Community 74 - "config.ts"
Cohesion: 0.22
Nodes (9): @google/genai, ids, ConfigSchema, configuredProviders(), conversationProviders(), main(), containedPath(), EnvSecrets (+1 more)

### Community 75 - "Microphone"
Cohesion: 0.16
Nodes (6): connect(), CONSTRAINTS, Link, Microphone, @pipecat-ai/client-js, @pipecat-ai/small-webrtc-transport

### Community 76 - "Review Focus"
Cohesion: 0.11
Nodes (17): Global Constraints, Intent and Action Engine (M3 cycle 1) Implementation Plan, Review Focus, Task 10: Conversation routing, endpoints and SSE, Task 11: Voice announcements, Task 12: Desktop HUD — cards, panels, control indicator, Task 13: Eval, live verification and documentation, Task 14: Independent review (+9 more)

### Community 77 - "JARVIS intent and action engine (M3, cycle 1) — design"
Cohesion: 0.11
Nodes (17): Architecture, Catalog (cycle 1), Compilation, plans and approval, Core (host), Display panels and UI, Evidence (checked 2026-10-18), Execution, verification and replanning, Intent (+9 more)

### Community 78 - "mcp.ts"
Cohesion: 0.16
Nodes (7): inherited, McpOptions, McpToolPort, ToolPort, ToolResult, server, @modelcontextprotocol/client

### Community 79 - "news.ts"
Cohesion: 0.16
Nodes (15): blocked, bounded(), capped(), editions, fetchNews(), named, NewsArgs, NewsContext (+7 more)

### Community 80 - "shared.ts"
Cohesion: 0.13
Nodes (5): bridge, Bridge, Enrollment, UiEvent, Window

### Community 81 - "app.ts"
Cohesion: 0.25
Nodes (16): caption, fail(), notice, NOTICES, presence, receive(), relay(), setListening() (+8 more)

### Community 82 - "Presence"
Cohesion: 0.20
Nodes (7): KEYS, Look, LOOKS, Presence, rgb(), UNIFORMS, State

### Community 83 - "action-engine/package.json"
Cohesion: 0.12
Nodes (15): description, devDependencies, @modelcontextprotocol/server, exports, zod, name, private, scripts (+7 more)

### Community 84 - "run.test.ts"
Cohesion: 0.13
Nodes (13): compile(), runStep(), behind, Call, closed, dialog, notepad, notepadText (+5 more)

### Community 85 - "models.ts"
Cohesion: 0.19
Nodes (9): @anthropic-ai/sdk, networkCode(), neverDispatched(), notConnected, classify(), ClaudeExecutor, CodexAuth, GeminiExecutor (+1 more)

### Community 86 - "ui.ts"
Cohesion: 0.17
Nodes (14): caption, presence, show, captions(), IconName, ICONS, reducedMotion, render() (+6 more)

### Community 87 - "Review Focus"
Cohesion: 0.12
Nodes (15): Global Constraints, JARVIS Voice Desktop M1 Implementation Plan, Review Focus, Task 10: Presence, stage, captions, overlay and settings, Task 11: End-to-end voice turn, Task 12: Documentation and final verification, Task 1: Contract additions: `personal` privacy, `non-empty` verification, listed provider order, Task 2: Trusted providers for private data (+7 more)

### Community 88 - "Task"
Cohesion: 0.28
Nodes (6): ExecutionResult, Task, step(), failure(), jsonRequest(), ProviderFailure

### Community 89 - "Enrollment"
Cohesion: 0.18
Nodes (6): Enrollment, main(), Authenticated loopback signalling and enrollment for one operator desktop., Enrollment, Path, Local STT after semantic end-of-turn and speaker verification. No audio is…

### Community 90 - "main/main.ts"
Cohesion: 0.20
Nodes (7): readOperatorEnv(), broadcast(), setListening(), updateTray(), startVoiceService(), Voice, electron

### Community 91 - "guards.ts"
Cohesion: 0.23
Nodes (11): blockedShortcut(), containedPath(), escapeTarget(), escapeTitles, GuardError, keyAliases, realNearest(), shellProcesses (+3 more)

### Community 92 - "normalize"
Cohesion: 0.28
Nodes (8): appNames(), groups, spoken, ground(), Grounding, normalize(), UiElement, dialogButtons()

### Community 93 - "snapshot.ts"
Cohesion: 0.26
Nodes (9): describePrompt(), elements(), parseSnapshot(), redactSecrets(), secrets, section(), Snapshot, snapshotText() (+1 more)

### Community 94 - "settings"
Cohesion: 0.23
Nodes (9): message(), Mode, NOTES, PHRASES, settings(), action(), progress(), refresh() (+1 more)

### Community 95 - "claude-code.test.ts"
Cohesion: 0.23
Nodes (8): claudeCodeEnvKeys, ClaudeCodeExecutor, Output, dir, fixture, flags, run(), task()

### Community 97 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, lib, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 98 - "news.test.ts"
Cohesion: 0.18
Nodes (4): briefPrompt(), NewsItem, readBrief(), png

### Community 99 - "plans.ts"
Cohesion: 0.18
Nodes (10): planApprovalMs, ended, jsonObject(), Outcome, PlanPanel, PlanRow, PlanStatus, PlanView (+2 more)

### Community 101 - "TaskSpecSchema"
Cohesion: 0.27
Nodes (3): EnvelopeSchema, ResultSchema, TaskSpecSchema

### Community 102 - "openai-compatible.test.ts"
Cohesion: 0.29
Nodes (6): CompletionSchema, OpenAICompatibleExecutor, providerId(), failure(), serve(), task

### Community 103 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, customConditions, declaration, outDir, rootDir, extends, include, ../../tsconfig.json

### Community 104 - "plan-gateway.test.ts"
Cohesion: 0.25
Nodes (5): close, desktopSpec(), plan(), Step, type

### Community 105 - "BilingualTTS"
Cohesion: 0.31
Nodes (5): TTSService, BilingualTTS, Frame, FrameDirection, Two local Piper voices, selected from Core's validated reply language.

### Community 107 - "Research and compatibility — 2026-10-17"
Cohesion: 0.25
Nodes (8): Browser Use, Claude, Codex, Evidence boundaries, Gemini, n8n, OpenClaw, Research and compatibility — 2026-10-17

### Community 108 - "JARVIS Core"
Cohesion: 0.25
Nodes (8): Configuration, Control API, Developer commands, Documentation, JARVIS Core, Layout, Native subscription mode (Windows), Windows quick start

### Community 109 - "subscription-config.test.ts"
Cohesion: 0.25
Nodes (5): CodexExecutor, codexOptions(), claude, paths, secrets

### Community 110 - "GatedSTT"
Cohesion: 0.36
Nodes (4): WhisperSTTService, GatedSTT, Frame, FrameDirection

### Community 111 - "run_session"
Cohesion: 0.39
Nodes (7): offer(), finished(), set_brain(), Any, run_session(), disconnected(), started()

### Community 112 - "Integration setup"
Cohesion: 0.29
Nodes (7): Browser Use, Claude and Gemini APIs, Claude Code subscription, Codex SDK, Integration setup, n8n, OpenClaw

### Community 113 - "narrate.ts"
Cohesion: 0.38
Nodes (5): done, narrate(), NarrationEvent, Pair, events

### Community 114 - "smoke.py"
Cohesion: 0.48
Nodes (6): gpu_used_mib(), main(), Any, GPU smoke test: CUDA, Piper TTS voices, faster-whisper STT and ECAPA speaker…, report(), timed()

### Community 115 - "textOf"
Cohesion: 0.53
Nodes (6): attr(), decode(), first(), imageUrl(), parseFeed(), textOf()

### Community 116 - "JARVIS Core architecture"
Cohesion: 0.40
Nodes (5): Event families, Execution and failure classification, JARVIS Core architecture, Not enabled, Risk and approval

### Community 117 - "dependencies"
Cohesion: 0.50
Nodes (4): dependencies, fast-xml-parser, @modelcontextprotocol/client, zod

### Community 118 - "context"
Cohesion: 0.50
Nodes (4): default, maxItems, type, context

### Community 119 - "expiresAt"
Cohesion: 0.50
Nodes (4): exclusiveMinimum, maximum, type, expiresAt

### Community 120 - "planId"
Cohesion: 0.50
Nodes (4): format, pattern, type, planId

### Community 121 - "providerOrder"
Cohesion: 0.50
Nodes (4): providerOrder, default, enum, type

### Community 122 - "risk"
Cohesion: 0.50
Nodes (4): risk, default, enum, type

### Community 124 - "5. Integration paths"
Cohesion: 0.67
Nodes (3): 5. Integration paths, Live verification, resumed session (2026-10-17), Subscription follow-up evidence, first run (2026-10-17)

## Knowledge Gaps
- **590 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+585 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 781 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `vitest` to `contracts.ts`, `package.json`, `Executor`, `telemetry.ts`, `catalog.ts`, `routing.ts`, `plans.test.ts`, `config.ts`, `mcp.ts`, `run.test.ts`, `models.ts`, `guards.ts`, `normalize`, `snapshot.ts`, `claude-code.test.ts`, `news.test.ts`, `TaskSpecSchema`, `openai-compatible.test.ts`, `plan-gateway.test.ts`, `subscription-config.test.ts`, `narrate.ts`, `hardening.test.ts`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `TaskService` connect `TaskService` to `contracts.ts`, `vitest`, `PlanService`, `plans.ts`, `routing.ts`, `plans.test.ts`, `plan-gateway.test.ts`, `config.ts`, `hardening.test.ts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `Task` connect `Task` to `contracts.ts`, `TaskService`, `vitest`, `Executor`, `routing.ts`, `openai-compatible.test.ts`, `TaskSpecSchema`, `plans.test.ts`, `config.ts`, `subscription-config.test.ts`, `models.ts`, `claude-code.test.ts`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _590 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `contracts.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12298387096774194 - nodes in this community are weakly interconnected._
- **Should `TaskService` be split into smaller, more focused modules?**
  _Cohesion score 0.09417249417249417 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._