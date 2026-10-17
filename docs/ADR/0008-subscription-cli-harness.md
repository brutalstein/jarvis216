# ADR 0008 — Subscription CLI harnesses on native Windows

Date: 2026-10-17. Status: accepted for one local operator.

Core invokes official Claude Code with tools and customizations disabled, prompt on stdin
and API keys excluded. Codex SDK uses an isolated vendor-managed ChatGPT login selected
by `CODEX_AUTH=chatgpt`; default API-key behavior remains. Core never reads OAuth tokens.
OpenClaw owns its Gateway, authentication and sessions, with a dedicated tool-denied agent.
Gemini stays API-key only. Core retains routing, approval, verification and recovery.

## Alternatives

- **A (selected):** official vendor CLI/SDK login and execution for the local operator.
- **B (rejected):** extracting OAuth tokens into API adapters crosses the authentication
  boundary and can violate subscription terms.
- **C (rejected):** putting all model and Core SDK sessions behind OpenClaw creates
  competing session ownership and hides Core's provider and failure evidence.

## Consequences and implementation rulings

Native read-only Codex is not an OS read boundary. HIGH approval and isolated home remain
mandatory; sensitive deployment requires a verified container/VM. Claude adds `--safe-mode`
because `--setting-sources` alone does not disable CLAUDE.md discovery. Installed CLI help
preserves auth in safe mode; managed policy can still apply. The existing objective maximum
remains 16,000 characters despite the plan's 19,000-character fixture. Output bounds count
UTF-8 bytes. Windows may inject OS variables beyond the supplied child allowlist.

Automatic policy review denied system MSI execution. The existing portable Node 24.22.0
ZIP was freshly verified against official SHASUMS256.txt and used through process PATH.
System Node remains unchanged. Claude's live gate is blocked by organization policy;
Gemini's is blocked by the missing key. Neither is claimed live-verified.

The official CLI exposes no output-token cap flag under the required environment/argv
contract. Claude Code and existing Codex execution therefore advertise
`outputTokenLimitEnforced: false` in readiness. Task token budgets are not an enforced
quota ceiling on those routes; use the API adapter when that guarantee is required.
