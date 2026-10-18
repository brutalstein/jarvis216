# Voice integration hub

The @jarvis/integration-hub workspace maps **model-proposed** catalog actions to
Core TaskService tasks. It creates no new scheduler, holds no credentials and makes no
HTTP requests. The existing Core gateway enforces risk, typed approvals, durable
intents, lease fencing, verification, uncertainty and reconciliation.

| Action | Provider | Admission | Approval |
| --- | --- | --- | --- |
| browser.read(url, expectedText) | Browser Use | Exact configured public HTTPS URL and DOM readback | LOW |
| browser.read_many(pages) | Browser Use | Up to 4 exact allowlisted HTTPS URLs in one ephemeral session | LOW |
| agent.delegate(instruction) | OpenClaw | Dedicated configured agent, tool-denied OpenResponses | HIGH |
| automation.invoke(workflow,payload) | n8n | Named, registered published workflow; ≤ 8 KiB JSON | HIGH |

## Native Windows setup

Configure .env via scripts/bootstrap.ps1; install npm ci --ignore-scripts,
npm run build, run PostgreSQL plus native Core, and start apps/desktop (see
apps/desktop/README.md). Only explicitly enabled providers are advertised.

Native start order (Windows host):

```powershell
# Optional: OpenClaw Gateway + Browser worker jobs + n8n Compose profile
.\scripts\integrations-native.ps1
# Or individually:
.\scripts\openclaw-native.ps1          # Gateway on 127.0.0.1:18789
.\scripts\browser-native.ps1           # Actor worker on 127.0.0.1:8765
docker compose --profile automations up -d
npm run build; npm start
```

Browser Use: ENABLE_BROWSER=true, BROWSER_ALLOWED_URLS as JSON list of **exact
public HTTPS URLs**, separate worker token and independently verified network
egress restrictions. OpenClaw: ENABLE_OPENCLAW=true with restricted dedicated
agent, local Gateway bearer token and policy denial probes before asserting
OPENCLAW_POLICY_VERIFIED. n8n: ENABLE_N8N=true with N8N_WORKFLOWS_JSON entries
{name: {url, tokenRef, version}} where each referenced token is private;
use docker compose --profile automations (no native n8n binary). Workflows MUST
deduplicate by taskId. OpenClaw tools stay denied; Browser Use stays Actor DOM
readback only (no LLM agent, forms, or credentials).

HIGH integrations need a **second exact Core action approval** beyond the
plan card (CLI or /v1/actions/:id/approve), unless the operator allowed the
action in Settings → İzinler ([ADR 0014](ADR/0014-operator-standing-permissions.md));
the gateway then records the standing grant as the approval. Voice cannot grant it. Windows
Hello second factor is not implemented. Do not claim unrestricted hands-free
actions, guaranteed live connectivity or independently verified business
outcomes. Never replay an UNCERTAIN external result.

Efficiency notes: Core reuses an undici keep-alive pool for loopback OpenClaw,
browser worker and n8n calls. The conversation catalog lists only enabled
integration actions. OpenClaw plan steps share `user=plan:<planId>` for Gateway
session affinity without Core owning sessions. OpenClaw tools stay denied;
Browser Use stays Actor DOM readback only (no LLM agent, forms, or credentials).
