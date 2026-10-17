# Threat model

Scope: one trusted local operator. Core, its configuration and database are trusted.
Model outputs, repository content, pages, external webhooks and workflow results are untrusted.
This is not a multi-tenant authorization system or a hostile-host sandbox.

| Threat | Implemented containment | Residual gate |
| --- | --- | --- |
| Prompt injection / manipulated model success | Models have no API tools; output is schema-checked; permissions live in Core | Text matching proves an output contract only |
| Credential exfiltration | Secret references, restricted child environment, known-secret redaction, no request/exception logs | Unknown secrets and secrets embedded in user input need operator care; disk encryption outside Core |
| Dependency compromise | Exact npm/uv locks, npm install scripts disabled, vulnerability audit | OS image and Python dependency scans, provenance review remain required |
| Arbitrary command execution | No shell executor endpoint; Codex disabled without verified isolation | A configuration flag attests isolation; it does not create or prove it |
| Cross-agent escalation | Capability/provider allowlist, deterministic risk floor, no model-owned authorization | OpenClaw runtime tool denial must be independently enforced |
| Compromised webhook / replay | Separate token, restricted task shape, timestamp window, durable key+content hash | Shared token compromise permits scoped task admission; tokens need rotation |
| Duplicate external action | Persist intention first, single-use approval, call budget, no automatic replay after uncertainty | No exactly-once external guarantee; n8n workflow must deduplicate too |
| Stale or competing workers | PostgreSQL transaction lock, lease owner, monotonic fence and commit check | Real multiprocess PostgreSQL gate pending |
| Browser session leakage | Ephemeral profile, no shared cookies, one browser slot, cleanup, downloads disabled | Container lifecycle and orphan-process behavior need live failure injection |
| SSRF / lateral movement | Service URLs from trusted configuration; request URL cannot select workflow endpoints; exact browser URL allowlist | Browser subresources/redirects require external egress policy; URL allowlist alone is insufficient |
| Path traversal / symlink escape | Canonical realpath containment, junction/symlink regression | Codex OS/container boundary must prevent reads outside delegated data |
| Unsafe deserialization / payload exhaustion | Zod strict boundaries, bounded JSON body/output/context, Python JSON only | HTTP libraries/processes still require OS quotas |
| Approval mutation / reuse | Parameters and configuration hash, expiry, atomic consumption | Mutable files inside a verified Codex home must be made immutable or re-fingerprinted before enablement |
| Misleading external success | Typed output evidence labels; reconciliation requires criterion match and operator identity | Authoritative business read-after-write verifiers remain integration-specific |
| Service compromise | Loopback publication, no Docker socket or shared host profile, Core non-root, resource limits | Default dev database role is privileged; separate migration/runtime roles before sensitive deployment |

Production gates: Docker/WSL isolation, non-bypassable OpenClaw tool policy, browser egress
controls, image scans, backup restoration, credential rotation, provider entitlement checks,
least-privilege DB roles and signed release/upgrade procedure. No production-readiness claim.
