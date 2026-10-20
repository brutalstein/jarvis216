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
