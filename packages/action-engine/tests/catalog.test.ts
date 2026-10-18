import { describe, expect, it } from "vitest";
import { catalog, catalogLines, compile } from "../src/catalog.js";

describe("catalog", () => {
  it("compiles a valid step with the catalog's risk and kind", () => {
    expect(compile([{ action: "app.open", args: { name: "Spotify" } }])).toEqual({
      ok: true,
      steps: [{ action: "app.open", args: { name: "Spotify" }, risk: "LOW", kind: "desktop" }],
    });
  });

  it("marks news as an info action and typing as MEDIUM", () => {
    const result = compile([
      { action: "news.brief", args: {} },
      { action: "ui.type", args: { text: "merhaba" } },
    ]);
    expect(result.ok && result.steps.map((s) => [s.kind, s.risk])).toEqual([
      ["info", "LOW"],
      ["desktop", "MEDIUM"],
    ]);
  });

  it.each([
    ["app.open", "LOW"],
    ["app.focus", "LOW"],
    ["app.close", "MEDIUM"],
    ["window.list", "LOW"],
    ["screen.describe", "LOW"],
    ["media.key", "LOW"],
    ["ui.click", "MEDIUM"],
    ["ui.type", "MEDIUM"],
    ["key.shortcut", "MEDIUM"],
    ["clipboard.read", "LOW"],
    ["clipboard.write", "MEDIUM"],
    ["file.list", "LOW"],
    ["file.move", "MEDIUM"],
    ["file.copy", "MEDIUM"],
    ["file.rename", "MEDIUM"],
    ["file.mkdir", "MEDIUM"],
    ["web.open", "MEDIUM"],
    ["news.brief", "LOW"],
  ])("defines %s with risk %s", (id, risk) => {
    expect(catalog[id]?.risk).toBe(risk);
  });

  it("contains no HIGH or shell-like actions", () => {
    const ids = Object.keys(catalog);
    expect(ids).toHaveLength(18);
    expect(ids.some((id) => /delete|kill|shell|powershell|registry/.test(id))).toBe(false);
  });

  it("describes every action with its argument signature", () => {
    const lines = catalogLines();
    expect(lines).toContain("app.open(");
    expect(lines).toContain("name");
    expect(lines.split("\n")).toHaveLength(18);
  });

  it.each(["file:///C:/x", "javascript:alert(1)"])("rejects non-web URL %s", (url) => {
    expect(compile([{ action: "web.open", args: { url } }]).ok).toBe(false);
  });

  it("rejects unknown actions and unexpected arguments", () => {
    const unknown = compile([{ action: "shell.run", args: {} }]);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.errors[0]).toContain("shell.run");
    expect(compile([{ action: "app.open", args: { name: "x", sudo: true } }]).ok).toBe(false);
    expect(compile("not a list").ok).toBe(false);
  });
});
