# Voice integration hub

The @jarvis/integration-hub workspace maps **model-proposed** catalog actions to
Core TaskService tasks. It creates no new scheduler, holds no credentials and makes no
HTTP requests. The existing Core gateway enforces risk, typed approvals, durable
intents, lease fencing, verification, uncertainty and reconciliation.

| Action | Provider | Admission | Approval |
| --- | --- | --- | --- |
| browser.read(url, expectedText) | Browser Use | Exact configured public HTTPS URL and DOM readback | LOW |
| agent.delegate(instruction) | OpenClaw | Dedicated configured agent, tool-denied OpenResponses | HIGH |
| automation.invoke(workflow,payload) | n8n | Named, registered published workflow; ≤ 8 KiB JSON | HIGH |

## Native Windows setup

Configure .env via scripts/bootstrap.ps1; install npm ci --ignore-scripts,
npm run build, run PostgreSQL plus native Core, and start apps/desktop (see
apps/desktop/README.md). Only explicitly enabled providers are advertised.

Browser Use: ENABLE_BROWSER=true, BROWSER_ALLOWED_URLS as JSON list of **exact
public HTTPS URLs**, separate worker token and independently verified network
egress restrictions. OpenClaw: ENABLE_OPENCLAW=true with restricted dedicated
agent, local Gateway bearer token and policy denial probes before asserting
OPENCLAW_POLICY_VERIFIED. n8n: ENABLE_N8N=true with N8N_WORKFLOWS_JSON entries
{name: {url, tokenRef, version}} where each referenced token is private;
use docker compose --profile automations. Workflows MUST deduplicate by taskId.

HIGH integrations need a **second exact Core action approval** beyond the
plan card (CLI or /v1/actions/:id/approve). Voice cannot grant it. Windows
Hello second factor is not implemented. Do not claim unrestricted hands-free
actions, guaranteed live connectivity or independently verified business
outcomes. Never replay an UNCERTAIN external result.
