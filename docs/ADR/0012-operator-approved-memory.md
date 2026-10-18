# ADR 0012: Operator-approved long-term memory

Status: accepted, 2026-10-18. Amended by [ADR 0014](0014-operator-standing-permissions.md):
the memory actions are always offered unless turned off in Settings, and run without a tap when
allowed there.

## Context

Directive §12 separates user-approved long-term memory from conversation history, task context
and logs. JARVIS kept only 30 days of addressed turns, so "remember that ..." could only be
refused. Memory that a model writes freely would let one injected utterance plant instructions
in every later prompt.

## Decision

1. Two catalog actions, `memory.save(note)` and `memory.forget(about)`, both MEDIUM. A note is
   saved or forgotten only through a plan the operator approves with one tap. Voice can still
   cancel, never approve. The actions are offered to the model only with `ENABLE_MEMORY=true`.
2. Notes that hold credentials are refused: key-shaped tokens, card-length digit runs, and
   words announcing a password, PIN or IBAN. Notes are deduplicated by normalized text and
   capped at 200.
3. The newest notes, at most 3000 characters, enter the conversation prompt under a heading
   that marks them as data, not instructions. They reach the conversation providers under the
   existing `personal` consent.
4. Notes live in their own table and are kept until the operator forgets them, by voice or with
   `DELETE /v1/memories[/:id]`. Conversation deletion and the 30-day retention do not touch them.

## Consequences

- An injected utterance can at most propose a note; the approval card shows it before it exists.
- Forgetting by topic deletes every note containing all of its words; review with
  `GET /v1/memories` when in doubt.
- The credential filter is heuristic. It stops the common shapes, not every secret.
