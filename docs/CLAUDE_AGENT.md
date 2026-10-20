# Claude Code agent: extensible JARVIS execution

An optional `agent.execute(instruction)` integration dispatches work to the **official
Claude Code CLI** with native tools and optional user-configured MCP servers. This is
separate from the tool-free `claude-code` conversational provider, so short
spoken turns retain their latency and stable prompt-cache prefix.

## Opt in

Configure your local, gitignored `.env`:

```env
ENABLE_CLAUDE_AGENT=true
CLAUDE_CODE_PATH=C:\\path\\to\\claude.exe
CLAUDE_CODE_MODEL=sonnet
CLAUDE_AGENT_WORKSPACE=C:\\your\\project
CLAUDE_AGENT_PERMISSION_MODE=auto
CLAUDE_AGENT_MAX_TURNS=12
CLAUDE_AGENT_MCP_CONFIG=C:\\private\\mcp.json
CLAUDE_AGENT_PLAYWRIGHT=true
CLAUDE_AGENT_PLAYWRIGHT_HEADLESS=false
```

The MCP config is **optional**. The CLI can discover already installed user/project
MCP integrations. If set without built-in Playwright, it is an exclusive absolute
path to a private Claude-compatible JSON file. If Playwright is enabled, its
credential-free inline configuration and the private file are additive, alongside
user/project MCP servers. Do not put secrets in the Playwright inline configuration.
Example of a separate private MCP JSON file:

```json
{"mcpServers":{"my-tools":{"command":"node","args":["C:\\tools\\server.js"]}}}
```

When `CLAUDE_AGENT_PLAYWRIGHT=true`, the system adds Microsoft's official
`@playwright/mcp@0.0.83` (pinned) automatically to the Claude agent. Unlike the
separate JARVIS `browser.read` worker, Playwright MCP provides navigation,
clicking, typing and form submission. It launches Chrome in an isolated browser
profile; a browser executable and a first-run npm download are required. In
headed mode, the operator can observe the browser. The separate read-only
`ENABLE_BROWSER` flag is not required for this MCP integration.

OpenClaw and n8n may also be exposed to Claude by **separately configured,
compatible MCP servers**, installed in Claude's user/project settings or your
private JSON file. This change does not install or verify those servers.
Alternatively
JARVIS can compose `agent.execute`, `browser.read`, `agent.delegate` and
`automation.invoke` in one typed Core plan. Those catalog actions use the
existing IntegrationHub connectors and exact Core approvals.

## Architecture and evidence

- Core advertises the action only when `ENABLE_CLAUDE_AGENT=true`.
- A validated `agent.execute` instruction becomes a HIGH-risk, private Core
  task. Tasks, plans and permissions still use the existing durable gateway.
- The separate `claude-agent` executor is non-retryable: an uncertain tool
  action must not be replayed automatically.
- The CLI receives the objective over stdin, with `--tools default`,
  configured native permission mode, `--max-turns` and standard
  user/project/local settings, skills and CLAUDE.md enabled.
  Playwright opt-in loads an additive inline MCP source instead of disabling
  other operator-installed integrations.
- When Settings → İzinler is set to **Tam yetki** (autonomous), the Core's
  permission callback reads the current grants at **dispatch time**.
  Only then, `agent.execute` runs with Claude `--allowedTools` including
  native tools and `mcp__*`; it does not use `bypassPermissions`.
  Switching away or expiring grants removes this allowance on the next run.
  This grants broad code execution and web interaction to a model running with
  the operator's OS privileges. Use only in a dedicated, limited Windows account
  or isolated VM/container with no unrelated credentials/data. Claude-managed
  deny rules and user-interaction requirements can still prevent some operations.
  The JARVIS catalog/gateway audit records the top-level delegated task but not
  every individual MCP action.
- The CLI runs in the configured workspace; the Core token and API keys
  do not enter its environment. Vendor login remains vendor-owned.
- Brain uses existing plan outcome learning; no second context memory or
  model planning loop is added.
- Claude's own auto permission mode depends on its installed version and
  organization policy. No `--dangerously-skip-permissions` is enabled.
- MCP tools invoked *inside* Claude are **not individually audited by Core**.
  For that stronger guarantee use explicit Core catalog steps instead.

The unit tests use a fake CLI process to check exact flags, process isolation,
failure classification and result handling. Live Claude tools, Windows file edits,
MCP interoperability, and end-to-end multi-service execution still require
physical-host smoke tests. No production-readiness claim is made.

## Local verification

First run `npm run check:ci` and `npm run matrix:check`; these do **not**
contact the Claude subscription. Set `ENABLE_CLAUDE_AGENT=true`,
`CLAUDE_AGENT_PLAYWRIGHT=true`, and use a dedicated
`CLAUDE_AGENT_WORKSPACE`. Restart native Core, then confirm `claude-agent`
in `npm run cli -- ready`. For a live smoke test, when quota is available,
run a task on a local test form you own, check the form's saved result and Core's
task record. A passing fake CLI test does not demonstrate browser installation,
Chrome/Playwright availability or live MCP interoperability.

The operator's **Tam yetki** setting bypasses JARVIS action approval for
catalogued tasks, not all restrictions enforced by external apps, operating
systems, accounts or Claude-managed policies. Never automate CAPTCHA bypass,
external account actions against site terms, or other unavailable capabilities.
