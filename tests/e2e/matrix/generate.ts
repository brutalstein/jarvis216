import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { catalog } from "@jarvis/action-engine";

// Greedy all-pairs coverage; stable candidate order makes the committed table reproducible.
export function pairwise(dimensions: Record<string, readonly string[]>): Record<string, string>[] {
  let candidates: Record<string, string>[] = [{}];
  for (const [name, values] of Object.entries(dimensions)) {
    if (!values.length) throw new Error(`EMPTY_MATRIX_AXIS:${name}`);
    candidates = candidates.flatMap((row) => values.map((value) => ({ ...row, [name]: value })));
  }
  const pairs = (row: Record<string, string>) => {
    const entries = Object.entries(row);
    return entries.flatMap((left, i) =>
      entries.slice(i + 1).map((right) => JSON.stringify([left, right])),
    );
  };
  const indexed = candidates.map((row) => ({ row, pairs: pairs(row) }));
  const uncovered = new Set(indexed.flatMap((candidate) => candidate.pairs));
  if (!uncovered.size) return candidates;
  const selected: Record<string, string>[] = [];
  while (uncovered.size) {
    let best = indexed[0]!;
    let score = -1;
    for (const candidate of indexed) {
      const count = candidate.pairs.filter((pair) => uncovered.has(pair)).length;
      if (count > score) {
        best = candidate;
        score = count;
      }
    }
    selected.push(best.row);
    for (const pair of best.pairs) uncovered.delete(pair);
  }
  return selected;
}

export function generateCases() {
  return {
    evidence: "Inputs only; execution evidence is recorded by the consuming matrix suites.",
    actions: Object.values(catalog)
      .map(({ id, risk, kind }) => ({ id, risk, kind }))
      .sort((a, b) => a.id.localeCompare(b.id, "en")),
    topology: pairwise({
      desktop: ["off", "on"],
      news: ["off", "on"],
      browser: ["off", "on"],
      openclaw: ["off", "on"],
      n8n: ["off", "on"],
      codex: ["off", "on"],
      language: ["tr", "en", "mixed"],
      load: ["idle", "busy"],
      provider: ["none", "gemini-live", "claude-live", "claude-code", "or-fixture", "nv-fixture"],
    }).map((row, index) => ({ id: `topology-${String(index + 1).padStart(3, "0")}`, ...row })),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = new URL("./coverage.cases.json", import.meta.url);
  const content = `${JSON.stringify(generateCases(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")).replaceAll("\r\n", "\n") !== content)
      throw new Error("MATRIX_CASES_STALE: run npm run matrix:generate");
  } else await writeFile(target, content);
}
