# Windows native JARVIS service manager

This is a **detached process launcher**, not a Windows Service or Task Scheduler
installation. Closing the launching PowerShell does not stop running services.
Windows sign-out/reboot, application crash or explicit Stop can stop them.
It does **not** provide auto-start at login, crash-restart or production supervision.

Run from the repository with Windows PowerShell 5.1+:

```powershell
# Once: install dependencies and configure .env
npm ci --ignore-scripts
.\scripts\jarvis-services.ps1 -Action Doctor

# Start PostgreSQL, configured external services and JARVIS Core
.\scripts\jarvis-services.ps1 -Action Start

# Also open Electron; Electron spawns and owns the voice worker
.\scripts\jarvis-services.ps1 -Action Start -WithDesktop

.\scripts\jarvis-services.ps1 -Action Status
.\scripts\jarvis-services.ps1 -Action Logs -Service core -Tail 80
.\scripts\jarvis-services.ps1 -Action Restart -WithDesktop
.\scripts\jarvis-services.ps1 -Action Stop
```

Start builds Core unless -NoBuild is specified. For -WithDesktop, install
Electron dependencies and its binary separately:

```powershell
npm ci --prefix apps/desktop --ignore-scripts
node apps/desktop/node_modules/electron/install.js
```

## Service lifecycle

| Component | When launched | Runtime |
| --- | --- | --- |
| PostgreSQL | Native Core requires it | Compose postgres on loopback port 55432 |
| OpenClaw Gateway | ENABLE_OPENCLAW=true | Native detached process |
| Legacy Browser Use | ENABLE_BROWSER=true and verified egress | Native detached worker, port 8765 |
| n8n | ENABLE_N8N=true or CLAUDE_AGENT_N8N_MCP_URL set | Compose n8n, port 5678 |
| JARVIS Core | Always | Detached Node process, port 2160 |
| Electron UI | -WithDesktop | Detached desktop app; voice worker managed by Electron |
| Windows-MCP | ENABLE_DESKTOP=true | Core starts its own child |
| Claude Playwright MCP | CLAUDE_AGENT_PLAYWRIGHT=true | On demand inside Claude, not a permanent daemon |
| Claude, Codex, Gemini | Provider enabled | Called on demand: startup spends no model quota |

The launcher does not modify .env, grant permissions or enable unverified
components. The Tam yetki preset belongs to Core and its operator app.

Readiness checks verify loopback HTTP/TCP endpoints, **not live model credentials
or tool execution**. External pre-existing processes are never stopped.
Owned process PID, start time and log locations are kept at
data/runtime/service-manager/ (gitignored). Stop checks ownership and uses
Windows taskkill only against verified process trees. Docker volumes are
retained; never docker down -v. Fresh logs per start are under logs/.

Start is idempotent for healthy services. If one of multiple startup phases
fails, previous phases are kept for diagnosis; use Stop to clean them up.

## Diagnostic codes

- ENV_MISSING / ENV_SYNTAX / ENV_DUPLICATE: Fix .env; bootstrap preserves it.
- DEPENDENCY_MISSING / NPM_NOT_INSTALLED: Check Node 24, npm, Docker and any
  enabled OpenClaw/uv dependencies.
- DOCKER_NOT_READY / DOCKER_COMPOSE_FAILED: Docker Desktop launches automatically when installed; otherwise start it manually. Inspect
  the Compose configuration.
- BUILD_FAILED / DIST_MISSING: Run npm ci --ignore-scripts then npm run build.
- CORE_PORT_BUSY / BROWSER_PORT_BUSY: Unknown listener. No destructive killing.
- SERVICE_EXITED / HEALTH_TIMEOUT: Use -Action Logs and -Action Status.
- BROWSER_NOT_ATTESTED: Independently verify network isolation before enabling.
- STATE_INVALID: Back up and inspect state.json; do not kill stale PIDs.

CAUTION: compose.dev.yaml publishes PostgreSQL to the native host. Enabling
n8n or a legacy browser profile at the same time can weaken network isolation.
Do not use this combined topology with valued data; see compose.dev.yaml.
The script does not bypass web authentication, model quotas or other app policy.
Rotate any credentials that were previously shared in a chat.
