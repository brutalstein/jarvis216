import { CoreError, type Executor, type Task } from "./contracts.js";

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
// Availability failures that say nothing about the request itself.
const outageKinds = new Set(["transient", "rate-limited", "provider-unavailable"]);
const circuitThreshold = 3;
const circuitCooldownMs = 60_000;

export class ProviderRegistry {
  readonly version = 1;
  // Per-process breaker state; it only skips a provider, it never grants or widens access.
  private circuits = new Map<string, { failures: number; openUntil: number }>();
  constructor(
    private providers: Provider[],
    private now: () => number = Date.now,
  ) {
    if (new Set(providers.map((p) => p.id)).size !== providers.length)
      throw new CoreError("DUPLICATE_PROVIDER");
  }
  private open(id: string): boolean {
    return (this.circuits.get(id)?.openUntil ?? 0) > this.now();
  }
  list(): object[] {
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
      }) => ({
        id,
        capability,
        authenticated,
        enabled,
        maxInputChars,
        priority,
        external,
        riskFloor: riskFloor ?? "LOW",
        ...(outputTokenLimitEnforced !== undefined ? { outputTokenLimitEnforced } : {}),
        circuitOpen: this.open(id),
        registryVersion: this.version,
      }),
    );
  }
  select(task: Task, attempted: string[]): Provider {
    const candidates = this.providers.filter(
      (p) =>
        p.enabled &&
        p.authenticated &&
        !this.open(p.id) &&
        p.capability === task.spec.capability &&
        task.spec.providers.includes(p.id) &&
        !attempted.includes(p.id) &&
        task.spec.objective.length + JSON.stringify(task.spec.input).length <= p.maxInputChars &&
        !(task.spec.privacy === "local-only" && p.external),
    );
    candidates.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const selected = candidates[0];
    if (!selected) throw new CoreError("NO_COMPATIBLE_PROVIDER");
    return { ...selected, execute: (t, signal) => this.observe(selected, t, signal) };
  }
  private async observe(provider: Provider, task: Task, signal: AbortSignal) {
    try {
      const result = await provider.execute(task, signal);
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
