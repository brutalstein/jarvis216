# ADR 0015: A learning brain and a layered intent pipeline

Status: accepted, 2026-10-18.

## Context

Every spoken request went through one model call with the last few turns as context. JARVIS did
not get better with use: a request it had handled correctly twenty times still took a model call,
corrections taught nothing, and the model knew nothing of Core's current state beyond the
transcript. The operator asked for an intent layer that continues sensibly after understanding and
a brain that keeps improving.

## Decision

`packages/brain` (`@jarvis/brain`) is a learning memory with a storage port; Core stores it in
PostgreSQL (migration 9). It never executes or authorizes anything.

- **Episodic memory.** Every understood request is an experience. A plan's real outcome
  (completed, failed, recovery required) and spoken corrections are its reinforcement signal;
  cancellation is neutral; stopping on several on-screen matches is ambiguity, not failure.
- **Procedural memory.** Two successes of the same plan consolidate into a skill. Successes
  strengthen it (rate 0.3), failures and corrections weaken it faster (0.5). Strength decays with
  a half-life of 14 days × (1 + log2(1 + successes)); faded skills are forgotten during
  consolidation ("sleep", at startup and every 30 minutes, or on request).
- **Recall.** Similar requests that worked are given to the model as examples: BM25 keyword
  recall (MiniSearch 7.2.0) fused by reciprocal rank with optional Gemini embeddings
  (`BRAIN_EMBEDDINGS=gemini`). Examples with actions that are turned off or unavailable are
  dropped.
- **Reflexes.** A practised phrase (3+ successes, a success streak of 2+, effective strength
  ≥ 0.75) without context-dependent words ("onu", "tekrar", "it", "again") runs its learned plan
  without a model call. It is compiled against the catalog and goes through permissions,
  approvals and the gateway like any plan.
- **Learned choices.** The operator's pick among on-screen candidates is reused in exactly the
  same situation (target and candidate set) and dropped after a correction.

The conversation turn becomes layered: Core reflexes (stop, status question, candidate choice) →
correction signal → learned reflex → deliberation (one JSON-mode model call with working memory,
long-term notes and learned examples; one repair) → policy (turned-off actions are refused, a
plan with confidence below 0.5 becomes a question) → plan → learning. After an agent or page read
JARVIS speaks a summary of what came back.

Settings switch learning and reflexes; conversation deletion forgets everything learned;
experiences follow the 30-day transcript retention.

## Consequences

- Routine requests get faster and more consistent with use, and stop when they start failing.
- The brain can only propose; a poisoned memory cannot widen permissions. The worst case is a
  wrong learned plan proposed for a practised phrase, which permissions, approvals and corrections
  bound.
- Skills keep normalized trigger phrases beyond 30 days until they fade or are forgotten.
- Learning state is per Core process, rebuilt from PostgreSQL at startup.
