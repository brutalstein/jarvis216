import { createHash, randomUUID } from "node:crypto";
import MiniSearch from "minisearch";
import { contextDependent, normalize, utteranceKey } from "./text.js";
import type {
  BrainStats,
  BrainStore,
  Consolidation,
  Embedder,
  Example,
  Experience,
  IntentRecord,
  Lang,
  Outcome,
  Preference,
  Reflex,
  Skill,
  Source,
  Step,
} from "./types.js";

const dayMs = 86_400_000;
type Doc = { id: string; text: string };

export type BrainOptions = {
  now?: () => number;
  // Semantic recall next to keyword recall; optional and bounded by `embedTimeoutMs`.
  embed?: Embedder;
  embedTimeoutMs?: number;
  // Reinforcement learning rates: failures teach faster than successes.
  successRate?: number;
  failureRate?: number;
  // Experiences kept for learning (days and count).
  retentionDays?: number;
  maxExperiences?: number;
};

// Canonical JSON of a plan's steps: the identity of "the same thing done again".
export function signature(steps: Step[]): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(steps)))
    .digest("hex")
    .slice(0, 32);
}
const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * A learning memory modelled on how people get better at routine requests:
 * - working memory lives in the caller (the conversation); every understood request becomes an
 *   episodic *experience*, later marked with its real outcome (reinforcement signal);
 * - repeated successes consolidate into procedural *skills* ("sleep"), strengthened by each
 *   success, weakened faster by each failure or correction, and forgotten on an Ebbinghaus-like
 *   curve whose half-life grows with practice (spacing effect);
 * - recall returns the most similar past requests that worked, as examples for the model
 *   (in-context learning), by keyword relevance (BM25 via MiniSearch) fused with optional
 *   semantic similarity (reciprocal rank fusion);
 * - a well-practised, context-free phrase becomes a *reflex*: its learned plan is proposed
 *   without a model call. Callers still compile, authorize and approve it like any plan.
 * - choices among on-screen candidates are remembered per exact situation.
 * Nothing here executes or authorizes anything; it only proposes and remembers.
 */
export class Brain {
  #experiences = new Map<string, Experience>();
  #skills = new Map<string, Skill>();
  #preferences = new Map<string, Preference>();
  #index = new MiniSearch<Doc>({
    fields: ["text"],
    storeFields: [],
    searchOptions: { fuzzy: 0.2, prefix: true, combineWith: "OR" },
  });
  #lastConsolidatedAt: number | null = null;
  #options: Required<Omit<BrainOptions, "embed">> & { embed?: Embedder };

  constructor(
    private store: BrainStore,
    options: BrainOptions = {},
  ) {
    this.#options = {
      now: Date.now,
      embedTimeoutMs: 800,
      successRate: 0.3,
      failureRate: 0.5,
      retentionDays: 90,
      maxExperiences: 5000,
      ...options,
    };
  }

  async load(): Promise<void> {
    const since = this.#now() - this.#options.retentionDays * dayMs;
    this.#experiences = new Map((await this.store.loadExperiences(since)).map((e) => [e.id, e]));
    this.#skills = new Map((await this.store.loadSkills()).map((s) => [s.id, s]));
    this.#preferences = new Map((await this.store.loadPreferences()).map((p) => [p.key, p]));
    this.#reindex();
  }

  // Episodic memory: one understood request. Plans start pending until their outcome arrives.
  async experience(input: {
    utterance: string;
    lang: Lang;
    intent: IntentRecord;
    source: Source;
    planId?: string | null;
  }): Promise<Experience> {
    const experience: Experience = {
      id: randomUUID(),
      at: this.#now(),
      utterance: input.utterance.slice(0, 500),
      key: utteranceKey(input.utterance),
      lang: input.lang,
      intent: input.intent,
      source: input.source,
      // Replies, clarifications and cancels are complete when given; a later correction can
      // still mark them.
      outcome: input.intent.kind === "plan" ? "pending" : "success",
      outcomeAt: input.intent.kind === "plan" ? null : this.#now(),
      planId: input.planId ?? null,
    };
    this.#experiences.set(experience.id, experience);
    await this.store.saveExperience(experience);
    if (experience.key) this.#index.add({ id: `e:${experience.id}`, text: experience.key });
    void this.#embed(experience);
    return experience;
  }

  experienceForPlan(planId: string): Experience | undefined {
    for (const experience of this.#experiences.values())
      if (experience.planId === planId) return experience;
    return undefined;
  }

  // The latest experience, for corrections ("hayır, onu demedim") that refer back to it.
  latest(withinMs: number): Experience | undefined {
    let latest: Experience | undefined;
    for (const experience of this.#experiences.values())
      if (!latest || experience.at > latest.at) latest = experience;
    return latest && this.#now() - latest.at <= withinMs ? latest : undefined;
  }

  // Reinforcement: success strengthens the skill behind a plan, failure and correction weaken
  // it faster; cancellation is a change of mind and teaches nothing.
  async outcome(id: string, outcome: Exclude<Outcome, "pending">): Promise<void> {
    const experience = this.#experiences.get(id);
    if (!experience || experience.outcome === outcome) return;
    // A correction may overrule a recorded success; nothing else changes a final outcome.
    if (experience.outcome !== "pending" && outcome !== "corrected") return;
    experience.outcome = outcome;
    experience.outcomeAt = this.#now();
    await this.store.saveExperience(experience);
    const steps = experience.intent.kind === "plan" ? experience.intent.steps : undefined;
    if (!steps?.length || outcome === "cancelled") return;
    const sig = signature(steps);
    let skill = [...this.#skills.values()].find((s) => s.signature === sig);
    if (outcome === "success") {
      if (!skill) {
        skill = this.#learnSkill(sig, experience);
        if (!skill) return;
      } else {
        skill.strength += this.#options.successRate * (1 - skill.strength);
        skill.successes++;
        skill.streak++;
        skill.reinforcedAt = this.#now();
        if (experience.source === "reflex") {
          skill.uses++;
          skill.lastUsedAt = this.#now();
        }
        this.#addPhrase(skill, experience.key);
      }
      skill.goal = experience.intent.goal ?? skill.goal;
      await this.store.saveSkill(skill);
      this.#reindexSkill(skill);
      return;
    }
    if (!skill) return;
    skill.strength += this.#options.failureRate * (0 - skill.strength);
    skill.failures++;
    skill.streak = 0;
    skill.reinforcedAt = this.#now();
    if (this.#effective(skill) < 0.2) await this.forgetSkill(skill.id);
    else {
      await this.store.saveSkill(skill);
      this.#reindexSkill(skill);
    }
  }

  // Similar past requests that worked, best first, as examples for the model. `allowed`
  // filters out plans with actions the operator turned off or this setup cannot run.
  async recall(
    utterance: string,
    options: { k?: number; allowed?: (action: string) => boolean } = {},
  ): Promise<Example[]> {
    const key = utteranceKey(utterance);
    if (!key) return [];
    const k = options.k ?? 4;
    const keyword = this.#index.search(key).slice(0, 30);
    const ranked = new Map<string, number>();
    // Reciprocal rank fusion of keyword and semantic rankings.
    for (const [rank, hit] of keyword.entries()) ranked.set(hit.id, 1 / (60 + rank));
    const semantic = await this.#semantic(key);
    for (const [rank, [id]] of semantic.entries())
      ranked.set(id, (ranked.get(id) ?? 0) + 1 / (60 + rank));
    const allowed = options.allowed ?? (() => true);
    const seen = new Set<string>();
    const examples: Example[] = [];
    for (const [id, score] of [...ranked].sort((a, b) => b[1] - a[1])) {
      const example = this.#example(id, score);
      if (!example) continue;
      if (example.intent.steps?.some((step) => !allowed(step.action))) continue;
      const dedupe = `${utteranceKey(example.utterance)}|${example.intent.steps ? signature(example.intent.steps) : example.intent.kind}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      examples.push(example);
      if (examples.length >= k) break;
    }
    return examples;
  }

  // A practised, context-free phrase answered from procedural memory without a model call.
  reflex(utterance: string, allowed: (action: string) => boolean = () => true): Reflex | undefined {
    const key = utteranceKey(utterance);
    if (!key || contextDependent(key)) return undefined;
    let best: Reflex | undefined;
    for (const skill of this.#skills.values()) {
      const strength = this.#effective(skill);
      if (
        !skill.phrases.includes(key) ||
        strength < 0.75 ||
        skill.successes < 3 ||
        skill.streak < 2 ||
        !skill.steps.every((step) => allowed(step.action))
      )
        continue;
      if (!best || strength > best.strength)
        best = {
          skillId: skill.id,
          goal: skill.goal,
          lang: skill.lang,
          steps: structuredClone(skill.steps),
          strength,
        };
    }
    return best;
  }

  // "Sleep": prune old experiences, consolidate repeated successes into skills, forget skills
  // that faded, and rebuild the recall index.
  async consolidate(): Promise<Consolidation> {
    const now = this.#now();
    const report: Consolidation = { created: 0, strengthened: 0, forgotten: 0, experiences: 0 };
    const cutoff = now - this.#options.retentionDays * dayMs;
    await this.store.deleteExperiencesBefore(cutoff);
    for (const [id, experience] of this.#experiences)
      if (experience.at < cutoff) this.#experiences.delete(id);
    const newest = [...this.#experiences.values()].sort((a, b) => b.at - a.at);
    const excess = newest.slice(this.#options.maxExperiences).map((e) => e.id);
    if (excess.length) {
      await this.store.deleteExperiences(excess);
      for (const id of excess) this.#experiences.delete(id);
    }
    // Repeated successes of the same plan become (or join) a skill.
    const groups = new Map<string, Experience[]>();
    for (const experience of this.#experiences.values()) {
      const steps = experience.intent.steps;
      if (experience.intent.kind !== "plan" || !steps?.length || experience.outcome !== "success")
        continue;
      const sig = signature(steps);
      groups.set(sig, [...(groups.get(sig) ?? []), experience]);
    }
    for (const [sig, successes] of groups) {
      const skill = [...this.#skills.values()].find((s) => s.signature === sig);
      if (skill) {
        const before = skill.phrases.length;
        for (const experience of successes) this.#addPhrase(skill, experience.key);
        if (skill.phrases.length !== before) {
          report.strengthened++;
          await this.store.saveSkill(skill);
        }
      } else if (successes.length >= 2) {
        const [latest] = successes.sort((a, b) => b.at - a.at);
        const learned = latest && this.#learnSkill(sig, latest);
        if (learned) {
          await this.store.saveSkill(learned);
          report.created++;
        }
      }
    }
    for (const skill of [...this.#skills.values()])
      if (this.#effective(skill) < 0.2) {
        await this.forgetSkill(skill.id);
        report.forgotten++;
      }
    this.#reindex();
    report.experiences = this.#experiences.size;
    this.#lastConsolidatedAt = now;
    return report;
  }

  // The operator picked `chosen` among `candidates` for `target`: next time, in the very same
  // situation, the same pick is preferred.
  async learnChoice(target: string, candidates: string[], chosen: string): Promise<void> {
    if (!candidates.includes(chosen)) return;
    const key = this.#choiceKey(target, candidates);
    const previous = this.#preferences.get(key);
    const preference: Preference = {
      key,
      choice: chosen,
      count: previous?.choice === chosen ? previous.count + 1 : 1,
      at: this.#now(),
    };
    this.#preferences.set(key, preference);
    await this.store.savePreference(preference);
  }
  preferredChoice(target: string, candidates: string[]): string | undefined {
    const preference = this.#preferences.get(this.#choiceKey(target, candidates));
    return preference && candidates.includes(preference.choice) ? preference.choice : undefined;
  }
  // A preferred pick that turned out wrong is dropped.
  async unlearnChoice(target: string, candidates: string[]): Promise<void> {
    const key = this.#choiceKey(target, candidates);
    if (!this.#preferences.delete(key)) return;
    await this.store.deletePreference(key);
  }

  skills(): (Skill & { effective: number })[] {
    return [...this.#skills.values()]
      .map((skill) => ({ ...structuredClone(skill), effective: this.#effective(skill) }))
      .sort((a, b) => b.effective - a.effective);
  }

  async forgetSkill(id: string): Promise<boolean> {
    const skill = this.#skills.get(id);
    if (!skill) return false;
    this.#skills.delete(id);
    skill.phrases.forEach((_, index) => {
      if (this.#index.has(`s:${id}:${index}`)) this.#index.discard(`s:${id}:${index}`);
    });
    await this.store.deleteSkill(id);
    return true;
  }

  async forgetAll(): Promise<void> {
    this.#experiences.clear();
    this.#skills.clear();
    this.#preferences.clear();
    this.#index.removeAll();
    await this.store.clear();
  }

  stats(): BrainStats {
    const plans = [...this.#experiences.values()]
      .filter((e) => e.intent.kind === "plan" && e.outcome !== "pending")
      .sort((a, b) => b.at - a.at)
      .slice(0, 100);
    const judged = plans.filter((e) => e.outcome !== "cancelled");
    const all = [...this.#experiences.values()];
    return {
      experiences: all.length,
      skills: this.#skills.size,
      preferences: this.#preferences.size,
      planSuccessRate: judged.length
        ? judged.filter((e) => e.outcome === "success").length / judged.length
        : null,
      correctionRate: all.length
        ? all.filter((e) => e.outcome === "corrected").length / all.length
        : null,
      reflexShare: all.length ? all.filter((e) => e.source === "reflex").length / all.length : null,
      lastConsolidatedAt: this.#lastConsolidatedAt,
      topSkills: this.skills()
        .slice(0, 10)
        .map((skill) => ({
          id: skill.id,
          goal: skill.goal,
          phrase: skill.phrases[0] ?? "",
          strength: Math.round(skill.effective * 1000) / 1000,
          successes: skill.successes,
          uses: skill.uses,
        })),
    };
  }

  // Strength decays with time since it was last reinforced; practice lengthens the half-life.
  #effective(skill: Skill): number {
    const halfLife = 14 * dayMs * (1 + Math.log2(1 + skill.successes));
    return skill.strength * 0.5 ** ((this.#now() - skill.reinforcedAt) / halfLife);
  }

  // A plan becomes a skill once it has succeeded twice (Laplace-smoothed starting strength).
  #learnSkill(sig: string, latest: Experience): Skill | undefined {
    const successes = [...this.#experiences.values()].filter(
      (e) =>
        e.outcome === "success" &&
        e.intent.kind === "plan" &&
        e.intent.steps &&
        signature(e.intent.steps) === sig,
    );
    if (successes.length < 2 || !latest.intent.steps) return undefined;
    const now = this.#now();
    const skill: Skill = {
      id: randomUUID(),
      signature: sig,
      goal: latest.intent.goal ?? "",
      lang: latest.lang,
      steps: structuredClone(latest.intent.steps),
      phrases: [],
      strength: (successes.length + 1) / (successes.length + 2),
      successes: successes.length,
      failures: 0,
      streak: successes.length,
      uses: 0,
      createdAt: now,
      reinforcedAt: now,
      lastUsedAt: null,
    };
    for (const experience of successes) this.#addPhrase(skill, experience.key);
    this.#skills.set(skill.id, skill);
    this.#reindexSkill(skill);
    return skill;
  }

  #addPhrase(skill: Skill, key: string) {
    if (!key || skill.phrases.includes(key)) return;
    skill.phrases = [key, ...skill.phrases].slice(0, 8);
  }

  #example(id: string, score: number): Example | undefined {
    if (id.startsWith("s:")) {
      const [, skillId, index] = id.split(":");
      const skill = this.#skills.get(skillId ?? "");
      const phrase = skill?.phrases[Number(index)];
      if (!skill || !phrase || this.#effective(skill) < 0.3) return undefined;
      return {
        utterance: phrase,
        intent: { kind: "plan", goal: skill.goal, steps: skill.steps },
        from: "skill",
        score,
      };
    }
    const experience = this.#experiences.get(id.slice(2));
    if (experience?.outcome !== "success") return undefined;
    return {
      utterance: experience.utterance,
      intent: experience.intent,
      from: "experience",
      score,
    };
  }

  #reindexSkill(skill: Skill) {
    for (let index = 0; index < 8; index++) {
      const id = `s:${skill.id}:${index}`;
      if (this.#index.has(id)) this.#index.discard(id);
    }
    for (const [index, phrase] of skill.phrases.entries())
      this.#index.add({ id: `s:${skill.id}:${index}`, text: phrase });
  }

  #reindex() {
    this.#index.removeAll();
    for (const experience of this.#experiences.values())
      if (experience.key) this.#index.add({ id: `e:${experience.id}`, text: experience.key });
    for (const skill of this.#skills.values()) this.#reindexSkill(skill);
  }

  async #embed(experience: Experience): Promise<void> {
    if (!this.#options.embed || !experience.key) return;
    try {
      const [vector] = await this.#options.embed(
        [experience.key],
        AbortSignal.timeout(this.#options.embedTimeoutMs * 4),
      );
      if (!vector?.length) return;
      experience.vector = vector;
      await this.store.saveExperience(experience);
    } catch {
      // Semantic recall is an enhancement; keyword recall still works.
    }
  }

  async #semantic(key: string): Promise<[string, number][]> {
    if (!this.#options.embed) return [];
    try {
      const [query] = await this.#options.embed(
        [key],
        AbortSignal.timeout(this.#options.embedTimeoutMs),
      );
      if (!query?.length) return [];
      return [...this.#experiences.values()]
        .flatMap((e): [string, number][] =>
          e.vector ? [[`e:${e.id}`, cosine(query, e.vector)]] : [],
        )
        .filter(([, similarity]) => similarity > 0.6)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30);
    } catch {
      return [];
    }
  }

  #choiceKey(target: string, candidates: string[]): string {
    return `${normalize(target)}|${candidates.map(normalize).sort().join("¦")}`;
  }

  #now(): number {
    return this.#options.now();
  }
}
