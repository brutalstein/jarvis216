import { describe, expect, it } from "vitest";
import { catalog } from "../src/catalog.js";
import { intentInstructions, readIntent, repairInstructions } from "../src/intent.js";

const open = { action: "app.open", args: { name: "Spotify" } };

describe("readIntent", () => {
  it("treats a missing intent as a plain reply", () => {
    expect(readIntent(undefined)).toEqual({ decision: { kind: "reply" } });
    expect(readIntent(null)).toEqual({ decision: { kind: "reply" } });
  });

  it("compiles a plan with catalog risks", () => {
    const result = readIntent({
      kind: "plan",
      goal: "Spotify'ı aç ve çal",
      steps: [open, { action: "media.key", args: { key: "play_pause" } }],
    });
    expect(result).toEqual({
      decision: {
        kind: "plan",
        goal: "Spotify'ı aç ve çal",
        steps: [
          { ...open, risk: "LOW", kind: "desktop" },
          { action: "media.key", args: { key: "play_pause" }, risk: "LOW", kind: "desktop" },
        ],
      },
    });
  });

  it("rejects plans without steps or with too many steps", () => {
    expect(readIntent({ kind: "plan", goal: "x", steps: [] })).toHaveProperty("errors");
    const many = readIntent({ kind: "plan", goal: "x", steps: Array(9).fill(open) });
    expect("errors" in many && many.errors.join(" ")).toContain("too many steps");
  });

  it("rejects the whole plan when one step is unknown or invalid", () => {
    const unknown = readIntent({
      kind: "plan",
      goal: "x",
      steps: [open, { action: "shell.run", args: { command: "del *" } }],
    });
    expect("errors" in unknown && unknown.errors.join(" ")).toContain("shell.run");
    const invalid = readIntent({
      kind: "plan",
      goal: "x",
      steps: [open, { action: "web.open", args: { url: "file:///C:/Windows" } }],
    });
    expect(invalid).toHaveProperty("errors");
  });

  it("requires a goal for plans", () => {
    expect(readIntent({ kind: "plan", steps: [open] })).toHaveProperty("errors");
  });

  it("reads cancel and clarify without steps", () => {
    expect(readIntent({ kind: "cancel" })).toEqual({ decision: { kind: "cancel" } });
    expect(readIntent({ kind: "clarify" })).toEqual({ decision: { kind: "clarify" } });
  });

  it("rejects an unknown kind", () => {
    expect(readIntent({ kind: "execute" })).toHaveProperty("errors");
  });
});

describe("intent instructions", () => {
  it("list every catalog action and forbid claims in say", () => {
    const text = intentInstructions();
    for (const id of Object.keys(catalog)) expect(text).toContain(id);
    expect(text).toContain("never");
    expect(text).toContain("say");
  });

  it("repair instructions quote the validation errors", () => {
    expect(repairInstructions(['step 1: unknown action "x"'])).toContain('unknown action "x"');
  });
});
