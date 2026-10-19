import { EventEmitter } from "node:events";
import { catalog } from "@jarvis/action-engine";
import { z } from "zod";
import { invariant } from "../core/contracts.js";
import type { Database } from "../core/database.js";

// The operator's standing decisions per catalog action, set in the desktop Settings:
// - ask:   the plan waits for the operator's tap (and a HIGH step for its exact approval);
// - allow: Core treats the grant as the operator's approval, so a spoken request just runs;
// - deny:  the action is never offered to a model and never executes.
// Engine guards (shells, password fields, folders outside the roots) apply in every mode.
export type PermissionMode = "ask" | "allow" | "deny";
export type Preset = "guarded" | "trusted" | "autonomous";
export type BrainSettings = { learning: boolean; reflexes: boolean };
type Grant = { mode: PermissionMode; expiresAt: number | null };
export type PermissionView = {
  version: number;
  preset: Preset | "custom";
  actions: {
    id: string;
    kind: string;
    risk: string;
    description: { tr: string; en: string };
    mode: PermissionMode;
    defaultMode: PermissionMode;
    expiresAt: number | null;
    available: boolean;
  }[];
  settings: BrainSettings;
};

const defaults: BrainSettings = { learning: true, reflexes: true };
export const maxGrantMs = 30 * 86_400_000;
export const PermissionChangeSchema = z.strictObject({
  actions: z
    .record(
      z.string().min(1).max(40),
      z.strictObject({
        mode: z.enum(["ask", "allow", "deny"]),
        // Only an allow may expire; absent means until the operator changes it.
        expiresInMs: z.number().int().min(60_000).max(maxGrantMs).optional(),
      }),
    )
    .optional(),
  settings: z
    .strictObject({ learning: z.boolean().optional(), reflexes: z.boolean().optional() })
    .optional(),
});
export type PermissionChange = z.infer<typeof PermissionChangeSchema>;

const riskOf = (action: string) =>
  Object.hasOwn(catalog, action) ? catalog[action]?.risk : undefined;
export const defaultMode = (action: string): PermissionMode =>
  riskOf(action) === "LOW" ? "allow" : "ask";
// Presets set every action; "guarded" is the shipped default.
const presetMode: Record<Preset, (risk: string) => PermissionMode> = {
  guarded: (risk) => (risk === "LOW" ? "allow" : "ask"),
  trusted: (risk) => (risk === "HIGH" ? "ask" : "allow"),
  autonomous: () => "allow",
};

export class PermissionService extends EventEmitter {
  #grants = new Map<string, Grant>();
  #settings: BrainSettings = { ...defaults };
  #version = 0;
  constructor(
    private db: Database,
    private options: { available?: () => ReadonlySet<string>; now?: () => number } = {},
  ) {
    super();
  }

  get version(): number {
    return this.#version;
  }

  async load(): Promise<void> {
    const rows = (
      await this.db.query<{ action: string; mode: PermissionMode; expires_at: string | null }>(
        "SELECT action,mode,expires_at FROM permissions",
      )
    ).rows;
    this.#grants = new Map(
      rows
        .filter((row) => Object.hasOwn(catalog, row.action))
        .map((row) => [
          row.action,
          { mode: row.mode, expiresAt: row.expires_at === null ? null : Number(row.expires_at) },
        ]),
    );
    const stored = (
      await this.db.query<{ value: Partial<BrainSettings> }>(
        "SELECT value FROM settings WHERE key='brain'",
      )
    ).rows[0]?.value;
    this.#settings = { ...defaults, ...stored };
    const version = (
      await this.db.query<{ version: string | null }>(
        "SELECT max(id) AS version FROM permission_audit",
      )
    ).rows[0]?.version;
    this.#version = Number(version ?? 0);
  }

  // Effective mode now: unknown actions are denied; an expired allow falls back to the default.
  mode(action: string): PermissionMode {
    if (!Object.hasOwn(catalog, action)) return "deny";
    const grant = this.#grants.get(action);
    if (!grant || (grant.expiresAt !== null && grant.expiresAt <= this.#now()))
      return defaultMode(action);
    return grant.mode;
  }
  allows(action: string): boolean {
    return this.mode(action) === "allow";
  }
  denies(action: string): boolean {
    return this.mode(action) === "deny";
  }
  denied(): Set<string> {
    return new Set(Object.keys(catalog).filter((id) => this.denies(id)));
  }
  settings(): BrainSettings {
    return { ...this.#settings };
  }

  view(): PermissionView {
    const available = this.options.available?.();
    const actions = Object.values(catalog).map((definition) => {
      const grant = this.#grants.get(definition.id);
      const active = grant && (grant.expiresAt === null || grant.expiresAt > this.#now());
      const mode = this.mode(definition.id);
      return {
        id: definition.id,
        kind: definition.kind,
        risk: definition.risk,
        description: definition.description,
        mode,
        defaultMode: defaultMode(definition.id),
        expiresAt: active ? grant.expiresAt : null,
        available: available ? available.has(definition.id) : true,
      };
    });
    const preset =
      (Object.keys(presetMode) as Preset[]).find((name) =>
        actions.every((action) => action.mode === presetMode[name](action.risk)),
      ) ?? "custom";
    return { version: this.#version, preset, actions, settings: this.settings() };
  }

  async update(raw: unknown, actor = "operator"): Promise<PermissionView> {
    const change = PermissionChangeSchema.parse(raw);
    for (const [action, grant] of Object.entries(change.actions ?? {})) {
      invariant(Object.hasOwn(catalog, action), "UNKNOWN_ACTION", 400);
      invariant(
        grant.mode === "allow" || grant.expiresInMs === undefined,
        "EXPIRY_NEEDS_ALLOW",
        400,
      );
    }
    const now = this.#now();
    await this.db.transaction(async (tx) => {
      for (const [action, grant] of Object.entries(change.actions ?? {}))
        await tx.query(
          "INSERT INTO permissions(action,mode,expires_at,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(action) DO UPDATE SET mode=$2,expires_at=$3,updated_at=$4",
          [action, grant.mode, grant.expiresInMs ? now + grant.expiresInMs : null, now],
        );
      if (change.settings)
        await tx.query(
          "INSERT INTO settings(key,value,updated_at) VALUES('brain',$1,$2) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=$2",
          [JSON.stringify({ ...this.#settings, ...change.settings }), now],
        );
      // Every change is audited with who made it; the audit id is the policy version.
      await tx.query("INSERT INTO permission_audit(at,actor,change) VALUES($1,$2,$3)", [
        now,
        actor,
        JSON.stringify(change),
      ]);
    });
    await this.load();
    this.emit("change", this.view());
    return this.view();
  }

  // An optional expiry applies to the allows the preset grants beyond the defaults.
  preset(name: Preset, actor = "operator", expiresInMs?: number): Promise<PermissionView> {
    const actions = Object.fromEntries(
      Object.values(catalog).map((definition) => {
        const mode = presetMode[name](definition.risk);
        const expiring = expiresInMs && mode === "allow" && defaultMode(definition.id) !== "allow";
        return [definition.id, { mode, ...(expiring && { expiresInMs }) }];
      }),
    );
    return this.update({ actions }, `${actor}:preset:${name}`);
  }

  async audit(limit = 50): Promise<{ id: number; at: number; actor: string; change: unknown }[]> {
    const rows = (
      await this.db.query<{ id: string; at: string; actor: string; change: unknown }>(
        "SELECT id,at,actor,change FROM permission_audit ORDER BY id DESC LIMIT $1",
        [limit],
      )
    ).rows;
    return rows.map((row) => ({
      id: Number(row.id),
      at: Number(row.at),
      actor: row.actor,
      change: row.change,
    }));
  }

  #now(): number {
    return (this.options.now ?? Date.now)();
  }
}
