# ADR 0016: Duplex conversation and live progress

Status: accepted, 2026-10-19. Amends [ADR 0010](0010-model-proposed-typed-plans.md) (spoken
reply timing) and the M1 voice turn model.

## Context

After a spoken command JARVIS often went silent. With the default single worker, a spoken turn
queued behind whatever was running, so during a 60-second agent run or page read it could not
answer at all and timed out. A reply waited up to five seconds for a plan to settle before
saying anything. Long work produced no word until it ended, and an announcement that arrived
while JARVIS was speaking was dropped. The operator asked for JARVIS to keep talking while it
works: say where the research is and where it is looking, and keep the conversation going.

## Decision

1. **Interactive lane.** Spoken turns are `lane: "interactive"` tasks, honoured for the
   operator only. They are claimed ahead of background work, on capacity background work cannot
   take (`INTERACTIVE_CONCURRENCY`, served by interactive-only workers), and outside the
   per-capability limits, which count background work only. `WORKER_CONCURRENCY` defaults to 2
   so a desktop command does not wait for a running research plan either.
2. **Live progress.** Executors may report progress (stage, detail, index, total) through a
   callback; Core keeps it in memory only and clears it when the task leaves `RUNNING`. The
   browser worker streams NDJSON per page when asked (host and position, never page text);
   older workers answer plain JSON. Plan views carry `progress`: the running step, what it
   reported, when it started and when the plan is expected to end.
3. **Measured durations.** Core records how long each action took on this computer (per page
   for page reads) and each spoken-result finisher, and estimates from the median of recent
   runs, starting from catalog defaults. Estimates pace speech and fill in "time left"; nothing
   waits on them and nothing is promised from them.
4. **Spoken acknowledgement.** A turn waits for a plan only when it is expected to finish within
   three seconds, so the reply can say how it ended. Otherwise JARVIS answers at once with what
   it is doing, where it looks and roughly how long, and offers to keep talking.
5. **Narration.** While a long plan runs, Core announces the page or slow step it moved on to,
   paced heartbeats with the time spent and left (overruns admitted) and the moment results are
   composed, from plan views only. "Durum ne?" answers with the step, the page and the time
   left. Working memory gives the model the same facts, and the persona tells it to keep the
   conversation going without claiming results early.
6. **Duplex voice.** The voice service queues announcements instead of dropping them. Outcomes
   are always spoken; progress keeps only the newest line per plan, is dropped once that plan's
   outcome is queued and expires after 12 seconds. Nothing is said while the operator speaks,
   within 1.5 seconds after they stop, or without a short pause after JARVIS's previous
   sentence. The follow-up window opens after announcements as after replies. A turn Core has
   not answered within 1.2 seconds gets a short filler, and the answer follows it.
7. **Speed.** The conversation prompt leads with its stable part (persona, format, catalog,
   enabled integrations), byte-identical across turns and built once per configuration, so
   provider prompt caches reuse it; the Claude adapter marks that boundary as a cache
   breakpoint. Plan bookkeeping reacts only to plan step tasks, polls slower when idle, and
   reads each plan once per pass. Workers share one recovery pass per second instead of one per
   claim and record the routing decision in the intent transaction. Voice models warm up when a
   session opens.

## Consequences

- JARVIS answers, chats and takes new commands while it researches; long work is narrated in
  short template sentences built from Core's records.
- Speech is never generated from executor or page text: progress names hosts and positions, and
  spoken results still come from the existing finishers.
- More concurrent work: background capacity 2 plus up to 2 spoken turns. Per-capability limits
  still bound the browser, desktop and workflow executors.
- Estimates can be wrong; heartbeats say when work takes longer than usual.
- The filler and progress lines add speech; `VOICE_FILLER_SECONDS=0` turns the filler off.
