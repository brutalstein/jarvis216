import { CoreError, type Executor, type Progress, type Task, taskDeadline } from "./contracts.js";
import { type Budget, type Observation, ReliabilityTracker } from "./reliability.js";

export class ProviderFailure extends Error {
  constructor(
    public kind:
      | "transient"
      | "permanent"
      | "policy-denied"
      | "authentication-required"
      | "rate-limited"
      | "provider-unavailable"
      | "invalid-response",
    public retryable: boolean,
    // false only when the request provably never reached the service (no side effect).
    public dispatched = true,
  ) {
    super(kind);
  }
}
export interface Provider extends Executor {
  authenticated: boolean;
  enabled: boolean;
  maxInputChars: number;
  priority: number;
  configuration?: string;
}
export type SelectionReason = Record<string, string | number | boolean | null>;
// Availability failures that say nothing about the request itself.
const outageKinds = new Set(["transient", "rate-limited", "provider-unavailable"]);
const circuitThreshold = 3;
const circuitCooldownMs = 60_000;
const rounded = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 1000);

export class ProviderRegistry {
  readonly version = 2;
  readonly policy = "adaptive-v1";
  // Per-process breaker state, rebuilt from durable observations at startup; it only skips a
  // provider, it never grants or widens access.
  private circuits = new Map<string, { failures: number; openUntil: number }>();
  private tracker = new ReliabilityTracker();
  private budgets: Readonly<Record<string, Budget>>;
  constructor(
    private providers: Provider[],
    private now: () => number = Date.now,
    options: { budgets?: Readonly<Record<string, Budget>> } = {},
  ) {
    if (new Set(providers.map((p) => p.id)).size !== providers.length)
      throw new CoreError("DUPLICATE_PROVIDER");
    this.budgets = options.budgets ?? {};
  }
  private open(id: string): boolean {
    return (this.circuits.get(id)?.openUntil ?? 0) > this.now();
  }
  // A configured daily call or token budget is spent: skip the provider until it recovers.
  private exhausted(id: string): boolean {
    const budget = Object.hasOwn(this.budgets, id) ? this.budgets[id] : undefined;
    if (!budget) return false;
    const used = this.tracker.usage(id, this.now());
    return (
      (budget.callsPerDay !== undefined && used.calls >= budget.callsPerDay) ||
      (budget.tokensPerDay !== undefined && used.tokens >= budget.tokensPerDay)
    );
  }
  // Called after the gateway committed an observation.
  record(observation: Observation): void {
    this.tracker.record(observation);
  }
  // Replays durable observations (oldest first) so health, usage and open circuits survive a
  // restart; the breaker rule is the same as for live outcomes.
  hydrate(observations: Observation[]): void {
    for (const observation of observations) this.tracker.record(observation);
    const now = this.now();
    for (const { id } of this.providers) {
      let circuit = { failures: 0, openUntil: 0 };
      for (const attempt of this.tracker.history(id, now)) {
        if (attempt.outcome === "success") circuit = { failures: 0, openUntil: 0 };
        else if (outageKinds.has(attempt.kind)) {
          circuit.failures++;
          if (circuit.failures >= circuitThreshold)
            circuit.openUntil = attempt.observedAt + circuitCooldownMs;
        }
      }
      if (circuit.failures) this.circuits.set(id, circuit);
    }
  }
  list(): object[] {
    const now = this.now();
    return this.providers.map(
      ({
        id,
        capability,
        authenticated,
        enabled,
        maxInputChars,
        priority,
        external,
        riskFloor,
        outputTokenLimitEnforced,
        trustedForPrivate,
      }) => {
        const health = this.tracker.health(id, now);
        const budget = Object.hasOwn(this.budgets, id) ? this.budgets[id] : undefined;
        return {
          id,
          capability,
          authenticated,
          enabled,
          maxInputChars,
          priority,
          external,
          riskFloor: riskFloor ?? "LOW",
          trustedForPrivate: trustedForPrivate ?? false,
          ...(outputTokenLimitEnforced !== undefined ? { outputTokenLimitEnforced } : {}),
          circuitOpen: this.open(id),
          reliability: { ...health, successRate: rounded(health.successRate) },
          usage24h: this.tracker.usage(id, now),
          ...(budget && { budget, budgetExhausted: this.exhausted(id) }),
          registryVersion: this.version,
          routingPolicy: this.policy,
        };
      },
    );
  }
  select(task: Task, attempted: string[]): Provider {
    return this.choose(task, attempted).provider;
  }
  // Policy filters decide who may run; measurements only reorder the eligible. A provider that
  // fails more often than not with statistical confidence, or whose p90 latency exceeds the
  // time left, moves behind the others but stays available as a last resort. Deterministic for
  // a given state: base order, then id, breaks every tie.
  choose(task: Task, attempted: string[]): { provider: Provider; reason: SelectionReason } {
    const now = this.now();
    const candidates = this.providers.filter(
      (p) =>
        p.enabled &&
        p.authenticated &&
        !this.open(p.id) &&
        !this.exhausted(p.id) &&
        p.capability === task.spec.capability &&
        task.spec.providers.includes(p.id) &&
        !attempted.includes(p.id) &&
        task.spec.objective.length + JSON.stringify(task.spec.input).length <= p.maxInputChars &&
        !(task.spec.privacy === "local-only" && p.external),
    );
    const remainingMs = taskDeadline(task) - now;
    const health = new Map(candidates.map((p) => [p.id, this.tracker.health(p.id, now)]));
    const slow = (p: Provider) => {
      const p90 = health.get(p.id)?.p90Ms;
      return p90 !== null && p90 !== undefined && p90 > remainingMs;
    };
    const demotion = (p: Provider) => (health.get(p.id)?.degraded ? 2 : 0) + (slow(p) ? 1 : 0);
    const rank = (p: Provider) =>
      task.spec.providerOrder === "listed" ? task.spec.providers.indexOf(p.id) : p.priority;
    const byId = (a: Provider, b: Provider) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const base = [...candidates].sort((a, b) => rank(a) - rank(b) || byId(a, b));
    const ordered = [...base].sort(
      (a, b) => demotion(a) - demotion(b) || rank(a) - rank(b) || byId(a, b),
    );
    const selected = ordered[0];
    if (!selected) throw new CoreError("NO_COMPATIBLE_PROVIDER");
    const chosen = health.get(selected.id);
    const demoted = base.slice(0, base.indexOf(selected)).map((p) => p.id);
    return {
      provider: {
        ...selected,
        execute: (t, signal, progress) => this.observe(selected, t, signal, progress),
      },
      reason: {
        provider: selected.id,
        registryVersion: this.version,
        routing: this.policy,
        reason: demoted.length
          ? "measured reliability or latency demoted earlier candidates"
          : "capability, auth, privacy, context, allowlist, budget and priority matched",
        demoted: demoted.join(","),
        samples: chosen?.samples ?? 0,
        successRate: rounded(chosen?.successRate ?? null),
        p90Ms: chosen?.p90Ms ?? null,
      },
    };
  }
  private async observe(
    provider: Provider,
    task: Task,
    signal: AbortSignal,
    progress?: (update: Progress) => void,
  ) {
    try {
      const result = await provider.execute(task, signal, progress);
      this.circuits.delete(provider.id);
      return result;
    } catch (error) {
      if (error instanceof ProviderFailure && outageKinds.has(error.kind)) {
        const circuit = this.circuits.get(provider.id) ?? { failures: 0, openUntil: 0 };
        // Failures are not reset on opening: after cooldown one more outage reopens it.
        circuit.failures++;
        if (circuit.failures >= circuitThreshold)
          circuit.openUntil = this.now() + circuitCooldownMs;
        this.circuits.set(provider.id, circuit);
      }
      throw error;
    }
  }
}
