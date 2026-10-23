import { readFile } from "node:fs/promises";
import { catalog } from "@jarvis/action-engine";
import { describe, expect, it } from "vitest";
import { generateCases, pairwise, permissionPolicies } from "./generate.js";

describe("reviewable matrix generation", () => {
  it("covers every value pair while reducing the Cartesian product", () => {
    const dimensions = {
      desktop: ["off", "on"],
      browser: ["off", "on"],
      language: ["tr", "en", "mixed"],
      load: ["idle", "busy"],
    };
    const rows = pairwise(dimensions);
    const entries = Object.entries(dimensions);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [left, leftValues] = entries[i]!;
        const [right, rightValues] = entries[j]!;
        for (const a of leftValues)
          for (const b of rightValues)
            expect(rows.some((row) => row[left] === a && row[right] === b)).toBe(true);
      }
    }
    expect(rows.length).toBeLessThan(24);
    expect(rows).toEqual(pairwise(dimensions));
    expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(rows.length);
  });

  it("keeps single dimensions and rejects an axis with no possible value", () => {
    expect(pairwise({ language: ["tr", "en"] })).toEqual([{ language: "tr" }, { language: "en" }]);
    expect(() => pairwise({ language: [] })).toThrow("EMPTY_MATRIX_AXIS:language");
  });

  it("records every catalog action and keeps the checked-in table current", async () => {
    const generated = generateCases();
    expect(generated.actions.map((action) => action.id)).toEqual(Object.keys(catalog).sort());
    expect(generated.actions).toHaveLength(43);
    expect(
      generated.actions.filter((action) => action.risk === "HIGH").map((action) => action.id),
    ).toEqual([
      "agent.delegate",
      "agent.execute",
      "automation.invoke",
      "browser.click",
      "file.delete",
      "github.issue_create",
    ]);
    expect(new Set(generated.topology.map((row) => row.id)).size).toBe(generated.topology.length);
    expect(new Set(generated.permissions.map((row) => row.id)).size).toBe(
      generated.permissions.length,
    );
    for (const policy of permissionPolicies())
      expect(
        generated.permissions
          .filter((row) => row.policy === policy.id)
          .map((row) => row.action)
          .sort(),
      ).toEqual(Object.keys(catalog).sort());
    expect(
      JSON.parse(await readFile(new URL("./coverage.cases.json", import.meta.url), "utf8")),
    ).toEqual(generated);
  });
});
