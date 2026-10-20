import { describe, expect, it } from "vitest";
import { playwrightMcpConfig, playwrightMcpVersion } from "../src/integrations/claude-mcp.js";

describe("official Playwright MCP configuration", () => {
  it("uses a pinned package, isolated Chrome and no inherited service token", () => {
    const config = JSON.parse(playwrightMcpConfig({ headless: false })) as {
      mcpServers: { playwright: { command: string; args: string[] } };
    };
    const server = config.mcpServers.playwright;
    expect(server.command).toBe(process.platform === "win32" ? "cmd" : "npx");
    const command = server.args.join(" ");
    expect(command).toContain(`@playwright/mcp@${playwrightMcpVersion}`);
    expect(command).toContain("--browser=chrome");
    expect(command).toContain("--isolated");
    expect(command).not.toContain("--headless");
    expect(playwrightMcpConfig({ headless: false })).not.toContain("JARVIS_TOKEN");
  });

  it("sets headless mode only when explicitly requested", () => {
    const config = JSON.parse(playwrightMcpConfig({ headless: true })) as {
      mcpServers: { playwright: { args: string[] } };
    };
    expect(config.mcpServers.playwright.args.join(" ")).toContain("--headless");
  });
});
