# ADR 0006: n8n ingress boundary

Status: accepted, 2026-10-17

## Decision

- n8n uses a dedicated `N8N_INGRESS_TOKEN`, compared in constant time. It can only create a
  restricted task shape and read results of tasks it created; it cannot reach operator routes.
- Each event carries `eventId` and `sentAt`. Requests outside a five-minute window are rejected.
  The event ID is the idempotency key; the same ID with a different payload returns a conflict.
- Ingress tasks are private, so any external provider needs operator approval.
- A per-principal queue cap (100 queued) limits flooding.

HMAC request signing was not chosen: n8n's HTTP Request node has no built-in signing, and a
Code-node implementation would put the secret in workflow code. The bearer token stays inside
n8n's encrypted credential store. With loopback binding and segmented networks, replay risk is
bounded by the timestamp window and durable idempotency.

## Consequences

A stolen ingress token allows scoped task admission until rotated. n8n retries that
re-evaluate `$now` change the payload and fail closed with a conflict.
