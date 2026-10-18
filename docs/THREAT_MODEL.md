# Threat model

Scope: one trusted local operator. Core, its configuration and database are trusted.
Model outputs, repository content, pages, external webhooks and workflow results are untrusted.
This is not a multi-tenant authorization system or a hostile-host sandbox.

| Threat | Implemented containment | Residual gate |
| --- | --- | --- |
| Prompt injection / manipulated model success | Models have no API tools; output is schema-checked; permissions live in Core | Text matching proves an output contract only |
| Misdirected database (inherited shell `DATABASE_URL`) | Startup refuses any host other than loopback or the Compose `postgres` service | A remote database needs a code change and a review |
| Credential exfiltration | Secret references, restricted child environment, known-secret redaction, no request/exception logs | Unknown secrets and secrets embedded in user input need operator care; disk encryption outside Core |
| Dependency compromise | Exact npm/uv locks, npm install scripts disabled, vulnerability audit | OS image and Python dependency scans, provenance review remain required |
| Arbitrary command execution | No shell executor endpoint; Codex disabled without verified isolation | A configuration flag attests isolation; it does not create or prove it |
| Cross-agent escalation | Capability/provider allowlist, deterministic risk floor (HIGH for OpenClaw, Codex, n8n), no model-owned authorization | OpenClaw runtime tool denial must be independently enforced |
| Compromised webhook / replay | Separate token, restricted task shape, timestamp window, durable key+content hash | Shared token compromise permits scoped task admission; tokens need rotation |
| Ingress flood / queue exhaustion | Per-principal cap of 100 queued tasks for non-operator principals, 1000 in total; bounded body size | One compromised token can still fill its own quota |
| Duplicate external action | Persist intention first, single-use approval, call budget, no automatic replay after uncertainty | No exactly-once external guarantee; n8n workflow must deduplicate too |
| Stale or competing workers | PostgreSQL transaction lock, lease owner, monotonic fence and commit check | Competing claims and reconnect verified on PostgreSQL 18.3; multi-host workers untested |
| Browser session leakage | Ephemeral profile, no shared cookies, one browser slot, cleanup, downloads disabled | Container lifecycle and orphan-process behavior need live failure injection |
| SSRF / lateral movement | Service URLs from trusted configuration; request URL cannot select workflow endpoints; exact browser URL allowlist | Browser subresources/redirects require external egress policy; URL allowlist alone is insufficient |
| Path traversal / symlink escape | Canonical realpath containment, junction/symlink regression | Codex OS/container boundary must prevent reads outside delegated data |
| Unsafe deserialization / payload exhaustion | Zod strict boundaries, bounded JSON body/output/context, Python JSON only | HTTP libraries/processes still require OS quotas |
| Approval mutation / reuse | Parameters and configuration hash, expiry, atomic consumption | Mutable files inside a verified Codex home must be made immutable or re-fingerprinted before enablement |
| Misleading external success | Typed output evidence labels; reconciliation requires criterion match and operator identity | Authoritative business read-after-write verifiers remain integration-specific |
| Service compromise / lateral movement between services | Loopback publication; segmented Compose networks (data: PostgreSQL+Core, automation: n8n+Core, browser: worker+Core), so n8n and the browser worker cannot resolve or reach PostgreSQL (verified live), which is not published by default; no Docker socket or shared host profile; Core non-root; resource limits | Docker 28+ accepts a published container port from every bridge network, so n8n's and Core's loopback-published ports are reachable from other segments by IP, and `compose.dev.yaml` does the same for PostgreSQL; default dev database role is privileged; separate migration/runtime roles before sensitive deployment |
| Provider outage amplification | Per-provider circuit breaker, bounded retries with jitter, call budget and total deadline | Circuit state is per process and resets on restart |

Subscription-mode additions:

| Threat | Controls | Residual |
| --- | --- | --- |
| Subscription login theft | Vendor-owned logins, dedicated Codex home, API keys excluded from subscription child environments; Core never reads OAuth files | Native Codex can read host files and machine-wide guidance; OS user compromise exposes vendor logins; read-only is not an OS read boundary |
| OpenClaw operator-scope token theft | Random 48-byte shared secret, loopback Gateway, dedicated agent denying every tool; URL input fetching disabled | Bearer grants operator authority; protect profile config and `.env`, rotate together after compromise |
| Claude customization injection | `--safe-mode`, no tools/MCP/slash commands, empty working directory, bounded JSON and stderr | Enterprise-managed policy may still apply; account entitlement is checked by live calls |

Voice desktop M1 additions (see [ADR 0009](ADR/0009-voice-desktop-operator-experience.md)):

| Threat | Controls | Residual |
| --- | --- | --- |
| TV, other speakers or replayed voice | Local ECAPA gate after enrollment, name/follow-up gate; voice grants no approvals; M1 has no computer actions | Speaker embeddings are spoofable, not authentication; real microphone/TV threshold remains uncalibrated |
| Desktop renderer compromise | Context isolation, sandbox, no Node integration, self-only scripts, no webviews/navigation/popups; fixed IPC methods | Renderer can access its per-launch voice token and microphone; same-user compromise remains out of scope |
| Credential exposure | Core token read only in main, minimal voice-child environment; per-launch random token on authenticated loopback endpoints | OS user or main-process compromise exposes local credentials |
| Model HTML or script injection | Bounded display contract, DOM text nodes, no remote content or executable code rendering | Model prose can still mislead; it has no action authority in M1 |
| Unwanted personal data retention | No audio recordings; local deletable voice print; addressed transcript export/delete and 30-day purge in Core | Everyday transcripts reach configured external providers under `personal` consent; provider retention is outside local deletion |
| Silent self-modification or unconfirmed actions | M1 exposes neither computer actions nor a modification mechanism; later milestones must use Core and operator review | M2–M4 need their own implementation and verification gates |

Production gates: Docker/WSL isolation, non-bypassable OpenClaw tool policy, browser egress
controls, image scans, backup restoration, credential rotation, provider entitlement checks,
least-privilege DB roles and signed release/upgrade procedure. No production-readiness claim.
