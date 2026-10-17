# Recovery and operations

`COMPLETED` means the declared deterministic output criterion matched. It does not mean a
model's business or engineering assertions were independently proved. Inspect action evidence.

| Failure | Core behavior | Operator action |
| --- | --- | --- |
| PostgreSQL outage/reconnect | Current transaction rolls back; worker logs a code and retries its bounded service cycle | Restore DB; inspect expired leases and intents |
| Worker/host restart before intent | Lease expires; task can become READY | No external action was intended |
| Crash after intent / partial external success | RECOVERY_REQUIRED and UNCERTAIN action | Read external system; reconcile exact action; never resubmit blindly |
| Late worker result | Fence/lease rejects authoritative commit | Reconcile uncertain external result |
| Claude server error / Gemini rate limit | Only known retry-safe failure permits another allowed provider; bounded backoff+jitter | Same privacy, calls and total deadline remain binding |
| Auth failure / invalid model response / context exhaustion | No privilege expansion; fail or BLOCKED | Correct configuration; resume eligible BLOCKED task |
| OpenClaw / n8n / browser failure | Conservative uncertainty after intent; no automatic replay | Check external execution or session before reconciliation |
| Cancellation during action | Local abort, commit fencing, RECOVERY_REQUIRED | Remote termination is not assumed confirmed |
| Approval expires | Action cannot dispatch; task waits until total deadline | Grant a new exact unconsumed approval while budget remains |
| Approval rejected | Task CANCELLED; action DENIED | Submit a different explicitly authorized task if needed |
| Dependency is uncertain/blocked | Child remains waiting | Reconcile/resume parent; child becomes eligible after completion |
| Dependency finally fails/cancels | Child BLOCKED; expires at task deadline | Fix objective by submitting an intentional replacement plan |
| Duplicate or changed webhook | Same event returns same task; changed payload returns conflict | Preserve original event ID, sentAt and parameters on retry |
| Reordered messages | Core owns state; ordered sequence cursor is authoritative | Resume reads after the last sequence, deduplicate message IDs |
| Redis outage | No effect on Core, which does not use Redis | If n8n queue mode is added, recover its queue separately |
| Conflicting agent recommendations | Neither recommendation authorizes a new action | Operator decides through a new typed task |

Total wall-clock budget starts at admission and includes queueing, approval and fallback.
Never turn a timeout into an automatic retry of an uncertain operation.

Commands (PowerShell, `.env` already prepared):

```powershell
npm run cli -- get TASK_ID
npm run cli -- actions TASK_ID
npm run cli -- events TASK_ID
npm run cli -- cancel TASK_ID
npm run cli -- approve ACTION_ID
# Reconciliation JSON: {"outcome":"COMPLETED","evidence":"...declared criterion..."}
npm run cli -- reconcile ACTION_ID .\reconciliation.json
```

Use the authenticated HTTP `POST /v1/tasks/:id/resume` or `POST /v1/actions/:id/reject`
for explicit resume/rejection. No endpoint deletes history or directly sets arbitrary states.

## Data recovery

`scripts/backup.ps1` creates and verifies a full Git bundle of committed repository history.
It does not contain `.env`, provider credentials, uncommitted files or database volumes.
Keep a separately encrypted copy of `.env` and export PostgreSQL to a protected destination
using `pg_dump --format=custom`; restore into a separate local database and run the recovery
suite before switching authority. Protect n8n's own volume and encryption key separately.
Do not use `docker compose down -v` on valued data. `docker compose down` retains volumes.

Context entries expire within seven days and are pruned by worker recovery. Audit/task/action
records are retained for operator review; automated archive/deletion and restore drills remain
deployment gates. Do not delete event history as a substitute for reconciliation.
