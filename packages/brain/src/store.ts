import type { BrainStore, Experience, Preference, Skill } from "./types.js";

// In-memory store for tests and for running without a database.
export class MemoryBrainStore implements BrainStore {
  experiences = new Map<string, Experience>();
  skills = new Map<string, Skill>();
  preferences = new Map<string, Preference>();
  async loadExperiences(since: number) {
    return [...this.experiences.values()].filter((e) => e.at > since).sort((a, b) => a.at - b.at);
  }
  async saveExperience(experience: Experience) {
    this.experiences.set(experience.id, structuredClone(experience));
  }
  async deleteExperiencesBefore(at: number) {
    for (const [id, experience] of this.experiences)
      if (experience.at < at) this.experiences.delete(id);
  }
  async deleteExperiences(ids: string[]) {
    for (const id of ids) this.experiences.delete(id);
  }
  async loadSkills() {
    return [...this.skills.values()].map((skill) => structuredClone(skill));
  }
  async saveSkill(skill: Skill) {
    this.skills.set(skill.id, structuredClone(skill));
  }
  async deleteSkill(id: string) {
    this.skills.delete(id);
  }
  async loadPreferences() {
    return [...this.preferences.values()];
  }
  async savePreference(preference: Preference) {
    this.preferences.set(preference.key, { ...preference });
  }
  async deletePreference(key: string) {
    this.preferences.delete(key);
  }
  async clear() {
    this.experiences.clear();
    this.skills.clear();
    this.preferences.clear();
  }
}
