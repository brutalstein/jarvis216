import type { Capability } from "./contracts.js";
import type { Sql } from "./database.js";

// One provider attempt as Core saw it. Neutral attempts (operator cancel, lease loss, policy
// refusal, an outcome the executor observed in the environment) count toward usage only.
export type Observation = {
  provider: string;
  capability: Capability;
  outcome: "success" | "failure" | "neutral";
  kind: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  observedAt: number;
};
export type Health = {
  samples: number;
  successRate: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  degraded: boolean;
};
export type Usage = { calls: number; tokens: number };
export type Budget = { callsPerDay?: number; tokensPerDay?: number };

const dayMs = 86_400_000;
// Reliability looks at the latest attributable attempts of the last day only.
const windowSize = 50;
// Below these sample counts an observation is anecdote, not evidence.
export const minReliabilitySamples = 8;
export const minLatencySamples = 5;

// Upper end of the 95% Wilson score interval: below 0.5 means "fails more often than not"
// with statistical confidence, not merely an unlucky streak.
export function wilsonUpper(successes: number, samples: number, z = 1.96): number {
  if (samples === 0) return 1;
  const p = successes / samples;
  const z2 = z * z;
  const denominator = 1 + z2 / samples;
  const center = p + z2 / (2 * samples);
  const margin = z * Math.sqrt((p * (1 - p)) / samples + z2 / (4 * samples * samples));
  return (center + margin) / denominator;
}
// Nearest-rank percentile of an ascending list.
function percentile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? null;
}

export async function recordObservation(tx: Sql, observation: Observation): Promise<void> {
  await tx.query(
    "INSERT INTO provider_observations(provider,capability,outcome,kind,duration_ms,input_tokens,output_tokens,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      observation.provider,
      observation.capability,
      observation.outcome,
      observation.kind,
      Math.max(0, Math.round(observation.durationMs)),
      observation.inputTokens ?? null,
      observation.outputTokens ?? null,
      observation.observedAt,
    ],
  );
}

// Oldest first, so replaying them rebuilds the same in-memory state as live recording.
export async function loadObservations(db: Sql, since: number): Promise<Observation[]> {
  const rows = (
    await db.query<{
      provider: string;
      capability: Capability;
      outcome: Observation["outcome"];
      kind: string;
      duration_ms: number;
      input_tokens: number | null;
      output_tokens: number | null;
      observed_at: string | number;
    }>(
      "SELECT provider,capability,outcome,kind,duration_ms,input_tokens,output_tokens,observed_at FROM provider_observations WHERE observed_at>$1 ORDER BY observed_at,id",
      [since],
    )
  ).rows;
  return rows.map((row) => ({
    provider: row.provider,
    capability: row.capability,
    outcome: row.outcome,
    kind: row.kind,
    durationMs: Number(row.duration_ms),
    ...(row.input_tokens !== null && { inputTokens: Number(row.input_tokens) }),
    ...(row.output_tokens !== null && { outputTokens: Number(row.output_tokens) }),
    observedAt: Number(row.observed_at),
  }));
}

export async function purgeObservations(db: Sql, olderThan: number): Promise<void> {
  await db.query("DELETE FROM provider_observations WHERE observed_at<$1", [olderThan]);
}

// In-memory rolling view per provider; PostgreSQL holds the durable record it is rebuilt from.
export class ReliabilityTracker {
  private attempts = new Map<string, Observation[]>();
  private spending = new Map<string, { at: number; tokens: number }[]>();

  record(observation: Observation): void {
    const cutoff = observation.observedAt - dayMs;
    const spent = (this.spending.get(observation.provider) ?? []).filter((e) => e.at > cutoff);
    spent.push({
      at: observation.observedAt,
      tokens: (observation.inputTokens ?? 0) + (observation.outputTokens ?? 0),
    });
    this.spending.set(observation.provider, spent);
    if (observation.outcome === "neutral") return;
    const recent = (this.attempts.get(observation.provider) ?? []).filter(
      (o) => o.observedAt > cutoff,
    );
    recent.push(observation);
    this.attempts.set(observation.provider, recent.slice(-windowSize));
  }

  // Attributable attempts of the last day, oldest first.
  history(provider: string, now: number): Observation[] {
    return (this.attempts.get(provider) ?? []).filter((o) => o.observedAt > now - dayMs);
  }

  health(provider: string, now: number): Health {
    const recent = this.history(provider, now);
    const successes = recent.filter((o) => o.outcome === "success");
    const latencies = successes.map((o) => o.durationMs).sort((a, b) => a - b);
    return {
      samples: recent.length,
      successRate: recent.length ? successes.length / recent.length : null,
      p50Ms: latencies.length >= minLatencySamples ? percentile(latencies, 0.5) : null,
      p90Ms: latencies.length >= minLatencySamples ? percentile(latencies, 0.9) : null,
      degraded:
        recent.length >= minReliabilitySamples &&
        wilsonUpper(successes.length, recent.length) < 0.5,
    };
  }

  usage(provider: string, now: number): Usage {
    const spent = (this.spending.get(provider) ?? []).filter((e) => e.at > now - dayMs);
    return { calls: spent.length, tokens: spent.reduce((sum, e) => sum + e.tokens, 0) };
  }
}
