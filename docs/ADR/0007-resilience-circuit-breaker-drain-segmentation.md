# ADR 0007: Circuit breaker, graceful drain and network segmentation

Status: accepted, 2026-10-17

## Decision

- Circuit breaker per provider, in process: three outage-class failures (transient, rate
  limited, unavailable) open it for 60 seconds; a success closes it; after cooldown one more
  outage reopens it. Routing skips open circuits. No shared state across processes: this is a
  single-process deployment.
- Worker leases last 30 seconds and renew every 10 seconds. A failed renewal is retried while
  the lease is valid. On shutdown the worker stops claiming and waits up to 20 seconds before
  aborting in-flight actions; aborted executing actions are quarantined, not replayed.
- Compose networks: `data` (PostgreSQL, Core), `automation` (n8n, Core), `browser` (browser
  worker, Core). PostgreSQL is not published by default because Docker 28+ accepts a published
  container port from every bridge network (observed live on Docker 29.8.2: n8n reached the
  published PostgreSQL port by IP; after unpublishing, the connection timed out).
  `compose.dev.yaml` publishes it on loopback for development only.

## Consequences

- A restart resets circuit state; a second Core process would keep its own circuits.
- Network segmentation removes name resolution and unpublished-port access between peers. It
  does not block loopback-published ports (Core, n8n), and it is not an egress policy for the
  browser worker.
