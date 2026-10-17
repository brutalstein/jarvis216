import { CoreError, type Executor, type Task } from "./contracts.js";

export class ProviderFailure extends Error {
  constructor(
    public kind:
      | "transient"
      | "permanent"
      | "authentication-required"
      | "rate-limited"
      | "provider-unavailable"
      | "invalid-response",
    public retryable: boolean,
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
export class ProviderRegistry {
  readonly version = 1;
  constructor(private providers: Provider[]) {
    if (new Set(providers.map((p) => p.id)).size !== providers.length)
      throw new CoreError("DUPLICATE_PROVIDER");
  }
  list(): object[] {
    return this.providers.map(
      ({ id, capability, authenticated, enabled, maxInputChars, priority, external }) => ({
        id,
        capability,
        authenticated,
        enabled,
        maxInputChars,
        priority,
        external,
        registryVersion: this.version,
      }),
    );
  }
  select(task: Task, attempted: string[]): Provider {
    const candidates = this.providers.filter(
      (p) =>
        p.enabled &&
        p.authenticated &&
        p.capability === task.spec.capability &&
        task.spec.providers.includes(p.id) &&
        !attempted.includes(p.id) &&
        task.spec.objective.length + JSON.stringify(task.spec.input).length <= p.maxInputChars &&
        !(task.spec.privacy === "local-only" && p.external),
    );
    candidates.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const selected = candidates[0];
    if (!selected) throw new CoreError("NO_COMPATIBLE_PROVIDER");
    return selected;
  }
}
