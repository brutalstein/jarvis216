import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpToolPort } from "../src/mcp.js";

const server = fileURLToPath(new URL("./fixtures/echo-server.ts", import.meta.url));
const options = (allow: string[]) => ({
  command: process.execPath,
  args: ["--import", "tsx", server],
  env: { ECHO_MODE: "test" },
  allow,
});
const signal = new AbortController().signal;

let port: McpToolPort;
beforeAll(async () => {
  process.env.JARVIS_TEST_SECRET = "must-not-reach-the-child";
  port = new McpToolPort(options(["echo", "fail", "crash", "env"]));
  await port.start();
}, 30_000);
afterAll(async () => {
  delete process.env.JARVIS_TEST_SECRET;
  await port.close();
});

describe("McpToolPort", () => {
  it("lists the server's tools", async () => {
    expect(await port.list()).toEqual(expect.arrayContaining(["echo", "fail", "crash"]));
  });
  it("discovers schemas only for tools this port permits", async () => {
    const narrow = new McpToolPort(options(["echo"]));
    try {
      expect(await narrow.list()).toEqual(["echo"]);
      expect(await narrow.describe()).toEqual([
        expect.objectContaining({
          name: "echo",
          inputSchema: expect.objectContaining({ type: "object" }),
        }),
      ]);
    } finally {
      await narrow.close();
    }
  });

  it("joins text content and maps isError to ok: false", async () => {
    expect(await port.call("echo", { text: "merhaba" }, signal)).toEqual({
      ok: true,
      text: "merhaba",
    });
    expect(await port.call("fail", {}, signal)).toEqual({ ok: false, text: "failed on purpose" });
  });

  it("refuses tools outside the allowlist before reaching the server", async () => {
    const narrow = new McpToolPort(options(["echo"]));
    await expect(narrow.call("fail", {}, signal)).rejects.toMatchObject({
      code: "TOOL_NOT_ALLOWED",
    });
    await narrow.close();
  });
  it("does not wait for the child after the step is cancelled", async () => {
    const cancelled = new AbortController();
    cancelled.abort(new Error("step deadline"));
    const fresh = new McpToolPort(options(["echo"]));
    await expect(fresh.call("echo", {}, cancelled.signal)).rejects.toThrow("step deadline");
    await fresh.close();
  });

  it("gives the child only the configured environment", async () => {
    const env = JSON.parse((await port.call("env", {}, signal)).text) as Record<string, string>;
    expect(env.ECHO_MODE).toBe("test");
    expect(env).not.toHaveProperty("JARVIS_TEST_SECRET");
  });

  it("reports a lost channel and restarts on the next call", async () => {
    await expect(port.call("crash", {}, signal)).rejects.toThrow("MCP_CHANNEL_LOST");
    expect(await port.call("echo", { text: "tekrar" }, signal)).toEqual({
      ok: true,
      text: "tekrar",
    });
    await expect(port.call("crash", {}, signal)).rejects.toThrow("MCP_CHANNEL_LOST");
    await expect(port.call("echo", {}, signal)).rejects.toThrow("MCP_RESTART_LIMIT");
  }, 30_000);

  it("starts again once old crashes leave the restart window", async () => {
    let now = 0;
    const healing = new McpToolPort({
      ...options(["echo", "crash"]),
      restartWindowMs: 1000,
      clock: () => now,
    });
    try {
      await expect(healing.call("crash", {}, signal)).rejects.toThrow("MCP_CHANNEL_LOST");
      await expect(healing.call("crash", {}, signal)).rejects.toThrow("MCP_CHANNEL_LOST");
      await expect(healing.call("echo", { text: "x" }, signal)).rejects.toThrow(
        "MCP_RESTART_LIMIT",
      );
      now = 1500;
      expect(await healing.call("echo", { text: "iyileşti" }, signal)).toEqual({
        ok: true,
        text: "iyileşti",
      });
    } finally {
      await healing.close();
    }
  }, 30_000);
});
