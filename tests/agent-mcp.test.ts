import { describe, expect, it } from "vitest";
import {
  n8nMcpConfig,
  openClawMcpConfig,
  playwrightMcpConfig,
  playwrightMcpVersion,
} from "../src/integrations/claude-mcp.js";

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

describe("official agent MCP service bridges", () => {
  it("uses OpenClaw's built-in routed-conversation MCP bridge", () => {
    const config = JSON.parse(openClawMcpConfig()) as {
      mcpServers: { openclaw: { command: string; args: string[] } };
    };
    expect(
      [config.mcpServers.openclaw.command, ...config.mcpServers.openclaw.args].join(" "),
    ).toContain("openclaw mcp serve");
    expect(config.mcpServers.openclaw.args.join(" ")).toContain("--claude-channel-mode");
  });

  it("uses n8n's built-in MCP endpoint without credential-bearing URLs", () => {
    const endpoint = "http://127.0.0.1:5678/mcp-server/http";
    const config = JSON.parse(n8nMcpConfig(endpoint)) as {
      mcpServers: { n8n: { type: string; url: string } };
    };
    expect(config.mcpServers.n8n).toEqual({ type: "http", url: endpoint });
    expect(() => n8nMcpConfig("http://example.com/mcp")).toThrow();
    expect(() => n8nMcpConfig("http://admin:secret@127.0.0.1:5678/mcp")).toThrow();
    expect(() => n8nMcpConfig("https://example.com/mcp?token=secret")).toThrow();
  });
});
