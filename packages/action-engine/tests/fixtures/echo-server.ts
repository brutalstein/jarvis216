// Stdio MCP server for McpToolPort tests.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "0.0.0" });
server.registerTool("echo", { inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({
  content: [{ type: "text", text }],
}));
server.registerTool("fail", { inputSchema: z.object({}) }, async () => ({
  content: [{ type: "text", text: "failed on purpose" }],
  isError: true,
}));
server.registerTool("crash", { inputSchema: z.object({}) }, async () => process.exit(1));
server.registerTool("env", { inputSchema: z.object({}) }, async () => ({
  content: [{ type: "text", text: JSON.stringify(process.env) }],
}));
await server.connect(new StdioServerTransport());
