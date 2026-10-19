import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/core/database.js";
import {
  boot,
  database,
  FakeModel,
  type Running,
  type Services,
  services,
  until,
} from "./harness.js";

const cases = ["public", "personal", "private", "local-only"].flatMap((privacy) => [
  {
    privacy,
    provider: "local",
    external: false,
    trusted: false,
    expected: "COMPLETED",
    risk: "LOW",
  },
  {
    privacy,
    provider: "external-trusted",
    external: true,
    trusted: true,
    expected: privacy === "local-only" ? "BLOCKED" : "COMPLETED",
    risk: "LOW",
  },
  {
    privacy,
    provider: "external-untrusted",
    external: true,
    trusted: false,
    expected:
      privacy === "local-only"
        ? "BLOCKED"
        : privacy === "private"
          ? "WAITING_FOR_APPROVAL"
          : "COMPLETED",
    risk: privacy === "private" ? "HIGH" : "LOW",
  },
]);
let db: Database;
let drop: (() => Promise<void>) | undefined;
let fakes: Services | undefined;
let running: Running | undefined;

beforeEach(async () => {
  ({ db, drop } = await database());
  fakes = await services();
});
afterEach(async () => {
  await running?.stop();
  await fakes?.close();
  await drop?.();
  running = undefined;
  fakes = undefined;
  drop = undefined;
});

describe("privacy × provider trust through the real Core", () => {
  it.each(cases)("$privacy / $provider → $expected", async (row) => {
    const model = new FakeModel();
    running = await boot(
      db,
      {
        ...fakes!.env,
        ENABLE_DESKTOP: "false",
        ENABLE_BROWSER: "false",
        ENABLE_OPENCLAW: "false",
        ENABLE_N8N: "false",
        JARVIS_PRIVATE_PROVIDERS: row.trusted ? "gemini-live" : "",
      },
      model,
      [{ ...model.executor("gemini-live"), external: row.external }],
    );
    const task = await running.core.tasks.create(
      {
        objective: "Summarise this synthetic note",
        capability: "text.generate",
        providers: ["gemini-live"],
        privacy: row.privacy,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        verification: { kind: "non-empty" },
      },
      `${row.privacy}-${row.provider}`,
      "operator",
    );
    const settled = await until(
      () => running!.core.tasks.get(task.id),
      (current) => current.status === row.expected,
    );
    expect(settled.status).toBe(row.expected);
    const actions = await running.core.tasks.actions(task.id);
    if (row.expected === "BLOCKED") {
      expect(actions).toEqual([]);
      expect(model.prompts).toEqual([]);
      return;
    }
    expect(actions).toHaveLength(1);
    expect(actions[0]?.risk).toBe(row.risk);
    if (row.expected === "WAITING_FOR_APPROVAL") {
      expect(actions[0]?.status).toBe("AWAITING_APPROVAL");
      expect(model.prompts).toEqual([]);
      const approval = await running.api("POST", `/v1/actions/${actions[0]!.id}/approve`, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(approval.status).toBe(204);
      await until(
        () => running!.core.tasks.get(task.id),
        (current) => current.status === "COMPLETED",
      );
    }
    expect((await running.core.tasks.actions(task.id))[0]?.status).toBe("SUCCEEDED");
    expect(model.prompts).toHaveLength(1);
  });
});
