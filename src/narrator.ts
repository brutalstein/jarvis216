import { catalog, type Lang, type LiveEvent, mainStep, narrateLive } from "@jarvis/action-engine";
import type { PlanService, PlanView } from "./plans.js";

// Spoken by the voice service between the operator's turns. "progress" may be dropped or
// replaced by a newer one; "outcome" is always spoken.
export type Announcement = {
  text: string;
  lang: Lang;
  kind: "progress" | "outcome";
  planId?: string;
};
type Track = { key: string; saidAt: number; heartbeats: number; composed: boolean };
type Pacing = {
  // Nothing is said this soon after a plan starts: the turn's own reply covers it.
  quietMs: number;
  // Only plans expected (or found) to take at least this long are narrated.
  longMs: number;
  // At least this long between two things said about the same plan.
  gapMs: number;
  // Silence before each heartbeat ("still at it, N seconds, about M left"); the last repeats.
  heartbeatsMs: number[];
  maxHeartbeats: number;
};
const pacing: Pacing = {
  quietMs: 6000,
  longMs: 8000,
  gapMs: 5000,
  heartbeatsMs: [15_000, 25_000, 40_000, 60_000],
  maxHeartbeats: 8,
};
// Steps worth announcing as they start: the ones that wait on something outside the desktop.
const slow = (action: string) => {
  const kind = catalog[action]?.kind;
  return kind === "integration" || kind === "info";
};

// Keeps the operator in the loop while long work runs: the page or step it moved on to, a
// heartbeat with the time spent and left, the moment results are being composed. Built from
// plan views only, so it narrates what Core recorded and nothing else.
export class Narrator {
  #tracks = new Map<string, Track>();
  #views = new Map<string, PlanView>();
  #pacing: Pacing;
  constructor(
    private plans: PlanService,
    private options: { now?: () => number; pacing?: Partial<Pacing> } = {},
  ) {
    this.#pacing = { ...pacing, ...options.pacing };
  }
  start(signal: AbortSignal): void {
    const onPlan = (view: PlanView) => this.observe(view);
    this.plans.on("plan", onPlan);
    const timer = setInterval(() => this.tick(), 1000);
    signal.addEventListener(
      "abort",
      () => {
        this.plans.off("plan", onPlan);
        clearInterval(timer);
      },
      { once: true },
    );
  }

  observe(view: PlanView): void {
    const progress = view.progress;
    if (view.status !== "RUNNING" || !progress) {
      this.#tracks.delete(view.id);
      this.#views.delete(view.id);
      return;
    }
    this.#views.set(view.id, view);
    const key = [progress.step, progress.stage, progress.detail, progress.finishing].join("|");
    const track = this.#tracks.get(view.id);
    if (!track) {
      this.#tracks.set(view.id, {
        key,
        saidAt: progress.startedAt,
        heartbeats: 0,
        composed: false,
      });
      return;
    }
    if (track.key === key) return;
    const previous = track.key.split("|")[0];
    track.key = key;
    const now = this.#now();
    if (!this.#long(view, now) || now - progress.startedAt < this.#pacing.quietMs) return;
    if (progress.finishing) {
      if (!track.composed) {
        track.composed = true;
        this.#say(view, track, { type: "composing" });
      }
      return;
    }
    if (now - track.saidAt < this.#pacing.gapMs) return;
    const step = { action: progress.action, args: progress.args };
    if (progress.stage === "reading" && progress.detail)
      this.#say(view, track, {
        type: "progress",
        step,
        detail: progress.detail,
        ...(progress.index !== undefined && { index: progress.index }),
        ...(progress.total !== undefined && { total: progress.total }),
      });
    else if (previous !== String(progress.step) && !progress.stage && slow(progress.action))
      this.#say(view, track, { type: "progress", step });
  }

  tick(): void {
    const now = this.#now();
    for (const view of this.#views.values()) {
      const track = this.#tracks.get(view.id);
      const progress = view.progress;
      if (!track || !progress || progress.finishing || !this.#long(view, now)) continue;
      if (track.heartbeats >= this.#pacing.maxHeartbeats) continue;
      const { heartbeatsMs } = this.#pacing;
      const wait = heartbeatsMs[Math.min(track.heartbeats, heartbeatsMs.length - 1)] ?? 60_000;
      if (now - track.saidAt < wait || now - progress.startedAt < this.#pacing.quietMs) continue;
      track.heartbeats++;
      const step =
        mainStep(view.steps.slice(progress.step - 1)) ??
        ({ action: progress.action, args: progress.args } as const);
      this.#say(view, track, {
        type: "still",
        step: { action: step.action, args: step.args },
        elapsedMs: now - progress.startedAt,
        ...(progress.etaAt !== undefined && { remainingMs: progress.etaAt - now }),
      });
    }
  }

  #long(view: PlanView, now: number): boolean {
    const progress = view.progress;
    if (!progress) return false;
    const expected = progress.etaAt === undefined ? 0 : progress.etaAt - progress.startedAt;
    return expected >= this.#pacing.longMs || now - progress.startedAt >= this.#pacing.longMs;
  }
  #say(view: PlanView, track: Track, event: LiveEvent): void {
    track.saidAt = this.#now();
    const announcement: Announcement = {
      text: narrateLive(event, view.lang),
      lang: view.lang,
      kind: "progress",
      planId: view.id,
    };
    this.plans.emit("announce", announcement);
  }
  #now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
