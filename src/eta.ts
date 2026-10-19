import { catalog } from "@jarvis/action-engine";
import type { Sql } from "./database.js";

// How long work takes on this computer, learned from what Core measured: per catalog action
// (per page for page reads) and per spoken-result finisher. Estimates for narration and
// pacing only; nothing waits on them and nothing is promised from them.

// Starting points until a few runs were measured.
const defaults: Record<string, number> = {
  "browser.page": 8000,
  "agent.delegate": 45_000,
  "automation.invoke": 15_000,
  "news.brief": 3000,
  "screen.describe": 2500,
  "app.open": 2500,
  "finish:news": 3500,
  "finish:result": 6000,
  "finish:describe": 6000,
};
const kinds: Record<string, number> = {
  desktop: 1500,
  memory: 400,
  info: 3000,
  integration: 15_000,
};

export type Finisher = "news" | "describe" | "result";
// The spoken result composed after the steps (see PlanService#finish).
type StepLike = { action: string; args: Record<string, unknown>; kind?: string };
const kindOf = (step: Pick<StepLike, "action" | "kind">) => step.kind ?? catalog[step.action]?.kind;
export function finisherOf(
  steps: readonly Pick<StepLike, "action" | "kind">[],
): Finisher | undefined {
  if (steps.some((step) => step.action === "news.brief")) return "news";
  if (steps.some((step) => step.action === "screen.describe")) return "describe";
  if (steps.some((step) => kindOf(step) === "integration")) return "result";
  return undefined;
}
// Page reads are measured per page, so one and four pages share what was learned.
export function durationKey(step: Pick<StepLike, "action" | "args">): {
  key: string;
  units: number;
} {
  if (step.action === "browser.read") return { key: "browser.page", units: 1 };
  if (step.action === "browser.read_many")
    return {
      key: "browser.page",
      units: Array.isArray(step.args.pages) ? Math.max(1, step.args.pages.length) : 1,
    };
  return { key: step.action, units: 1 };
}

export class Durations {
  #samples = new Map<string, number[]>();
  constructor(
    private db?: Sql,
    private keep = 20,
  ) {}
  async load(): Promise<void> {
    if (!this.db) return;
    await this.db.query("DELETE FROM step_durations WHERE at<$1", [Date.now() - 30 * 86_400_000]);
    const rows = (
      await this.db.query<{ key: string; ms: number }>(
        "SELECT key, ms FROM (SELECT key, ms, at, id, row_number() OVER (PARTITION BY key ORDER BY at DESC, id DESC) AS n FROM step_durations) recent WHERE n <= $1 ORDER BY at, id",
        [this.keep],
      )
    ).rows;
    for (const row of rows) this.#push(row.key, Number(row.ms));
  }
  // One measured run, in milliseconds per unit.
  record(key: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || ms > 600_000) return;
    const value = Math.round(ms);
    this.#push(key, value);
    void this.db
      ?.query("INSERT INTO step_durations(key, ms, at) VALUES($1,$2,$3)", [key, value, Date.now()])
      .catch(() => {});
  }
  // Median of recent runs; with fewer than three, blended with the starting point.
  estimate(key: string, fallback = 3000): number {
    const start = defaults[key] ?? fallback;
    const samples = this.#samples.get(key) ?? [];
    if (samples.length >= 3) {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? start;
    }
    return Math.round((start * (3 - samples.length) + samples.reduce((a, b) => a + b, 0)) / 3);
  }
  step(step: StepLike): number {
    const { key, units } = durationKey(step);
    return this.estimate(key, kinds[kindOf(step) ?? ""] ?? 3000) * units;
  }
  finisher(kind: Finisher | undefined): number {
    return kind ? this.estimate(`finish:${kind}`) : 0;
  }
  // The whole plan from its first step to the spoken result.
  plan(steps: readonly StepLike[]): number {
    return steps.reduce((sum, step) => sum + this.step(step), 0) + this.finisher(finisherOf(steps));
  }
  #push(key: string, ms: number): void {
    const samples = this.#samples.get(key) ?? [];
    samples.push(ms);
    if (samples.length > this.keep) samples.shift();
    this.#samples.set(key, samples);
  }
}
