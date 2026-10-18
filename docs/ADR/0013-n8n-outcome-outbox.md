# ADR 0013: n8n task outcomes through a transactional outbox

Status: accepted, 2026-10-18. Extends [ADR 0006](0006-n8n-ingress-boundary.md).

## Context

n8n learned a task's outcome only by polling `GET /v1/hooks/n8n/tasks/:id` in a bounded loop.
Directive §11 asks for durable delivery of important transitions that tolerates duplication,
delay and interruption.

## Decision

1. With `N8N_CALLBACK_URL` and `N8N_CALLBACK_TOKEN` set, every notable transition of a task
   whose principal is `n8n` (completed, failed, cancelled, recovery required, waiting for
   approval, blocked) inserts a `deliveries` row in the same transaction as the transition.
2. A delivery loop posts each event to the registered webhook with the bearer token and a stable
   `eventId` (repeated in `x-jarvis-idempotency-key`). Delivery is at least once: a leased row,
   exponential backoff with jitter from 2 s to 5 min, and dead-lettering after 12 attempts.
   Task change events trigger a pass at once; a one-second poll is the safety net.
3. Only verified completions carry a result. The event repeats what the scoped status endpoint
   already returns to the same principal, so it grants n8n nothing new.
4. As in ADR 0006, no HMAC signing: the token stays in n8n's credential store, publication is
   loopback only and the receiver deduplicates by `eventId`.

## Consequences

- A committed transition is never lost or announced without committing; redelivery is possible
  and the receiver must deduplicate (`examples/n8n/jarvis-task-events.json`).
- A stolen callback token lets its holder receive nothing new but could be used to spoof events
  to the receiver; rotate it with the ingress token.
- Polling keeps working; push is optional.
