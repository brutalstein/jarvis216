# ADR 0011: Measured adaptive routing, durable circuits and usage budgets

Status: accepted, 2026-10-18. Amends [ADR 0007](0007-resilience-circuit-breaker-drain-segmentation.md).

## Context

The registry ranked providers by static priority (or the task's listed order). Directive §6 asks
routing to weigh historical reliability, expected latency and cost budgets, using observations
only when they are statistically meaningful. The circuit breaker lived in process memory and
reset on every restart, and nothing stopped a free tier from being called past its daily quota.

## Decision

1. The gateway records every provider attempt in `provider_observations`, inside the
   transaction that commits its outcome: `success`, `failure` (with its kind, or `timeout`) or
   `neutral`. Operator aborts, lease loss, policy refusals, Core bookkeeping failures and
   environment outcomes an executor observed itself are neutral: they count toward usage, never
   against reliability. Duration and provider-reported tokens are stored with each attempt.
2. Policy filters decide eligibility exactly as before (capability, allowlist, authentication,
   privacy, input size, circuit). Measurements only reorder the eligible (`adaptive-v1`,
   registry version 2):
   - A provider is *degraded* when it has at least 8 attributable attempts in the last day
     (latest 50) and the upper end of the 95% Wilson interval of its success rate is below 0.5.
   - A provider is *too slow* when it has at least 5 successes and its p90 latency exceeds the
     time left before the task's deadline.
   - Demoted providers move behind the others but stay eligible as a last resort. Ties are
     broken by the base order, then the provider id, so the choice is deterministic for a given
     state. Measured speed never reorders healthy providers: the operator's order expresses
     quality and cost preferences.
3. `provider.selected` records the policy, the statistics used and which earlier candidates
   were demoted.
4. At startup Core replays the last day of observations: health, usage and open circuits are
   rebuilt with the same breaker rule as live outcomes. Rows older than 30 days are purged.
5. `PROVIDER_BUDGETS_JSON` sets rolling 24-hour call or token ceilings per provider. A spent
   budget makes that provider ineligible until its usage drops; when no provider is left the
   task is blocked, never routed to a provider outside its allowlist.

## Consequences

- A provider that keeps failing or timing out stops being tried first without operator action,
  and recovers its place as successes return or old attempts leave the window.
- Self-reported confidence plays no part; only Core-observed outcomes count.
- Token budgets are a proxy for spend. Money-denominated caps would need per-model prices and
  remain unimplemented.
- State is per Core process (rebuilt from PostgreSQL); several Core processes would each keep
  their own view.
