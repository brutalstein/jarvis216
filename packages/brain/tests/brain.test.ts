import { describe, expect, it } from "vitest";
import { Brain, signature } from "../src/brain.js";
import { MemoryBrainStore } from "../src/store.js";
import { contextDependent, utteranceKey } from "../src/text.js";
import type { Embedder, IntentRecord } from "../src/types.js";

const day = 86_400_000;
const spotify: IntentRecord = {
  kind: "plan",
  goal: "Spotify'ı aç",
  steps: [{ action: "app.open", args: { name: "Spotify" } }],
};
const notepad: IntentRecord = {
  kind: "plan",
  goal: "Not Defteri'ni kapat",
  steps: [{ action: "app.close", args: { name: "Not Defteri" } }],
};
function setup(options: { embed?: Embedder } = {}) {
  let now = 1_000_000_000_000;
  const store = new MemoryBrainStore();
  const brain = new Brain(store, { now: () => now, ...options });
  return {
    store,
    brain,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
// One request understood as `intent` that ended with `outcome`.
async function practise(
  brain: Brain,
  utterance: string,
  intent: IntentRecord,
  outcome: "success" | "failure" | "corrected" = "success",
  source: "model" | "reflex" = "model",
) {
  const experience = await brain.experience({ utterance, lang: "tr", intent, source });
  await brain.outcome(experience.id, outcome);
  return experience;
}

describe("text", () => {
  it("keys an utterance without the name, politeness or diacritics", () => {
    expect(utteranceKey("Jarvis, Spotify'ı aç lütfen!")).toBe("spotifyi ac");
    expect(utteranceKey("JARVİS  ŞARKIYI   DURDUR")).toBe("sarkiyi durdur");
  });
  it("marks context-dependent requests", () => {
    expect(contextDependent(utteranceKey("Jarvis onu kapat"))).toBe(true);
    expect(contextDependent(utteranceKey("do it again"))).toBe(true);
    expect(contextDependent(utteranceKey("Spotify'ı aç"))).toBe(false);
  });
});

describe("episodic memory and reinforcement", () => {
  it("replies are complete at once, plans wait for their outcome", async () => {
    const { brain } = setup();
    const reply = await brain.experience({
      utterance: "Nasılsın?",
      lang: "tr",
      intent: { kind: "reply" },
      source: "model",
    });
    const plan = await brain.experience({
      utterance: "Spotify'ı aç",
      lang: "tr",
      intent: spotify,
      source: "model",
      planId: "p1",
    });
    expect(reply.outcome).toBe("success");
    expect(plan.outcome).toBe("pending");
    expect(brain.experienceForPlan("p1")?.id).toBe(plan.id);
  });

  it("two successes of the same plan consolidate into a skill that practice strengthens", async () => {
    const { brain } = setup();
    await practise(brain, "Jarvis Spotify'ı aç", spotify);
    expect(brain.skills()).toEqual([]);
    await practise(brain, "spotifayı aç", spotify);
    const [skill] = brain.skills();
    expect(skill).toMatchObject({ successes: 2, streak: 2, strength: 0.75 });
    expect(skill?.phrases).toEqual(expect.arrayContaining(["spotifyi ac", "spotifayi ac"]));
    await practise(brain, "spotify aç", spotify);
    const [stronger] = brain.skills();
    expect(stronger?.successes).toBe(3);
    expect(stronger?.strength).toBeGreaterThan(0.75);
  });

  it("failures weaken faster than successes strengthen, and a weak skill is forgotten", async () => {
    const { brain } = setup();
    for (let i = 0; i < 3; i++) await practise(brain, "Not Defteri'ni kapat", notepad);
    const before = brain.skills()[0]?.strength ?? 0;
    await practise(brain, "Not Defteri'ni kapat", notepad, "failure");
    const [after] = brain.skills();
    expect(after?.strength).toBeLessThan(before - 0.3);
    expect(after?.streak).toBe(0);
    await practise(brain, "Not Defteri'ni kapat", notepad, "corrected");
    await practise(brain, "Not Defteri'ni kapat", notepad, "failure");
    expect(brain.skills()).toEqual([]);
  });

  it("a correction overrules a recorded success; cancellation teaches nothing", async () => {
    const { brain } = setup();
    for (let i = 0; i < 2; i++) await practise(brain, "Spotify'ı aç", spotify);
    const last = await practise(brain, "Spotify'ı aç", spotify);
    const strength = brain.skills()[0]?.strength ?? 0;
    const cancelled = await brain.experience({
      utterance: "Spotify'ı aç",
      lang: "tr",
      intent: spotify,
      source: "model",
    });
    await brain.outcome(cancelled.id, "cancelled");
    expect(brain.skills()[0]?.strength).toBe(strength);
    await brain.outcome(last.id, "corrected");
    expect(brain.skills()[0]?.strength).toBeLessThan(strength);
  });
});

describe("reflexes", () => {
  it("a practised, context-free phrase becomes a reflex; a failure or a turned-off action stops it", async () => {
    const { brain } = setup();
    await practise(brain, "Spotify'ı aç", spotify);
    await practise(brain, "Spotify'ı aç", spotify);
    expect(brain.reflex("Spotify'ı aç")).toBeUndefined();
    await practise(brain, "Spotify'ı aç", spotify);
    const reflex = brain.reflex("Jarvis, spotify'ı aç lütfen");
    expect(reflex).toMatchObject({ goal: "Spotify'ı aç", steps: spotify.steps });
    expect(brain.reflex("Spotify'ı aç", (action) => action !== "app.open")).toBeUndefined();
    expect(brain.reflex("Spotify'ı aç ve çal")).toBeUndefined();
    await practise(brain, "Spotify'ı aç", spotify, "failure", "reflex");
    expect(brain.reflex("Spotify'ı aç")).toBeUndefined();
  });

  it("never learns a reflex from a context-dependent phrase", async () => {
    const { brain } = setup();
    for (let i = 0; i < 5; i++) await practise(brain, "onu kapat", notepad);
    expect(brain.skills()).toHaveLength(1);
    expect(brain.reflex("onu kapat")).toBeUndefined();
  });

  it("decays without practice; consolidation forgets what faded", async () => {
    const { brain, advance } = setup();
    for (let i = 0; i < 3; i++) await practise(brain, "Spotify'ı aç", spotify);
    expect(brain.reflex("Spotify'ı aç")).toBeDefined();
    advance(30 * day);
    expect(brain.reflex("Spotify'ı aç")).toBeUndefined();
    expect(brain.skills()[0]?.effective).toBeLessThan(0.75);
    advance(300 * day);
    const report = await brain.consolidate();
    expect(report.forgotten).toBe(1);
    expect(brain.skills()).toEqual([]);
  });
});

describe("recall", () => {
  it("returns similar requests that worked, filtered by what may run now", async () => {
    const { brain } = setup();
    await practise(brain, "Spotify'ı aç", spotify);
    await practise(brain, "Not Defteri'ni kapat", notepad);
    await practise(brain, "Bana bir fıkra anlat", { kind: "reply" });
    await practise(brain, "Hesap makinesini aç", spotify, "failure");
    const examples = await brain.recall("spotifayı açar mısın");
    expect(examples[0]).toMatchObject({ utterance: "Spotify'ı aç", intent: spotify });
    expect(examples.map((e) => e.utterance)).not.toContain("Hesap makinesini aç");
    const filtered = await brain.recall("spotifayı aç", { allowed: (a) => a !== "app.open" });
    expect(filtered.some((e) => e.intent.steps?.[0]?.action === "app.open")).toBe(false);
    expect((await brain.recall("fıkra anlat"))[0]?.intent.kind).toBe("reply");
  });

  it("prefers a consolidated skill and never repeats the same example", async () => {
    const { brain } = setup();
    for (let i = 0; i < 3; i++) await practise(brain, "Spotify'ı aç", spotify);
    const examples = await brain.recall("Spotify aç", { k: 5 });
    const keys = examples.map(
      (e) => `${utteranceKey(e.utterance)}|${signature(e.intent.steps ?? [])}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fuses semantic similarity when an embedder is configured", async () => {
    // A toy embedder: music requests share one direction, everything else another.
    const embed: Embedder = async (texts) =>
      texts.map((text) => (/spotify|muzik|sarki/.test(text) ? [1, 0] : [0, 1]));
    const { brain } = setup({ embed });
    await practise(brain, "Spotify'ı aç", spotify);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const examples = await brain.recall("biraz müzik başlat");
    expect(examples[0]?.intent).toEqual(spotify);
  });
});

describe("durability and choices", () => {
  it("a new brain on the same store remembers skills, reflexes and choices", async () => {
    const { brain, store } = setup();
    for (let i = 0; i < 3; i++) await practise(brain, "Spotify'ı aç", spotify);
    await brain.learnChoice("Kaydet", ["Kaydet", "Kaydetme"], "Kaydetme");
    const reborn = new Brain(store, { now: () => 1_000_000_000_000 });
    await reborn.load();
    expect(reborn.reflex("Spotify'ı aç")?.goal).toBe("Spotify'ı aç");
    expect(reborn.preferredChoice("kaydet", ["Kaydetme", "Kaydet"])).toBe("Kaydetme");
    expect(reborn.preferredChoice("Kaydet", ["Kaydet", "Kaydetme", "İptal"])).toBeUndefined();
    await reborn.unlearnChoice("Kaydet", ["Kaydet", "Kaydetme"]);
    expect(reborn.preferredChoice("Kaydet", ["Kaydet", "Kaydetme"])).toBeUndefined();
  });

  it("consolidation prunes old experiences and builds skills it missed", async () => {
    const { brain, store, advance } = setup();
    const a = await brain.experience({
      utterance: "Spotify'ı aç",
      lang: "tr",
      intent: spotify,
      source: "model",
    });
    const b = await brain.experience({
      utterance: "Spotify aç",
      lang: "tr",
      intent: spotify,
      source: "model",
    });
    // Outcomes written by an older version directly to the store.
    for (const id of [a.id, b.id]) {
      const stored = store.experiences.get(id);
      if (stored) stored.outcome = "success";
    }
    await brain.load();
    expect((await brain.consolidate()).created).toBe(1);
    advance(100 * day);
    expect((await brain.consolidate()).experiences).toBe(0);
  });

  it("reports stats and forgets on request", async () => {
    const { brain } = setup();
    for (let i = 0; i < 3; i++) await practise(brain, "Spotify'ı aç", spotify);
    await practise(brain, "Not Defteri'ni kapat", notepad, "failure");
    const stats = brain.stats();
    expect(stats).toMatchObject({ experiences: 4, skills: 1, planSuccessRate: 0.75 });
    expect(stats.topSkills[0]).toMatchObject({ goal: "Spotify'ı aç", successes: 3 });
    expect(await brain.forgetSkill(stats.topSkills[0]?.id ?? "")).toBe(true);
    expect(brain.reflex("Spotify'ı aç")).toBeUndefined();
    await brain.forgetAll();
    expect(brain.stats().experiences).toBe(0);
  });
});
