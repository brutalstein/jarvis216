import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { type Announcement, Narrator } from "../src/services/narrator.js";
import type { PlanProgress, PlanService, PlanView } from "../src/services/plans/index.js";

const pages = [
  { url: "https://www.reuters.com/", expectedText: "Reuters" },
  { url: "https://bbc.com/", expectedText: "BBC" },
  { url: "https://apnews.com/", expectedText: "AP" },
];
function view(progress: Partial<PlanProgress> | undefined, status: PlanView["status"] = "RUNNING") {
  return {
    id: "p1",
    goal: "Haberleri araştır",
    lang: "tr",
    kind: "integration",
    status,
    hash: "h",
    needsApproval: false,
    expiresAt: 0,
    steps: [
      {
        action: "browser.read_many",
        args: { pages },
        risk: "LOW",
        mode: "allow",
        status: "RUNNING",
      },
    ],
    panels: [],
    ...(progress && {
      progress: {
        step: 1,
        steps: 1,
        action: "browser.read_many",
        args: { pages },
        startedAt: 0,
        etaAt: 30_000,
        ...progress,
      },
    }),
  } as PlanView;
}
function setup(etaAt = 30_000) {
  let now = 0;
  const plans = new EventEmitter() as unknown as PlanService;
  const said: Announcement[] = [];
  plans.on("announce", (announcement: Announcement) => said.push(announcement));
  const narrator = new Narrator(plans, { now: () => now });
  const at = (ms: number, progress?: Partial<PlanProgress>, status?: PlanView["status"]) => {
    now = ms;
    if (progress !== undefined || status)
      narrator.observe(view(progress && { etaAt, ...progress }, status));
    narrator.tick();
  };
  return { at, said };
}

describe("live narrator", () => {
  it("stays quiet while the reply speaks, then says which page it moved on to", () => {
    const { at, said } = setup();
    at(0, { stage: "opening", detail: "reuters.com", index: 1, total: 3 });
    at(1000, { stage: "reading", detail: "reuters.com", index: 1, total: 3 });
    expect(said).toEqual([]);
    at(7000, { stage: "reading", detail: "bbc.com", index: 2, total: 3 });
    expect(said).toEqual([
      {
        text: "Şimdi bbc.com sayfasını okuyorum; 1 sayfa daha var.",
        lang: "tr",
        kind: "progress",
        planId: "p1",
      },
    ]);
    // Too soon after the last thing it said: the next page is left to the heartbeat.
    at(9000, { stage: "reading", detail: "apnews.com", index: 3, total: 3 });
    expect(said).toHaveLength(1);
  });

  it("heartbeats with time spent and left, slowing down, then says it is composing", () => {
    const { at, said } = setup(40_000);
    at(0, { stage: "reading", detail: "reuters.com", index: 1, total: 3 });
    for (let ms = 1000; ms <= 15_000; ms += 1000) at(ms);
    expect(said.map((s) => s.text)).toEqual([
      "Hâlâ sayfaları okuyorum, efendim; 15 saniye oldu, yaklaşık 25 saniye kaldı.",
    ]);
    for (let ms = 16_000; ms <= 40_000; ms += 1000) at(ms);
    expect(said).toHaveLength(2);
    expect(said[1]?.text).toContain("40 saniye oldu");
    at(41_000, { finishing: true, etaAt: 47_000 });
    at(42_000, { finishing: true, etaAt: 47_000 });
    expect(said.at(-1)?.text).toBe("Topladıklarımı derliyorum, efendim.");
    expect(said.filter((s) => s.text.startsWith("Topladıklarımı"))).toHaveLength(1);
  });

  it("never narrates quick plans and forgets plans that ended", () => {
    const { at, said } = setup(4000);
    at(0, { stage: "reading", detail: "reuters.com", index: 1, total: 3 });
    at(3000, { stage: "reading", detail: "bbc.com", index: 2, total: 3 });
    at(4500, undefined, "COMPLETED");
    for (let ms = 5000; ms <= 30_000; ms += 1000) at(ms);
    expect(said).toEqual([]);
  });
});
