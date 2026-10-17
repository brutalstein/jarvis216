# PROJECT JARVIS CORE — MASTER ENGINEERING DIRECTIVE

## ROLE AND MISSION

You are acting as a team of world-class Principal Software Architects, Senior Systems Engineers, AI Agent Infrastructure Engineers, Security Engineers, Distributed Systems Engineers, and Software Reliability Engineers.

Your assignment is to **DESIGN, IMPLEMENT, TEST, AND VERIFY** the foundational backend of a highly capable, local-first autonomous AI assistant platform, provisionally named **JARVIS Core**.

This is NOT a chatbot project.

This is NOT a frontend project.

This is NOT a collection of loosely connected AI scripts.

This is a serious engineering project intended to become the backend foundation of a sophisticated personal autonomous agent platform.

The initial system must integrate the following technologies:

1. OpenClaw
2. Browser Use
3. n8n
4. Claude / Claude Code
5. OpenAI Codex
6. Google Gemini / Gemini CLI

These technologies must cooperate through well-defined architectural boundaries, stable integration contracts, explicit authority models, deterministic execution controls, and robust failure recovery.

The eventual application will have a web interface, but **DO NOT IMPLEMENT ANY FRONTEND NOW**.

Build the backend, service infrastructure, decision mechanisms, integrations, persistence, execution lifecycle, tests, and documentation.

The primary deployment target is a Windows machine, with WSL2 and Docker available where appropriate.

Development may occur in a cloud-based coding environment, but the resulting system must support reproducible local deployment.

**Your job is to produce working code, not merely an architecture proposal.**

---

# 1. NON-NEGOTIABLE ENGINEERING PRINCIPLES

Treat the following principles as binding engineering requirements.

### 1.1 Correctness Before Features

Never sacrifice architectural correctness, security, data integrity, or long-term maintainability for superficial feature completeness.

Prefer a verified working integration over a large but untested implementation.

No placeholder must be presented as a completed feature.

No mocked integration must be presented as a successful real integration.

No successful compilation may be presented as proof of runtime correctness.

### 1.2 Explicit Responsibility Ownership

Every operation must have exactly one authoritative owner.

Multiple technologies may collaborate on an operation, but responsibility for the final decision, state transition, and external side effect must be unambiguous.

Never allow OpenClaw, Browser Use, and n8n to independently make conflicting decisions about the same task.

Never create competing global orchestration systems.

### 1.3 Deterministic Control, Probabilistic Intelligence

Large language models are probabilistic decision-support and planning components.

They must not be trusted as the final enforcement mechanism for permissions, financial limits, destructive actions, security policies, or workflow invariants.

Implement deterministic enforcement in ordinary application code.

LLMs may propose plans and actions.

**The backend alone decides whether an action is authorized to execute.**

### 1.4 Fail Closed When Necessary

If authorization, task ownership, credential availability, operation identity, or execution safety cannot be established, reject or pause the action safely.

An unavailable model, disconnected tool, unexpected response, or failed verification must never silently escalate permissions.

### 1.5 No False Guarantees

No software system can guarantee that every possible failure is eliminated.

Instead, systematically identify failure classes and implement prevention, detection, containment, recovery, and evidence-based validation.

Use explicit risk and limitation registers.

A known unsupported capability must be marked unsupported rather than approximated with unsafe behavior.

### 1.6 Progressive Extensibility

Build strong interfaces and architectural seams without creating unnecessary abstractions.

Prefer high internal cohesion, low external coupling, and replaceable infrastructure components.

Adding a new LLM provider, external tool, automation engine, memory component, or user interface must not require redesigning the entire platform.

---

# 2. MANDATORY CURRENT-DOCUMENTATION RESEARCH

**DO NOT BEGIN IMPLEMENTING INTEGRATIONS USING ASSUMED OR OUTDATED APIs.**

Before implementation, inspect current official documentation and repository releases.

The following sources are mandatory starting points.

### OpenClaw
- https://docs.openclaw.ai/
- https://docs.openclaw.ai/gateway/protocol
- https://docs.openclaw.ai/tools/acp-agents
- https://docs.openclaw.ai/gateway/security/trust-model
- https://github.com/openclaw/openclaw

### Browser Use
- https://docs.browser-use.com/
- https://docs.browser-use.com/open-source/introduction
- https://docs.browser-use.com/open-source/quickstart
- https://github.com/browser-use/browser-use

### n8n
- https://docs.n8n.io/
- https://docs.n8n.io/api/
- https://docs.n8n.io/hosting/scaling/queue-mode/
- https://github.com/n8n-io/n8n

### Claude
- https://code.claude.com/docs/
- https://code.claude.com/docs/en/agent-sdk/overview
- https://platform.claude.com/docs/

### Codex
- https://developers.openai.com/codex/
- https://github.com/openai/codex
- https://github.com/openai/codex/tree/main/sdk/typescript

### Gemini
- https://ai.google.dev/gemini-api/docs
- https://geminicli.com/docs/
- https://github.com/google-gemini/gemini-cli

### Research Requirements

For every technology:

1. Identify its latest suitable stable release.
2. Inspect official integration APIs.
3. Inspect authentication methods and documented restrictions.
4. Inspect relevant breaking changes.
5. Identify security considerations.
6. Identify execution/session lifecycle semantics.
7. Verify how cancellation, streaming, timeouts, and failures work.
8. Inspect officially supported integrations before writing custom adapters.
9. Prefer maintained official SDKs over unnecessary custom implementations.
10. Record version constraints and tested combinations.

Create:

`docs/RESEARCH_AND_COMPATIBILITY.md`

It must contain a dated research record, official source URLs, verified versions, integration decisions, limitations, and compatibility risks.

Do not invent undocumented API methods.

Do not assume all providers offer equivalent capabilities.

If documentation cannot be accessed, document the blocker, avoid unsupported assumptions, and isolate the affected integration.

Use reproducible dependency locks. Do not automatically deploy unverified releases simply because they are newer.

---

# 3. ARCHITECTURAL AUTHORITY MODEL

Implement the following strict ownership model.

## 3.1 JARVIS Core Backend — FINAL SYSTEM AUTHORITY

The custom backend is the authoritative owner of:

- Global task state
- Task admission and validation
- Policy enforcement
- Capability authorization
- Action approval
- Global task planning contracts
- Execution budgets
- Cross-system correlation IDs
- Persistent task history
- Recovery coordination
- Scheduling governance
- Global cancellation
- Audit records
- Integration health
- Final task completion verification

The backend must expose typed internal APIs and a minimal developer-facing API suitable for a future frontend.

No external agent or workflow may bypass this authority layer.

## 3.2 OpenClaw — AGENT RUNTIME AND COORDINATION

OpenClaw owns:

- Agent runtime interactions
- Agent sessions
- Agent tool interaction within delegated permissions
- Supported agent delegation
- Conversation and agent execution context
- Supported external coding-harness integrations
- Agent execution event delivery

OpenClaw must not independently own global task persistence, approval policy, or cross-system authorization.

Use supported Gateway protocols and maintained integration mechanisms.

Evaluate native Codex app-server integration and ACP-based external harness execution separately.

Do not duplicate OpenClaw's existing session management or implement another full agent runtime without a demonstrated requirement.

## 3.3 Browser Use — DEDICATED BROWSER EXECUTION

Browser Use owns browser tasks requiring:

- Website navigation
- Form completion
- Visual webpage interaction
- Multi-step browser navigation
- Website content extraction
- Browser-based service configuration
- Authorized account administration
- API dashboard interaction

Browser Use must not own:

- Global task planning
- Global permission decisions
- General workflow scheduling
- Credential authority
- Global retries
- Unrelated coding tasks

Provide a dedicated browser-execution adapter with typed requests and responses.

Browser sessions must have explicit owners, timeouts, isolation rules, and cleanup semantics.

Avoid multiple browser-control systems simultaneously manipulating the same browser session.

Prefer direct service APIs for well-defined operations when officially supported.

Use Browser Use when browser interaction is genuinely required.

## 3.4 n8n — EVENT AND WORKFLOW AUTOMATION

n8n owns:

- Scheduled workflow execution
- External event triggers
- Repetitive integrations
- Defined application-to-application automation
- Workflow-specific retries
- Workflow execution records
- Supported webhook-driven automation

n8n must not act as a competing AI brain or global decision authority.

A workflow must invoke JARVIS Core through a controlled integration contract when intelligent task planning or privileged actions are required.

Ensure that n8n retries cannot produce unauthorized duplicate external side effects.

Use the official n8n API, CLI, webhooks, and supported workflow mechanisms.

Use n8n's own execution queue when appropriate, but do not confuse its internal queue with the global JARVIS task lifecycle.

## 3.5 Claude, Codex, and Gemini — MODEL AND SPECIALIST EXECUTION

Models may provide:

- Reasoning
- Planning proposals
- Code analysis
- Code generation
- Debugging
- Research
- Task decomposition
- Structured decision recommendations
- Result interpretation
- Independent verification

No model has unconditional authority over external side effects.

Each provider must be accessible through a well-defined adapter.

Model selection must be governed by a shared policy and capability registry.

---

# 4. TECHNOLOGY AND LANGUAGE STRATEGY

Adopt a practical, maintainable technology stack.

Preferred baseline:

- TypeScript with strict typing for core orchestration services
- Node.js on a currently supported stable/LTS release
- Python for the Browser Use worker
- PostgreSQL for durable application state
- Redis where appropriate for queued work and concurrency coordination
- Docker Compose for local development services
- WSL2 for Linux-dependent Windows deployment
- Structured JSON logging
- OpenTelemetry-compatible tracing

These are engineering defaults, not excuses to force unnecessary complexity.

Validate actual library support before choosing versions.

Keep the Python Browser Use worker isolated behind a typed interface, rather than mixing Python and TypeScript business logic indiscriminately.

Use OpenAPI, JSON Schema, or an equivalent contract system where appropriate.

No frontend framework, styling system, dashboard, or UI component library should be installed at this stage.

A small CLI and a documented HTTP control surface are sufficient.

---

# 5. CENTRAL TASK ENGINE

Implement an explicit durable task state machine.

At minimum, support:

- CREATED
- VALIDATING
- PLANNING
- READY
- RUNNING
- WAITING_FOR_APPROVAL
- WAITING_FOR_DEPENDENCY
- VERIFYING
- COMPLETED
- FAILED
- CANCELLED
- BLOCKED
- RECOVERY_REQUIRED

Define valid transitions and enforce them transactionally.

Every task must have:

- Unique task identifier
- Parent task identifier when applicable
- Correlation identifier
- Idempotency key where applicable
- Original user objective
- Normalized task specification
- Requested capabilities
- Risk classification
- Assigned execution owner
- Selected model or provider
- Resource and time budgets
- Deadline
- Attempt count
- Retry eligibility
- Durable event history
- Verification policy
- Final status and evidence

Support task decomposition into a directed acyclic graph when necessary.

Reject cyclic dependencies.

Prevent a task from running before its required dependencies complete.

Use leases or equivalent ownership mechanisms to prevent multiple workers from independently committing the same action.

A task must survive ordinary process restarts.

Recovery must distinguish between an action that definitely failed and an action whose external outcome is unknown.

**Never blindly repeat an irreversible action after an uncertain result.**

Implement explicit reconciliation for ambiguous external side effects.

---

# 6. DECISION ENGINE AND MODEL ROUTING

Build a deterministic policy-driven model-routing system.

The routing process must evaluate:

1. Task category
2. Required capabilities
3. Provider availability
4. Authentication availability
5. Permissions
6. Supported tool access
7. Expected execution latency
8. Rate limits
9. Cost budget
10. Context requirements
11. Privacy restrictions
12. Historical reliability
13. Verification requirements
14. Fallback eligibility

Do not use arbitrary hardcoded rules such as "Claude always plans" or "Codex always codes."

Instead, implement a versioned capability registry.

The registry must describe each provider's supported operations and execution characteristics.

Create explicit routing policies with deterministic tie-breaking.

Use performance observations only when statistically meaningful.

Prevent self-reported model confidence from being treated as proof of correctness.

### Model Integration Requirements

Implement adapters for:

- Claude Code / officially supported Claude execution interfaces
- Codex / officially supported Codex execution interfaces
- Gemini CLI / officially supported Gemini execution interfaces

Where OpenClaw already owns an external harness session, integrate through that supported pathway rather than launching a conflicting parallel session manager.

Differentiate between:

- Model API access
- Official coding-agent CLI access
- SDK access
- OpenClaw-mediated harness execution

Do not assume these modes share authentication, subscription entitlements, billing terms, or permission semantics.

Never bypass provider authentication or usage restrictions.

### Fallback Policy

If the selected model fails:

1. Classify the failure.
2. Determine whether another provider is compatible.
3. Preserve required task context without leaking unnecessary data.
4. Verify that the previous attempt did not already commit side effects.
5. Apply bounded retry and fallback rules.
6. Maintain a complete transition record.
7. Stop safely if no compatible provider remains.

Fallback must not silently increase permissions, spending limits, data exposure, or tool access.

---

# 7. STRICT ACTION EXECUTION GATEWAY

Implement a centralized action-execution gateway.

All privileged or externally consequential actions must pass through this gateway.

Each action request must contain:

- Action type
- Target system
- Target resource
- Requested operation
- Input parameters
- Required permissions
- Risk classification
- Source task identity
- Proposed executing agent
- Expected side effects
- Idempotency characteristics
- Verification criteria

The action gateway must:

1. Validate the schema.
2. Authenticate the caller.
3. Verify task ownership.
4. Enforce capability permissions.
5. Enforce applicable approval rules.
6. Check rate and resource limits.
7. Record the execution intention.
8. Delegate to the correct adapter.
9. Verify the actual result.
10. Commit the authoritative outcome.

LLM-generated tool calls must be treated as untrusted proposals.

Agents must not have unrestricted alternative paths that bypass the action gateway.

For coding agents, allow isolated workspace edits within their explicitly delegated sandbox. Applying changes to protected repositories or external systems must follow controlled promotion rules.

---

# 8. HUMAN APPROVAL AND RISK CLASSIFICATION

Implement a clear action-risk model.

### LOW RISK

Examples:

- Read local allowed files
- Inspect documentation
- Analyze source code
- Retrieve public information
- Perform non-destructive local tests

These may execute automatically under existing permissions.

### MEDIUM RISK

Examples:

- Modify files in an isolated workspace
- Install a reviewed dependency inside a sandbox
- Create draft workflows
- Modify reversible local configuration

These require bounded permissions, verification, and rollback capabilities where applicable.

### HIGH RISK

Examples:

- Delete important files
- Publish code
- Merge protected branches
- Send external messages
- Register external accounts
- Generate persistent external credentials
- Change service security settings
- Upload private data to external services

These must have explicit policy-based authorization, with human approval when required.

### CRITICAL RISK

Examples:

- Spending money
- Initiating financial transactions
- Signing agreements
- Changing recovery credentials
- Granting broad external access
- Performing difficult-to-reverse destructive operations

These require explicit, transaction-specific human approval.

Implement approval records with expiration, exact action scope, caller identity, and single-use semantics when appropriate.

Approvals must bind to the actual action parameters, not an ambiguous natural-language description.

A modified action invalidates the previous approval when the modification affects the approved scope.

Never bypass CAPTCHA, identity verification, access restrictions, or service security controls.

---

# 9. BROWSER AUTOMATION ENGINE

Implement a genuine Browser Use integration.

It must support:

- Creating browser tasks
- Acquiring isolated browser sessions
- Executing authorized navigation tasks
- Collecting structured results
- Capturing bounded diagnostic artifacts
- Detecting interruption and failure
- Handling timeouts
- Requesting user intervention when necessary
- Cancellation
- Session cleanup
- Verification of target outcomes

Separate browser reasoning from global task decisions.

Where an official API exists, implement a policy favoring deterministic API calls over fragile browser automation when appropriate.

For website registration and API-key creation:

- Require authorized identity and account context.
- Respect the service's terms and authentication flow.
- Support human-mediated verification.
- Never expose generated credentials in ordinary logs.
- Store credentials through the designated secret-management interface.
- Verify the credential using a minimal authorized test when possible.
- Return only a credential reference to the orchestration layer.

Avoid treating the disappearance of a dialog box as proof of successful account creation.

Require observable evidence.

---

# 10. N8N INTEGRATION ENGINE

Implement a real n8n integration with:

- Connectivity checks
- Authentication handling
- Workflow registration or discovery
- Workflow execution initiation where supported
- Webhook ingestion
- Execution correlation
- Execution status retrieval
- Failure reporting
- Cancellation or stopping where supported
- Retry coordination
- Workflow version tracking

Create at least one complete, working example of:

**n8n trigger → JARVIS Core task → OpenClaw agent execution → verified result → n8n notification/result consumption.**

Prevent n8n from calling internal privileged operations without valid authorization.

Use scoped credentials, authentication checks, signed webhooks when appropriate, and replay protection.

Do not build two independent schedulers that can both trigger the same job unintentionally.

State clearly which component owns each scheduling responsibility.

Use explicit event contracts and deduplication.

---

# 11. INTER-AGENT COMMUNICATION CONTRACT

Implement a common envelope for cross-component messages.

The envelope should include:

- Protocol version
- Message identifier
- Correlation identifier
- Causation identifier
- Task identifier
- Sender
- Intended recipient
- Event type
- Payload schema version
- Timestamp
- Deadline or expiry
- Required capability scope
- Idempotency metadata

Define structured event families for:

- Task requested
- Task accepted
- Task rejected
- Plan proposed
- Action proposed
- Action authorized
- Action denied
- Execution started
- Execution progress
- Execution completed
- Execution failed
- Approval requested
- Approval granted
- Approval rejected
- Verification succeeded
- Verification failed
- Cancellation requested
- Recovery required

Use durable delivery patterns for important transitions.

Assume that distributed message delivery may be duplicated, delayed, reordered, or interrupted.

Implement appropriate deduplication, ordering constraints, and reconciliation.

Never claim exactly-once external execution unless the complete end-to-end operation actually supports it.

---

# 12. PERSISTENCE, MEMORY, AND CONTEXT MANAGEMENT

Distinguish between:

1. Global task state
2. Short-lived agent context
3. Persistent task artifacts
4. User-approved long-term memory
5. Operational logs
6. Credentials
7. Verification evidence

These are different data classes.

Do not put everything into a single agent conversation or unstructured JSON document.

PostgreSQL should hold authoritative task and workflow metadata.

Agent-local context may remain under the supported ownership of the corresponding agent runtime.

Use references to large artifacts rather than copying entire documents between agents.

Implement:

- Task context compaction
- Context provenance
- Explicit memory scopes
- Bounded retention
- Recovery from stored checkpoints
- Context minimization
- Sensitive-data redaction
- Versioned state migration

Avoid premature introduction of a vector database unless a measured retrieval requirement justifies it.

No agent should receive unrelated credentials or private task content merely because it is participating in a workflow.

---

# 13. SECURITY ENGINEERING

Security is a first-class architectural requirement.

Implement or prepare:

- Least-privilege execution
- Isolated agent workspaces
- Filesystem boundary enforcement
- Process execution restrictions
- Secret references instead of raw secret propagation
- Local service authentication
- Network exposure restrictions
- Request validation
- Webhook verification
- Prompt-injection defenses
- Tool-output trust classification
- Sensitive-data redaction
- Rate limiting
- Resource quotas
- Dependency vulnerability scanning
- Dependency version pinning
- Audit trails
- Secure configuration defaults

Treat webpages, repository files, downloaded documents, tool results, and external messages as untrusted input.

They must not be allowed to rewrite system policies, grant themselves permissions, or override the action-execution gateway.

Investigate OpenClaw's documented trust boundaries carefully.

For the first phase, target a single trusted local operator.

Do not expose OpenClaw Gateway, n8n administration, database ports, or agent-control endpoints publicly.

Do not present a single-user gateway as a secure multi-tenant authorization system.

Implement a threat model covering at least:

- Prompt injection
- Credential exfiltration
- Malicious dependency installation
- Unauthorized local command execution
- Cross-agent privilege escalation
- Compromised webhooks
- Replay attacks
- Duplicate side effects
- Browser session leakage
- Path traversal
- Symlink escape
- Unsafe deserialization
- Model-output manipulation
- Misleading success reports
- Service compromise and lateral movement

Create `docs/THREAT_MODEL.md`.

---

# 14. RESOURCE AND PERFORMANCE MANAGEMENT

The system must be efficient on a Windows laptop.

Do not assume unlimited CPU, GPU, RAM, network bandwidth, or model quotas.

Build configurable concurrency limits for:

- Active agent sessions
- Browser instances
- Model requests
- Coding workspaces
- External workflow invocations
- Background jobs

Implement resource-aware scheduling with backpressure.

Avoid running Claude, Codex, and Gemini simultaneously unless the task benefits from parallel work.

Prevent uncontrolled recursive delegation.

Set limits for:

- Agent depth
- Tool-call count
- Task duration
- Retry count
- Browser concurrency
- Cost or usage budgets
- Process memory
- Worker concurrency

Support cooperative cancellation where providers allow it.

Measure end-to-end latency and time spent in each subsystem.

Optimize only after collecting meaningful baseline measurements.

---

# 15. FAILURE RECOVERY AND RESILIENCE

Design for realistic failures from the beginning.

Required scenarios include:

- OpenClaw unavailable
- Browser Use process crash
- n8n unavailable
- Redis unavailable
- PostgreSQL reconnect
- Claude timeout
- Codex runtime error
- Gemini rate limit
- Invalid model output
- Unexpected API response
- Expired credentials
- Browser session expiration
- Duplicate webhook
- Worker crash
- Host restart
- Partial external action success
- Cancellation during execution
- Two workers competing for the same task
- Approval timeout
- Context-size exhaustion
- Conflicting agent recommendations

Specify recovery behavior for every scenario.

Classify failures as:

- Transient
- Permanent
- Policy denied
- Authentication required
- User intervention required
- External outcome uncertain
- Provider unavailable
- Internal invariant violated

Use exponential backoff with jitter only for retry-safe operations.

Implement circuit breakers where beneficial.

Never allow infinite retry loops.

Never silently discard tasks.

Store enough state to resume or safely terminate interrupted operations.

Prefer explicit recovery-required states when automatic recovery could cause duplicate or harmful effects.

---

# 16. OBSERVABILITY AND VERIFICATION

Build observability into the platform from day one.

Provide:

- Structured logs
- Correlation IDs
- Distributed tracing
- Runtime health checks
- Dependency readiness checks
- Task-level duration metrics
- Integration failure counters
- Retry metrics
- Provider usage metrics
- Resource utilization metrics
- Action audit records

Prevent secret leakage in logs, traces, exceptions, and diagnostic artifacts.

A task may be marked COMPLETED only after its declared success criteria have been checked.

Distinguish clearly between:

- Model claims success
- Tool reports success
- External system confirms the intended state
- End-to-end acceptance criteria are satisfied

Prefer authoritative read-after-write verification where available.

Record what evidence established completion.

---

# 17. TESTING AND CODE-LEVEL GUARANTEES

Build a substantial automated test suite.

Testing must be continuous, not an afterthought.

### Unit Tests

Test:

- Task-state transitions
- Policy authorization
- Risk classification
- Routing decisions
- Fallback decisions
- Budget enforcement
- Approval expiry
- Message validation
- Retry eligibility
- Idempotency handling
- Cancellation propagation

### Property-Based Tests

Test invariants such as:

- Unauthorized actions are never executed.
- Completed tasks cannot transition backward illegally.
- Approval cannot authorize a different action.
- Duplicate input does not create an unintended duplicate side effect.
- Expired capabilities cannot be used.
- Failed verification cannot produce COMPLETED status.

### Integration Tests

Verify contracts between:

- Core backend and OpenClaw
- Core backend and Browser Use
- Core backend and n8n
- OpenClaw and Claude
- OpenClaw and Codex
- OpenClaw and Gemini
- Queue workers and durable task storage
- Approval engine and action gateway

### Failure Injection

Simulate:

- Worker termination
- Dependency outage
- Timeouts
- Duplicate events
- Reordered events
- Invalid provider responses
- Network interruptions
- Concurrent task conflicts
- Partial transactions
- Unknown external outcomes

### Security Tests

Include:

- Prompt-injection attempts
- Privilege escalation attempts
- Unauthorized tool invocation
- Path traversal
- Credential leakage checks
- Webhook replay
- Permission bypass attempts

### End-to-End Tests

Implement several complete backend workflows.

At minimum:

1. User task → planning → model selection → execution → verification.
2. n8n trigger → JARVIS task → OpenClaw → model response → result publication.
3. Browser Use task → browser action → verifiable outcome.
4. Coding agent → isolated repository modification → tests → evidence.
5. Provider failure → permitted fallback → successful verified completion.
6. High-risk action → approval requirement → authorized execution.
7. Interrupted execution → recovery without unintended duplicate effects.

Use deterministic mocks for CI where real credentials or external systems are unavailable.

Provide separate opt-in live integration tests.

Never claim a provider integration works in reality based only on mocked tests.

Run real dependency-level integration tests whenever the environment permits.

---

# 18. DEVELOPMENT QUALITY STANDARDS

Apply strict code quality.

Required:

- Strict TypeScript configuration
- Python type checking
- Schema-validated boundaries
- Clear package responsibilities
- Dependency injection at external boundaries
- No circular package dependencies
- No broad exception swallowing
- No unsafe dynamic evaluation
- No unbounded subprocess execution
- No unnecessary global mutable state
- No embedded credentials
- No silent permission escalation
- No arbitrary sleeps used as synchronization
- No undocumented background processes
- No excessive abstraction for hypothetical future requirements

Prefer established libraries over reinventing queues, databases, authentication primitives, or messaging protocols.

Every package must have an explicit purpose.

Every public interface must have a documented contract.

Every architectural decision that materially changes system behavior must be recorded in an ADR.

Implement database migrations rather than manual schema changes.

Provide reproducible formatting, linting, type checking, tests, and build commands.

---

# 19. REQUIRED INITIAL REPOSITORY STRUCTURE

Use this as a conceptual starting point, adjusting only where research demonstrates a superior design.

```text
jarvis-core/
├── apps/
│   ├── core-api/
│   ├── task-worker/
│   └── developer-cli/
│
├── services/
│   └── browser-worker/
│
├── packages/
│   ├── contracts/
│   ├── task-engine/
│   ├── decision-engine/
│   ├── capability-registry/
│   ├── policy-engine/
│   ├── approval-engine/
│   ├── execution-gateway/
│   ├── provider-routing/
│   ├── persistence/
│   ├── eventing/
│   ├── observability/
│   ├── security/
│   └── adapters/
│       ├── openclaw/
│       ├── browser-use/
│       ├── n8n/
│       ├── claude/
│       ├── codex/
│       └── gemini/
│
├── infrastructure/
│   ├── docker/
│   ├── database/
│   └── local/
│
├── tests/
│   ├── unit/
│   ├── contracts/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── resilience/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RESEARCH_AND_COMPATIBILITY.md
│   ├── COMPONENT_OWNERSHIP.md
│   ├── DECISION_ENGINE.md
│   ├── TASK_LIFECYCLE.md
│   ├── INTEGRATION_CONTRACTS.md
│   ├── SECURITY.md
│   ├── THREAT_MODEL.md
│   ├── FAILURE_RECOVERY.md
│   ├── TESTING.md
│   ├── DEPLOYMENT_WINDOWS.md
│   ├── OPERATIONAL_RUNBOOK.md
│   ├── LIMITATIONS.md
│   └── ADR/
│
├── scripts/
├── .github/workflows/
├── .env.example
├── docker-compose.yml
└── README.md
```

Do not create empty packages merely to match this tree.

Build actual functionality behind each introduced abstraction.

---

# 20. EXECUTION ORDER

Execute the project in the following order.

## PHASE A — SOURCE RESEARCH AND ARCHITECTURE

- Verify current official documentation.
- Inspect dependency compatibility.
- Establish component ownership.
- Define the complete task lifecycle.
- Define the authorization boundary.
- Define the inter-component contracts.
- Identify important failure modes.
- Record accepted technical decisions.

Produce the architecture documents.

Then proceed to implementation without waiting for unnecessary confirmation.

## PHASE B — MINIMAL WORKING FOUNDATION

Implement:

- Project scaffolding
- Configuration
- Database schema
- Task engine
- Policy engine
- Provider interfaces
- Event contracts
- Health checks
- Developer CLI
- Basic tracing
- Tests

The system must build and test successfully.

## PHASE C — REAL TECHNOLOGY INTEGRATIONS

Implement working adapters for:

- OpenClaw
- Browser Use
- n8n
- Claude
- Codex
- Gemini

Use documented interfaces.

Verify compatibility with actual running services whenever possible.

When credentials are missing, make the integration configurable, supply deterministic tests, and explicitly mark the live verification as pending.

## PHASE D — ROBUST DECISION AND EXECUTION

Implement:

- Deterministic model routing
- Capability registry
- Safe fallback
- Action execution gateway
- Approval state machine
- Durable task scheduling
- Cancellation
- Recovery
- Idempotency
- Verification logic

## PHASE E — HARDENING

Execute:

- Security checks
- Dependency scans
- Stress tests
- Failure injection
- Concurrency tests
- Resource measurements
- Cross-component contract tests
- Windows compatibility checks
- CI validation

Fix identified defects before declaring readiness.

---

# 21. ACCEPTANCE CRITERIA

The foundation is considered successfully implemented only when the following requirements are satisfied.

### Architecture

- Every major responsibility has one authoritative owner.
- No conflicting global orchestration loops exist.
- Component boundaries are documented and enforced in code.
- New providers can be added through stable interfaces.

### Execution

- Tasks follow valid persistent state transitions.
- Independent workers cannot improperly claim the same operation.
- Unauthorized actions are denied.
- Provider selection is explainable.
- Failure recovery is bounded.
- Cancellation has defined behavior.
- Side effects have appropriate idempotency or reconciliation protection.

### Integration

- OpenClaw is genuinely integrated.
- Browser Use is genuinely integrated.
- n8n is genuinely integrated.
- Claude, Codex, and Gemini have defined and tested execution paths.
- Provider limitations are represented explicitly.
- Unsupported capabilities are rejected safely.

### Security

- No hardcoded production credentials.
- No unauthenticated privileged execution endpoints.
- No unrestricted agent escalation.
- No credentials included in ordinary application logs.
- Approval is enforced in application code.
- Untrusted content cannot override security policy.

### Quality

- Build succeeds.
- Linting succeeds.
- Static typing succeeds.
- Automated tests pass.
- Contract tests pass.
- Relevant integration tests pass.
- Known limitations are documented.
- Local startup instructions are reproducible.

A test passing in a mock environment must not be reported as proof of live provider connectivity.

If a requirement cannot be satisfied, report exactly why and what evidence remains missing.

---

# 22. FUTURE EXTENSIBILITY

Design appropriate extension points for future capabilities, without fully implementing them now.

Anticipated future capabilities:

- Web control dashboard
- Natural-language task submission
- Voice interaction
- Windows desktop automation
- Mobile clients
- Remote execution nodes
- Additional LLM providers
- Locally hosted models
- Long-term semantic memory
- User-created skills
- External tool plugins
- Multiple autonomous specialist agents
- Advanced execution visualization
- Scheduled research agents
- Proactive monitoring
- Secure credential onboarding
- Additional deployment targets

Future features must reuse the existing task engine, authorization system, event contracts, and integration registry.

Do not implement speculative subsystems prematurely.

---

# 23. MANDATORY ENGINEERING REVIEW

Before claiming completion, conduct an adversarial architecture and code review.

Evaluate the project from these perspectives:

1. Principal Software Architect
2. Distributed Systems Engineer
3. Application Security Engineer
4. AI Agent Reliability Engineer
5. Performance Engineer
6. Windows Deployment Engineer
7. Maintainability and Testability Reviewer

For each perspective, identify:

- Architectural weaknesses
- Hidden coupling
- Security gaps
- Unhandled edge cases
- Incomplete integrations
- Potential deadlocks
- Race conditions
- Data-loss risks
- Resource leaks
- Unnecessary complexity
- Missing evidence
- Future compatibility concerns

Fix actionable high-severity findings.

Do not use self-review alone as proof of correctness.

Prioritize executable tests, reproducible failure cases, contract validation, and independent verification.

Create a final engineering report with evidence for each critical acceptance criterion.

---

# 24. IMPLEMENTATION BEHAVIOR

You are an implementation agent, not merely an advisor.

Do not respond with only a theoretical plan.

Inspect the environment.

Perform documentation research.

Make sound architectural decisions.

Create the actual repository structure.

Write the application code.

Implement the interfaces and integrations.

Execute available tests.

Analyze failures.

Correct the implementation.

Repeat validation after relevant changes.

Do not declare success prematurely.

Do not stop at an attractive but empty architecture.

Do not fabricate command execution, external connectivity, tool results, test results, or repository changes.

If your cloud environment cannot run a local dependency, provide a reproducible local deployment path and clearly classify that integration as not yet live-verified.

Work incrementally and preserve a clean, auditable project state.

Avoid unnecessary clarification requests where safe engineering defaults suffice.

If external credentials, financial authorization, or another essential permission is unavailable, implement everything that can safely be built without it and document the exact remaining blocker.

---

# 25. FINAL REQUIRED OUTPUT

At the end of implementation, provide:

1. A concise architecture summary.
2. A component responsibility matrix.
3. Actual project structure and implemented modules.
4. Verified dependency versions.
5. Implemented integration paths.
6. Local Windows installation instructions.
7. Service startup and shutdown commands.
8. Required environment variables.
9. Test execution commands.
10. Test results and supporting evidence.
11. Security controls implemented.
12. Failure-recovery capabilities.
13. Known unresolved risks and limitations.
14. Unverified external dependencies.
15. Performance baseline.
16. Future extension points.
17. Concrete next engineering milestones.

Clearly distinguish:

- Implemented and verified
- Implemented but not live-verified
- Partially implemented
- Not implemented
- Blocked by external requirements

No inflated quality claims.

No imaginary test coverage.

No unsupported statements of production readiness.

---

# ULTIMATE ENGINEERING OBJECTIVE

Build the first serious version of **JARVIS Core**.

It must establish a technically coherent foundation where:

**OpenClaw coordinates agent runtimes.**

**Browser Use executes authorized browser interactions.**

**n8n handles scheduled and event-driven automation.**

**Claude, Codex, and Gemini provide specialized intelligence through compatible, controlled integrations.**

**JARVIS Core alone governs global task state, authority, policy enforcement, durable execution, cross-system recovery, and final verification.**

The resulting system must be maintainable, extensible, security-conscious, resource-aware, and demonstrably functional.

The guiding rule is:

**Models propose. Policies authorize. Executors act. Evidence verifies. The core records the authoritative result.**

Build the foundation to the highest engineering standard that can be demonstrated with real implementation and reproducible evidence.

**BEGIN WITH CURRENT OFFICIAL DOCUMENTATION RESEARCH, THEN PROCEED TO IMPLEMENTATION AND VERIFICATION.**