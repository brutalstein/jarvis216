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
```

The MCP config is **optional**. If set it must be an absolute path to a private
Claude-compatible JSON file, for example:

```json
{"mcpServers":{"my-tools":{"command":"node","args":["C:\\tools\\server.js"]}}}
```

Browser Use, OpenClaw and n8n can each be supplied by compatible existing MCP
servers in that file, subject to their own installed services and credentials.
There is no hardwired MCP adapter for them in this increment. Alternatively
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
  configured native permission mode, `--max-turns`, and
  `--strict-mcp-config` (no inherited MCP servers).
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
