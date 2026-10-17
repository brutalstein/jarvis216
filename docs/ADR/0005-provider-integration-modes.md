# ADR 0005: Provider integration modes

Status: accepted, 2026-10-17

## Decision

| Provider | Mode | Reason |
| --- | --- | --- |
| Claude | Official Messages SDK, no tools | API keys are the documented programmatic path; CLI subscriptions stay separate |
| Gemini | Official GenAI SDK, no tools | Same as Claude |
| Codex | Official Codex SDK in an attested isolated workspace and home | Codex can read and write files; isolation must exist outside Core |
| OpenClaw | Gateway OpenResponses endpoint (`POST /v1/responses`, `x-openclaw-agent-id`) | Stable HTTP contract; the Gateway keeps session ownership; no second session manager |
| Browser Use | Python worker using Actor methods for fixed DOM readback | Deterministic, no generated scripts, ephemeral profile |
| n8n | Inbound scoped webhook; outbound registered published webhooks; API key client for discovery | n8n has no stable public "execute workflow" API |

Every adapter maps failures to `ProviderFailure(kind, retryable, dispatched)`, enforces a
response size cap and an abort signal, and reports health as "configured", never as live.
Each integration is disabled until enabled; agentic ones also need an operator attestation
flag (`OPENCLAW_POLICY_VERIFIED`, `CODEX_ISOLATION_VERIFIED`, `BROWSER_EGRESS_VERIFIED`).

## Consequences

The attestation flags record an operator claim; they do not create isolation. Live
verification status per provider is tracked in the engineering report.
