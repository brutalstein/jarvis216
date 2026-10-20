import { describe, expect, it } from "vitest";
import { createIntegrationHub, IntegrationHub } from "../src/index.js";

const active = () =>
  createIntegrationHub({
    openclaw: true,
    claudeAgent: true,
    browserUrls: ["https://example.com/"],
    workflows: ["digest"],
  });
describe("allowlisted integration recipes", () => {
  it("advertises enabled providers only", () => {
    expect(createIntegrationHub({}).available()).toEqual([]);
    expect(active().available()).toEqual([
      "agent.delegate",
      "agent.execute",
      "automation.invoke",
      "browser.read",
      "browser.read_many",
    ]);
    expect(() =>
      createIntegrationHub({}).compile("agent.delegate", { instruction: "hi" }),
    ).toThrow();
  });
  it("binds Claude Code agent to a durable HIGH Core task", () => {
    const task = active().compile("agent.execute", { instruction: "Analyze and implement" });
    expect(task).toMatchObject({
      capability: "text.generate",
      providers: ["claude-agent"],
      risk: "HIGH",
      privacy: "private",
      input: { action: "agent.execute" },
    });
    expect(task.objective).toBe("Analyze and implement");
    expect(() => createIntegrationHub({}).compile("agent.execute", { instruction: "x" })).toThrow();
    expect(() => active().compile("agent.execute", { instruction: "" })).toThrow();
  });
  it("binds OpenClaw and n8n to exact HIGH Core tasks", () => {
    expect(active().compile("agent.delegate", { instruction: "analyze" })).toMatchObject({
      capability: "text.generate",
      providers: ["openclaw"],
      risk: "HIGH",
      budget: { maxCalls: 1 },
    });
    expect(active().compile("automation.invoke", { workflow: "digest" })).toMatchObject({
      capability: "workflow.invoke",
      providers: ["n8n"],
      risk: "HIGH",
      input: { workflow: "digest", payload: {} },
    });
  });
  it("rejects unregistered workflows and unsafe payloads", () => {
    for (const id of ["missing", "constructor", "__proto__"])
      expect(() => active().compile("automation.invoke", { workflow: id })).toThrow();
    expect(() =>
      active().compile("automation.invoke", {
        workflow: "digest",
        payload: { x: "y".repeat(9000) },
      }),
    ).toThrow();
  });
  it("requires exact public browser URLs with no arbitrary navigation", () => {
    expect(
      active().compile("browser.read", {
        url: "https://example.com/",
        expectedText: "Example Domain",
      }),
    ).toMatchObject({
      capability: "browser.extract",
      risk: "LOW",
      verification: { kind: "contains", value: "Example Domain" },
    });
    expect(
      active().compile("browser.read_many", {
        pages: [{ url: "https://example.com/", expectedText: "Example Domain" }],
      }),
    ).toMatchObject({
      capability: "browser.extract",
      input: { pages: [{ url: "https://example.com/", expectedText: "Example Domain" }] },
    });
    for (const url of [
      "https://example.com/other",
      "https://example.com.evil/",
      "http://example.com/",
    ])
      expect(() => active().compile("browser.read", { url, expectedText: "x" })).toThrow();
    expect(() =>
      active().compile("browser.read_many", {
        pages: [{ url: "https://example.com/other", expectedText: "x" }],
      }),
    ).toThrow();
    expect(() => createIntegrationHub({ browserUrls: ["https://example.com/#secret"] })).toThrow();
  });
  it("rejects duplicate or malformed registration", () => {
    const hub = new IntegrationHub();
    const r = () => active().compile("agent.delegate", { instruction: "hi" });
    hub.register("custom.read", r);
    expect(() => hub.register("custom.read", r)).toThrow();
    expect(() => hub.register("__proto__", r)).toThrow();
  });
});
