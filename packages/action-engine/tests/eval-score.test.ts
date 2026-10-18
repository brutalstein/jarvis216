import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../src/catalog.js";
import { EvalCommandSchema, type EvalCommand, scoreIntent } from "../src/eval-score.js";
import { readIntent } from "../src/intent.js";

const gold: EvalCommand = {
  utterance: "Spotify'ı aç, sonra sesi kapat", lang: "tr", kind: "plan",
  actions: ["app.open", "media.key"], args: { "0": { name: "Spotify" }, "1": { key: "mute" } },
};
const decision = (steps: unknown[]) => {
  const parsed = readIntent({ kind: "plan", goal: "Music", steps });
  if (!("decision" in parsed)) throw new Error(parsed.errors.join(", "));
  return parsed.decision;
};

describe("intent eval scorer", () => {
  it("compares exact kind and action order with normalized key arguments", () => {
    expect(scoreIntent(gold, decision([
      { action: "app.open", args: { name: " SPOTİFY " } },
      { action: "media.key", args: { key: "mute" } },
    ]))).toBe(true);
    expect(scoreIntent(gold, { kind: "reply" })).toBe(false);
    expect(scoreIntent(gold, decision([
      { action: "media.key", args: { key: "mute" } },
      { action: "app.open", args: { name: "Spotify" } },
    ]))).toBe(false);
    expect(scoreIntent(gold, decision([
      { action: "app.open", args: { name: "Spotify" } },
      { action: "media.key", args: { key: "next" } },
    ]))).toBe(false);
  });

  it("requires every gold step and checks typed key arguments", () => {
    expect(scoreIntent(gold, decision([{ action: "app.open", args: { name: "Spotify" } }]))).toBe(false);
    const typed: EvalCommand = {
      utterance: "Write hello without submitting", lang: "en", kind: "plan",
      actions: ["ui.type"], args: { "0": { text: "Hello", submit: false } },
    };
    expect(scoreIntent(typed, decision([{ action: "ui.type", args: { text: "hello", submit: false, target: "Search" } }]))).toBe(true);
    expect(scoreIntent(typed, decision([{ action: "ui.type", args: { text: "hello", submit: true } }]))).toBe(false);
    expect(scoreIntent(typed, decision([{ action: "ui.type", args: { text: "hello" } }]))).toBe(false);
  });

  it("scores conversational, clarification and cancellation labels", () => {
    for (const kind of ["reply", "clarify", "cancel"] as const) {
      const row = { ...gold, kind, actions: [], args: {} };
      expect(scoreIntent(row, { kind })).toBe(true);
      expect(scoreIntent(row, { kind: "plan", goal: "unexpected", steps: [] })).toBe(false);
    }
  });

  it("contains 120 distinct balanced TR/EN commands with compilable gold plans", () => {
    const rows = readFileSync(new URL("../eval/commands.jsonl", import.meta.url), "utf8")
      .trim().split(/\r?\n/).map((line) => EvalCommandSchema.parse(JSON.parse(line)));
    expect(rows).toHaveLength(120);
    expect(new Set(rows.map((row) => row.utterance)).size).toBe(rows.length);
    expect(rows.filter((row) => row.lang === "tr")).toHaveLength(60);
    expect(rows.filter((row) => row.lang === "en")).toHaveLength(60);
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(["reply", "clarify", "cancel", "plan"]));
    for (const row of rows) {
      if (row.kind !== "plan") {
        expect(row.actions).toEqual([]);
        expect(row.args).toEqual({});
        continue;
      }
      expect(row.actions.length).toBeGreaterThan(0);
      expect(row.actions.length).toBeLessThanOrEqual(8);
      expect(Object.keys(row.args)).toEqual(row.actions.map((_, index) => String(index)));
      const compiled = compile(row.actions.map((action, index) => ({ action, args: row.args[index] })));
      expect(compiled.ok, row.utterance).toBe(true);
      if (compiled.ok)
        expect(scoreIntent(row, { kind: "plan", goal: "gold", steps: compiled.steps })).toBe(true);
    }
  });
});
