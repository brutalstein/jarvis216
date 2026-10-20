/**
 * Opt-in Microsoft Playwright MCP (not the read-only Browser Use worker).
 * An inline, credential-free config avoids copying private MCP files into agent workspaces.
 * The version is pinned for repeatable operator installs and reviewed upgrades.
 */
export const playwrightMcpVersion = "0.0.83";

export function playwrightMcpConfig(options: { headless: boolean }): string {
  const args = [
    "-y",
    `@playwright/mcp@${playwrightMcpVersion}`,
    "--browser=chrome",
    "--isolated",
    ...(options.headless ? ["--headless"] : []),
  ];
  // On Windows, npx is a .cmd shim: launch via cmd.exe, not spawn("npx.cmd").
  const server =
    process.platform === "win32"
      ? { command: "cmd", args: ["/d", "/s", "/c", `npx ${args.join(" ")}`] }
      : { command: "npx", args };
  return JSON.stringify({ mcpServers: { playwright: server } });
}

/** OpenClaw's official stdio MCP bridge to an already running local Gateway. */
export function openClawMcpConfig(): string {
  const server =
    process.platform === "win32"
      ? { command: "cmd", args: ["/d", "/s", "/c", "openclaw mcp serve --claude-channel-mode off"] }
      : { command: "openclaw", args: ["mcp", "serve", "--claude-channel-mode", "off"] };
  return JSON.stringify({ mcpServers: { openclaw: server } });
}

/** Official n8n instance-level MCP endpoint; OAuth remains Claude-owned. */
export function n8nMcpConfig(endpoint: string): string {
  const url = new URL(endpoint);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("N8N_MCP_ENDPOINT_INVALID");
  return JSON.stringify({ mcpServers: { n8n: { type: "http", url: url.href } } });
}
