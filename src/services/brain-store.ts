import type { BrainStore, Experience, Preference, Skill } from "@jarvis/brain";
import type { Sql } from "../core/database.js";

// The brain's durable memory in PostgreSQL; each record is one JSON document.
export class PostgresBrainStore implements BrainStore {
  constructor(private db: Sql) {}
  async loadExperiences(since: number): Promise<Experience[]> {
    return (
      await this.db.query<{ data: Experience }>(
        "SELECT data FROM brain_experiences WHERE at>$1 ORDER BY at,id",
        [since],
      )
    ).rows.map((row) => row.data);
  }
  async saveExperience(experience: Experience): Promise<void> {
    await this.db.query(
      "INSERT INTO brain_experiences(id,at,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$3",
      [experience.id, experience.at, JSON.stringify(experience)],
    );
  }
  async deleteExperiencesBefore(at: number): Promise<void> {
    await this.db.query("DELETE FROM brain_experiences WHERE at<$1", [at]);
  }
  async deleteExperiences(ids: string[]): Promise<void> {
    await this.db.query("DELETE FROM brain_experiences WHERE id = ANY($1::uuid[])", [ids]);
  }
  async loadSkills(): Promise<Skill[]> {
    return (await this.db.query<{ data: Skill }>("SELECT data FROM brain_skills")).rows.map(
      (row) => row.data,
    );
  }
  async saveSkill(skill: Skill): Promise<void> {
    await this.db.query(
      "INSERT INTO brain_skills(id,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$2,updated_at=$3",
      [skill.id, JSON.stringify(skill), Date.now()],
    );
  }
  async deleteSkill(id: string): Promise<void> {
    await this.db.query("DELETE FROM brain_skills WHERE id=$1", [id]);
  }
  async loadPreferences(): Promise<Preference[]> {
    return (
      await this.db.query<{ data: Preference }>("SELECT data FROM brain_preferences")
    ).rows.map((row) => row.data);
  }
  async savePreference(preference: Preference): Promise<void> {
    await this.db.query(
      "INSERT INTO brain_preferences(key,data) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET data=$2",
      [preference.key, JSON.stringify(preference)],
    );
  }
  async deletePreference(key: string): Promise<void> {
    await this.db.query("DELETE FROM brain_preferences WHERE key=$1", [key]);
  }
  async clear(): Promise<void> {
    await this.db.query("DELETE FROM brain_experiences");
    await this.db.query("DELETE FROM brain_skills");
    await this.db.query("DELETE FROM brain_preferences");
  }
}
