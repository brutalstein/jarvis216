export type Lang = "tr" | "en";
export type Step = {
  action: string;
  args: Record<string, unknown>;
  when?: { step: number; contains: string; not?: boolean };
};
export type IntentRecord = {
  kind: "reply" | "clarify" | "plan" | "cancel";
  goal?: string;
  steps?: Step[];
};
// pending: waiting for the plan's result. cancelled is neutral: a change of mind teaches nothing.
export type Outcome = "pending" | "success" | "failure" | "corrected" | "cancelled";
// model: understood by a model call; reflex: answered from a learned skill without one.
export type Source = "model" | "reflex";

// Episodic memory: one understood request and what came of it.
export type Experience = {
  id: string;
  at: number;
  utterance: string;
  key: string;
  lang: Lang;
  intent: IntentRecord;
  source: Source;
  outcome: Outcome;
  outcomeAt: number | null;
  planId: string | null;
  vector?: number[];
};

// Procedural memory: a plan that worked repeatedly, with the phrases that asked for it.
export type Skill = {
  id: string;
  signature: string;
  goal: string;
  lang: Lang;
  steps: Step[];
  phrases: string[];
  strength: number;
  successes: number;
  failures: number;
  // Consecutive successes since the last failure.
  streak: number;
  uses: number;
  createdAt: number;
  reinforcedAt: number;
  lastUsedAt: number | null;
};

// A choice the operator made among on-screen candidates, keyed by the exact situation.
export type Preference = { key: string; choice: string; count: number; at: number };

export interface BrainStore {
  loadExperiences(since: number): Promise<Experience[]>;
  saveExperience(experience: Experience): Promise<void>;
  deleteExperiencesBefore(at: number): Promise<void>;
  deleteExperiences(ids: string[]): Promise<void>;
  loadSkills(): Promise<Skill[]>;
  saveSkill(skill: Skill): Promise<void>;
  deleteSkill(id: string): Promise<void>;
  loadPreferences(): Promise<Preference[]>;
  savePreference(preference: Preference): Promise<void>;
  deletePreference(key: string): Promise<void>;
  clear(): Promise<void>;
}

// Optional semantic recall: texts in, one vector per text out.
export type Embedder = (texts: string[], signal: AbortSignal) => Promise<number[][]>;

export type Example = {
  utterance: string;
  intent: IntentRecord;
  from: "skill" | "experience";
  score: number;
};
export type Reflex = { skillId: string; goal: string; lang: Lang; steps: Step[]; strength: number };
export type BrainStats = {
  experiences: number;
  skills: number;
  preferences: number;
  planSuccessRate: number | null;
  correctionRate: number | null;
  reflexShare: number | null;
  lastConsolidatedAt: number | null;
  topSkills: {
    id: string;
    goal: string;
    phrase: string;
    strength: number;
    successes: number;
    uses: number;
  }[];
};
export type Consolidation = {
  created: number;
  strengthened: number;
  forgotten: number;
  experiences: number;
};
