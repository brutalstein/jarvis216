# Graph Report - jarvis216  (2026-10-18)

## Corpus Check
- 182 files · ~161,786 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 5, .xml 2, .lock 2)

## Summary
- 1621 nodes · 3025 edges · 132 communities (115 shown, 8 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 117 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `da8406fa`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- contracts.ts
- TaskService
- package.json
- BoundaryTests
- services.ts
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
- conversation.ts
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
- Executor
- ui.ts
- Review Focus
- Task
- create_app
- brain.py
- guards.ts
- normalize
- snapshot.ts
- settings
- FollowUpWindow
- ServerTest
- compilerOptions
- news.test.ts
- integration-hub/src/index.ts
- integration-hub/package.json
- compilerOptions
- hud.ts
- compilerOptions
- N8nClient
- BilingualTTS
- FakeConnection
- Research and compatibility — 2026-10-17
- JARVIS Core
- Action engine evidence (M3, cycle 1)
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
- ADR 0010: Models propose typed plans; a compiler and the operator admit them
- Architecture
- assets.d.ts
- jarvis-voice
- Voice integration hub

## God Nodes (most connected - your core abstractions)
1. `TaskService` - 55 edges
2. `Task` - 46 edges
3. `vitest` - 42 edges
4. `PlanService` - 38 edges
5. `invariant()` - 33 edges
6. `ProviderFailure` - 32 edges
7. `Executor` - 29 edges
8. `buildServer()` - 25 edges
9. `configuredProviders()` - 23 edges
10. `TaskSpecSchema` - 23 edges

## Surprising Connections (you probably didn't know these)
- `service()` --calls--> `PlanService`  [EXTRACTED]
  tests/plans.test.ts → src/plans.ts
- `runWorker()` --calls--> `ProviderRegistry`  [EXTRACTED]
  tests/plans.test.ts → src/routing.ts
- `runWorker()` --calls--> `Worker`  [EXTRACTED]
  tests/plans.test.ts → src/worker.ts
- `Bridge` --references--> `PlanView`  [EXTRACTED]
  apps/desktop/src/shared.ts → src/plans.ts
- `evaluate()` --calls--> `scoreIntent()`  [EXTRACTED]
  scripts/eval-intents.ts → packages/action-engine/src/eval-score.ts

## Import Cycles
- None detected.

## Communities (132 total, 8 thin omitted)

### Community 0 - "contracts.ts"
Cohesion: 0.07
Nodes (31): Action, attemptedStatuses, BrowserPageSchema, canTransition(), Capability, CapabilitySchema, EnvelopeSchema, EventType (+23 more)

### Community 1 - "TaskService"
Cohesion: 0.06
Nodes (29): ContextStore, insertContext(), ContextEntrySchema, CoreError, fingerprint(), invariant(), taskDeadline(), TaskState (+21 more)

### Community 2 - "package.json"
Cohesion: 0.11
Nodes (18): engines, node, @types/node, typescript, zod, name, private, type (+10 more)

### Community 3 - "BoundaryTests"
Cohesion: 0.12
Nodes (16): Exception, Explicit opt-in public-page smoke test; no credentials, accounts or shared…, BoundaryTests, authorize(), encode(), extract(), main(), do_GET() (+8 more)

### Community 4 - "services.ts"
Cohesion: 0.16
Nodes (9): BrowserInputSchema, WorkflowInputSchema, serviceUrl(), browserPages(), openClawUserKey(), OpenResponse, probeOpenClaw(), WorkflowExecutor (+1 more)

### Community 5 - "budget"
Cohesion: 0.08
Nodes (24): additionalProperties, default, properties, required, type, maxCalls, maxDurationMs, maxOutputTokens (+16 more)

### Community 6 - "MASTER_DIRECTIVE.md"
Cohesion: 0.10
Nodes (20): 10. N8N INTEGRATION ENGINE, 11. INTER-AGENT COMMUNICATION CONTRACT, 12. PERSISTENCE, MEMORY, AND CONTEXT MANAGEMENT, 13. SECURITY ENGINEERING, 14. RESOURCE AND PERFORMANCE MANAGEMENT, 15. FAILURE RECOVERY AND RESILIENCE, 16. OBSERVABILITY AND VERIFICATION, 18. DEVELOPMENT QUALITY STANDARDS (+12 more)

### Community 7 - "Engineering report — JARVIS Core foundation"
Cohesion: 0.09
Nodes (23): 10. Test results and evidence, 11. Security controls, 12. Failure recovery, 13. Known risks and limitations, 14. Unverified external dependencies, 15. Performance baseline, 16. Extension points, 17. Next milestones (+15 more)

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
Cohesion: 0.19
Nodes (7): FrameProcessor, TranscriptionFrame, Brain, BrainTest, send(), FakeCore, transcript()

### Community 13 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, customConditions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir (+5 more)

### Community 14 - "desktop/package.json"
Cohesion: 0.05
Nodes (39): dependencies, @pipecat-ai/client-js, @pipecat-ai/small-webrtc-transport, description, devDependencies, electron, esbuild, @fontsource-variable/eb-garamond (+31 more)

### Community 15 - "properties"
Cohesion: 0.18
Nodes (11): anyOf, type, properties, causationId, idempotencyKey, protocolVersion, schemaVersion, const (+3 more)

### Community 16 - "README.md"
Cohesion: 0.27
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
Cohesion: 0.15
Nodes (13): dependencies, @anthropic-ai/sdk, fastify, @google/genai, @jarvis/action-engine, @jarvis/integration-hub, @openai/codex-sdk, @opentelemetry/api (+5 more)

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
Cohesion: 0.12
Nodes (24): ActionDef, catalog, catalogLines(), compile(), definitions, files, JsonProperty, path (+16 more)

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
Cohesion: 0.14
Nodes (11): @electric-sql/pglite, pg, vitest, Database, migrate(), postgres(), auth, memoryDatabase() (+3 more)

### Community 66 - "conversation.ts"
Cohesion: 0.11
Nodes (23): canonical(), EvalCommand, EvalCommandSchema, scoreIntent(), Decision, gold, evaluate(), integrations (+15 more)

### Community 68 - "JARVIS desktop design"
Cohesion: 0.08
Nodes (21): JARVIS desktop design, Layout and motion, Source, Tokens, Type, shape and icons, JARVIS desktop (M1, M3 plan cards), Run on this Windows checkout, Use (+13 more)

### Community 69 - "routing.ts"
Cohesion: 0.23
Nodes (4): outageKinds, Provider, ProviderRegistry, base

### Community 70 - "run.ts"
Cohesion: 0.13
Nodes (20): Args, bad(), bindings, bringToFront(), Evidence, exists(), failed(), frontTitle() (+12 more)

### Community 71 - "plans.test.ts"
Cohesion: 0.14
Nodes (19): claude(), close, desktop(), gemini(), headlines, Input, news, newsFeed() (+11 more)

### Community 72 - "SpeakerGate"
Cohesion: 0.13
Nodes (9): Vector, embed(), Path, Operator voice print: a conversation filter, not a security boundary., ECAPA embedding of 16-bit mono PCM., SpeakerGate, _unit(), Path (+1 more)

### Community 73 - "JARVIS voice desktop experience — design"
Cohesion: 0.10
Nodes (19): Architecture, Character, Constraints and evidence, Core changes, Desktop application (`apps/desktop`, Electron, TypeScript), Intent, JARVIS voice desktop experience — design, M2 Memory (interface) (+11 more)

### Community 74 - "config.ts"
Cohesion: 0.12
Nodes (17): ids, ConfigSchema, configuredProviders(), conversationProviders(), OpenAICompatibleExecutor, providerId(), BrowserExecutor, main() (+9 more)

### Community 75 - "Microphone"
Cohesion: 0.16
Nodes (6): connect(), CONSTRAINTS, Link, Microphone, @pipecat-ai/client-js, @pipecat-ai/small-webrtc-transport

### Community 76 - "Review Focus"
Cohesion: 0.11
Nodes (17): Global Constraints, Intent and Action Engine (M3 cycle 1) Implementation Plan, Review Focus, Task 10: Conversation routing, endpoints and SSE, Task 11: Voice announcements, Task 12: Desktop HUD — cards, panels, control indicator, Task 13: Eval, live verification and documentation, Task 14: Independent review (+9 more)

### Community 77 - "JARVIS intent and action engine (M3, cycle 1) — design"
Cohesion: 0.14
Nodes (13): Catalog (cycle 1), Compilation, plans and approval, Display panels and UI, Evidence (checked 2026-10-18), Execution, verification and replanning, Intent, JARVIS intent and action engine (M3, cycle 1) — design, Operator decisions (2026-10-18) (+5 more)

### Community 78 - "mcp.ts"
Cohesion: 0.16
Nodes (7): inherited, McpOptions, McpToolPort, ToolPort, ToolResult, server, @modelcontextprotocol/client

### Community 79 - "news.ts"
Cohesion: 0.16
Nodes (15): blocked, bounded(), capped(), editions, fetchNews(), named, NewsArgs, NewsContext (+7 more)

### Community 80 - "shared.ts"
Cohesion: 0.07
Nodes (18): readOperatorEnv(), broadcast(), plans, receivePlan(), setListening(), streamStop, updateTray(), streamPlans() (+10 more)

### Community 81 - "app.ts"
Cohesion: 0.24
Nodes (17): caption, fail(), notice, NOTICES, presence, receive(), relay(), setListening() (+9 more)

### Community 82 - "Presence"
Cohesion: 0.20
Nodes (7): KEYS, Look, LOOKS, Presence, rgb(), UNIFORMS, State

### Community 83 - "action-engine/package.json"
Cohesion: 0.12
Nodes (15): description, devDependencies, @modelcontextprotocol/server, exports, zod, name, private, scripts (+7 more)

### Community 84 - "run.test.ts"
Cohesion: 0.14
Nodes (11): runStep(), behind, Call, closed, dialog, notepad, notepadText, retitled() (+3 more)

### Community 85 - "Executor"
Cohesion: 0.17
Nodes (12): @anthropic-ai/sdk, @google/genai, Executor, ClaudeExecutor, CodexAuth, CodexExecutor, codexOptions(), GeminiExecutor (+4 more)

### Community 86 - "ui.ts"
Cohesion: 0.16
Nodes (15): caption, presence, show, showPlan, captions(), IconName, ICONS, reducedMotion (+7 more)

### Community 87 - "Review Focus"
Cohesion: 0.12
Nodes (15): Global Constraints, JARVIS Voice Desktop M1 Implementation Plan, Review Focus, Task 10: Presence, stage, captions, overlay and settings, Task 11: End-to-end voice turn, Task 12: Documentation and final verification, Task 1: Contract additions: `personal` privacy, `non-empty` verification, listed provider order, Task 2: Trusted providers for private data (+7 more)

### Community 88 - "Task"
Cohesion: 0.10
Nodes (22): ExecutionResult, Task, DesktopExecutor, NewsExecutor, step(), claudeCodeEnvKeys, ClaudeCodeExecutor, failure() (+14 more)

### Community 89 - "create_app"
Cohesion: 0.12
Nodes (7): Application, Enrollment, create_app(), main(), Authenticated loopback signalling and enrollment for one operator desktop., Enrollment, Local STT after semantic end-of-turn and speaker verification. No audio is…

### Community 90 - "brain.py"
Cohesion: 0.16
Nodes (8): AsyncBaseTransport, Protocol, Core, Addressed speech goes through Core. A newer turn supersedes an unfinished reply., CoreClient, Client for Core's conversation endpoint. Failures become None so JARVIS can…, Turn, CoreClientTest

### Community 91 - "guards.ts"
Cohesion: 0.21
Nodes (13): blockedApp(), blockedShortcut(), containedPath(), distance(), escapeTarget(), escapeTitles, GuardError, inside() (+5 more)

### Community 92 - "normalize"
Cohesion: 0.27
Nodes (9): appNames(), groups, spoken, ground(), Grounding, normalize(), UiElement, dialogButtons() (+1 more)

### Community 93 - "snapshot.ts"
Cohesion: 0.24
Nodes (10): look(), describePrompt(), elements(), parseSnapshot(), redactSecrets(), secrets, section(), Snapshot (+2 more)

### Community 94 - "settings"
Cohesion: 0.23
Nodes (9): message(), Mode, NOTES, PHRASES, settings(), action(), progress(), refresh() (+1 more)

### Community 95 - "FollowUpWindow"
Cohesion: 0.15
Nodes (8): FollowUpWindow, is_named(), Decides whether speech is meant for JARVIS: its name, or the follow-up window…, Any, Frame, FrameDirection, FollowUpWindowTest, IsNamedTest

### Community 97 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, customConditions, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+3 more)

### Community 98 - "news.test.ts"
Cohesion: 0.18
Nodes (4): briefPrompt(), NewsItem, readBrief(), png

### Community 99 - "integration-hub/src/index.ts"
Cohesion: 0.18
Nodes (11): agent, browser, browserMany, createIntegrationHub(), exactUrl(), HubTask, IntegrationError, IntegrationHub (+3 more)

### Community 100 - "integration-hub/package.json"
Cohesion: 0.17
Nodes (11): dependencies, zod, description, exports, zod, name, private, scripts (+3 more)

### Community 101 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+2 more)

### Community 102 - "hud.ts"
Cohesion: 0.52
Nodes (6): hud(), button(), render(), update(), node(), states

### Community 103 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, customConditions, declaration, outDir, rootDir, extends, include, ../../tsconfig.json

### Community 105 - "BilingualTTS"
Cohesion: 0.31
Nodes (5): TTSService, BilingualTTS, Frame, FrameDirection, Two local Piper voices, selected from Core's validated reply language.

### Community 107 - "Research and compatibility — 2026-10-17"
Cohesion: 0.25
Nodes (8): Browser Use, Claude, Codex, Evidence boundaries, Gemini, n8n, OpenClaw, Research and compatibility — 2026-10-17

### Community 108 - "JARVIS Core"
Cohesion: 0.25
Nodes (8): Configuration, Control API, Developer commands, Documentation, JARVIS Core, Layout, Native subscription mode (Windows), Windows quick start

### Community 109 - "Action engine evidence (M3, cycle 1)"
Cohesion: 0.40
Nodes (5): Action engine evidence (M3, cycle 1), Automated verification, Intent eval, Known gaps, Live checks

### Community 110 - "GatedSTT"
Cohesion: 0.36
Nodes (4): WhisperSTTService, GatedSTT, Frame, FrameDirection

### Community 111 - "run_session"
Cohesion: 0.39
Nodes (7): offer(), finished(), set_brain(), Any, run_session(), disconnected(), started()

### Community 112 - "Integration setup"
Cohesion: 0.22
Nodes (9): Browser Use, Claude and Gemini APIs, Claude Code subscription, Codex SDK, Integration setup, n8n, News (RSS), OpenClaw (+1 more)

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
Cohesion: 0.33
Nodes (6): Event families, Execution and failure classification, JARVIS Core architecture, Model-proposed plans (M3), Not enabled, Risk and approval

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

### Community 123 - "ADR 0010: Models propose typed plans; a compiler and the operator admit them"
Cohesion: 0.50
Nodes (4): ADR 0010: Models propose typed plans; a compiler and the operator admit them, Consequences, Context, Decision

### Community 124 - "Architecture"
Cohesion: 0.50
Nodes (4): Architecture, Core (host), `packages/action-engine` (npm workspace), Windows-MCP

## Knowledge Gaps
- **646 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+641 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 854 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `vitest` to `contracts.ts`, `package.json`, `conversation.ts`, `news.test.ts`, `integration-hub/src/index.ts`, `routing.ts`, `plans.test.ts`, `config.ts`, `mcp.ts`, `narrate.ts`, `telemetry.ts`, `run.test.ts`, `catalog.ts`, `Executor`, `Task`, `guards.ts`, `normalize`, `snapshot.ts`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `PlanView` connect `shared.ts` to `contracts.ts`, `TaskService`, `hud.ts`, `plans.test.ts`, `desktop/package.json`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _646 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `contracts.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0746606334841629 - nodes in this community are weakly interconnected._
- **Should `TaskService` be split into smaller, more focused modules?**
  _Cohesion score 0.05860805860805861 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `BoundaryTests` be split into smaller, more focused modules?**
  _Cohesion score 0.11942959001782531 - nodes in this community are weakly interconnected._