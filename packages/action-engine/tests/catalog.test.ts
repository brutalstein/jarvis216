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
    ["file.create", "MEDIUM"],
    ["file.read", "LOW"],
    ["file.write", "MEDIUM"],
    ["file.delete", "HIGH"],
    ["web.open", "MEDIUM"],
    ["news.brief", "LOW"],
    ["memory.save", "MEDIUM"],
    ["memory.forget", "MEDIUM"],
  ])("defines %s with risk %s", (id, risk) => {
    expect(catalog[id]?.risk).toBe(risk);
  });

  it("keeps deletion HIGH and refuses arbitrary execution actions", () => {
    const ids = Object.keys(catalog);
    expect(ids.filter((id) => catalog[id]?.risk === "HIGH")).toEqual(
      expect.arrayContaining([
        "file.delete",
        "agent.delegate",
        "agent.execute",
        "automation.invoke",
      ]),
    );
    expect(ids.some((id) => /kill|shell|powershell|registry/.test(id))).toBe(false);
  });

  it("describes every action with its argument signature", () => {
    const lines = catalogLines();
    expect(lines).toContain("app.open(");
    expect(lines).toContain("name");
    expect(lines).toContain("file.read(path: string)");
  });

  it("omits disabled integration actions from catalog lines", () => {
    const none = catalogLines(new Set());
    expect(none).not.toContain("agent.delegate");
    expect(none).not.toContain("browser.read");
    expect(none).not.toContain("memory.save");
    expect(none).toContain("app.open(");
    const some = catalogLines(new Set(["browser.read"]));
    expect(some).toContain("browser.read(");
    expect(some).not.toContain("agent.delegate");
  });

  it.each(["file:///C:/x", "javascript:alert(1)"])("rejects non-web URL %s", (url) => {
    expect(compile([{ action: "web.open", args: { url } }]).ok).toBe(false);
  });

  it("bounds file content in UTF8 bytes and permits empty files", () => {
    const create = (content: string) =>
      compile([{ action: "file.create", args: { path: "a.txt", content } }]);
    expect(create("").ok).toBe(true);
    expect(create("é".repeat(8000)).ok).toBe(true);
    expect(create("é".repeat(8001)).ok).toBe(false);
    expect(create("\ud800").ok).toBe(false);
    expect(
      compile([{ action: "file.write", args: { path: "a.txt", content: "x".repeat(16001) } }]).ok,
    ).toBe(false);
    expect(compile([{ action: "file.delete", args: { path: "a.txt", recursive: true } }]).ok).toBe(
      false,
    );
  });

  it("rejects unknown actions and unexpected arguments", () => {
    const unknown = compile([{ action: "shell.run", args: {} }]);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.errors[0]).toContain("shell.run");
    expect(compile([{ action: "app.open", args: { name: "x", sudo: true } }]).ok).toBe(false);
    expect(compile("not a list").ok).toBe(false);
  });
});
