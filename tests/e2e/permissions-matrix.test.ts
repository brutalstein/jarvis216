import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/core/database.js";
import { PermissionService, type PermissionView } from "../../src/services/permissions.js";
import { boot, database, FakeModel, type Running, type Services, services } from "./harness.js";
import { type generateCases, permissionPolicies } from "./matrix/generate.js";

const cases = JSON.parse(
  readFileSync(new URL("./matrix/coverage.cases.json", import.meta.url), "utf8"),
) as ReturnType<typeof generateCases>;
let db: Database;
let drop: (() => Promise<void>) | undefined;
let fakes: Services | undefined;
let running: Running | undefined;
const auditIds = new Set<number>();

beforeAll(async () => {
  ({ db, drop } = await database());
  fakes = await services();
  running = await boot(
    db,
    {
      ...fakes.env,
      ENABLE_DESKTOP: "false",
      ENABLE_BROWSER: "false",
      ENABLE_OPENCLAW: "false",
      ENABLE_N8N: "false",
    },
    new FakeModel(),
  );
}, 60_000);
afterAll(async () => {
  await running?.stop();
  await fakes?.close();
  await drop?.();
});

describe("every action through the permission API and persistent audit", () => {
  it.each(permissionPolicies())("$id", async (policy) => {
    const rows = cases.permissions.filter((row) => row.policy === policy.id);
    expect(rows).toHaveLength(44);
    const change =
      "preset" in policy
        ? {
            preset: policy.preset,
            ...(policy.durationMs && { expiresInMs: policy.durationMs }),
          }
        : {
            actions: Object.fromEntries(
              rows.map((row) => [
                row.action,
                {
                  mode: policy.mode,
                  ...(policy.durationMs && { expiresInMs: policy.durationMs }),
                },
              ]),
            ),
          };
    const requestedAt = Date.now();
    const response = await running!.api<PermissionView>(
      "preset" in policy ? "POST" : "PUT",
      "preset" in policy ? "/v1/permissions/preset" : "/v1/permissions",
      change,
    );
    expect(response.status).toBe(200);
    for (const row of rows) {
      const action = response.body.actions.find((item) => item.id === row.action)!;
      const expiring =
        policy.durationMs > 0 &&
        (!("preset" in policy) || (row.risk !== "LOW" && action.mode === "allow"));
      if (expiring) {
        expect(action.expiresAt, row.id).toBeGreaterThanOrEqual(requestedAt + policy.durationMs);
        expect(action.expiresAt, row.id).toBeLessThanOrEqual(Date.now() + policy.durationMs);
      } else expect(action.expiresAt, row.id).toBeNull();
    }
    if (policy.expired) {
      await db.query("UPDATE permissions SET expires_at=$1 WHERE expires_at IS NOT NULL", [
        Date.now() - 1,
      ]);
      await running!.core.permissions.load();
    }
    const view = policy.expired
      ? (await running!.api<PermissionView>("GET", "/v1/permissions")).body
      : response.body;
    // A fresh service reads persisted grants, not the original instance's in-memory map.
    const reloaded = new PermissionService(db);
    await reloaded.load();
    for (const row of rows) {
      expect(
        view.actions.find((action) => action.id === row.action),
        row.id,
      ).toMatchObject({ mode: row.expectedMode, risk: row.risk });
      expect(reloaded.mode(row.action), row.id).toBe(row.expectedMode);
      if (policy.expired)
        expect(
          view.actions.find((action) => action.id === row.action)?.expiresAt,
          row.id,
        ).toBeNull();
    }
    const audit = await running!.api<{
      entries: { id: number; actor: string; change: { actions: Record<string, unknown> } }[];
    }>("GET", "/v1/permissions/audit?limit=1");
    expect(audit.status).toBe(200);
    const entry = audit.body.entries[0]!;
    expect(entry.actor).toBe("preset" in policy ? `operator:preset:${policy.preset}` : "operator");
    expect(Object.keys(entry.change.actions).sort()).toEqual(rows.map((row) => row.action).sort());
    if ("actions" in change) expect(entry.change).toEqual(change);
    expect(auditIds.has(entry.id)).toBe(false);
    auditIds.add(entry.id);
    expect(reloaded.version).toBe(entry.id);
  });
});
