import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { GuardError } from "./guards.js";
import type { ToolPort, ToolResult } from "./types.js";

export type McpOptions = {
  command: string;
  args: string[];
  env: Record<string, string>;
  allow: string[];
  // Two crashes inside this window stop restarts until the older one ages out.
  restartWindowMs?: number;
  clock?: () => number;
};

// The child sees these plus the SDK's own system-only defaults; never Core's secrets.
const inherited = ["PATH", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];

export class McpToolPort implements ToolPort {
  #options: McpOptions;
  #client: Client | null = null;
  #starting: Promise<Client> | null = null;
  #crashes: number[] = [];

  constructor(options: McpOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    await this.#ready();
  }

  async list(): Promise<string[]> {
    return (await this.describe()).map((tool) => tool.name);
  }

  async describe(): Promise<{ name: string; description: string; inputSchema: unknown }[]> {
    const client = await this.#ready();
    const descriptors: { name: string; description: string; inputSchema: unknown }[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, {
        signal: AbortSignal.timeout(10000),
      });
      for (const tool of page.tools)
        if (this.#options.allow.includes(tool.name))
          descriptors.push({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
          });
      cursor = page.nextCursor;
      if (cursor && (seen.has(cursor) || seen.size >= 32))
        throw new Error("MCP_PAGINATION_INVALID");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return descriptors;
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    if (!this.#options.allow.includes(name)) throw new GuardError("TOOL_NOT_ALLOWED");
    signal.throwIfAborted();
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    let client: Client;
    try {
      client = await Promise.race([this.#ready(), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    try {
      const result = await client.callTool({ name, arguments: args }, { signal });
      const text = (result.content ?? [])
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      return { ok: !result.isError, text };
    } catch (error) {
      // The child exited mid-call: the outcome is unknown; the next call starts a fresh child.
      if (this.#client !== client) throw new Error("MCP_CHANNEL_LOST", { cause: error });
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    await client?.close();
  }

  #ready(): Promise<Client> {
    if (this.#client) return Promise.resolve(this.#client);
    // A crash loop stops; a child that crashed long ago may start again (self-healing).
    const now = this.#now();
    const window = this.#options.restartWindowMs ?? 600_000;
    this.#crashes = this.#crashes.filter((at) => now - at < window);
    if (this.#crashes.length > 1) return Promise.reject(new Error("MCP_RESTART_LIMIT"));
    this.#starting ??= this.#spawn().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  #now(): number {
    return (this.#options.clock ?? Date.now)();
  }

  async #spawn(): Promise<Client> {
    const env: Record<string, string> = {};
    for (const key of inherited) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    const transport = new StdioClientTransport({
      command: this.#options.command,
      args: this.#options.args,
      env: { ...env, ...this.#options.env },
      stderr: "ignore",
    });
    const client = new Client({ name: "jarvis-action-engine", version: "0.1.0" });
    client.onclose = () => {
      if (this.#client === client) {
        this.#client = null;
        this.#crashes.push(this.#now());
      }
    };
    await client.connect(transport);
    this.#client = client;
    return client;
  }
}
