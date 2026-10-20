import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { catalog } from "@jarvis/action-engine";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/core/database.js";
import type { PermissionView } from "../../src/services/permissions.js";
import {
  boot,
  database,
  FakeModel,
  type Running,
  type Services,
  services,
  until,
} from "./harness.js";
import type { generateCases } from "./matrix/generate.js";

const cases = JSON.parse(
  readFileSync(new URL("./matrix/coverage.cases.json", import.meta.url), "utf8"),
) as ReturnType<typeof generateCases>;
let db: Database;
let drop: (() => Promise<void>) | undefined;
let fakes: Services | undefined;
let running: Running | undefined;
let release = () => {};
let workspace: string | undefined;
let home: string | undefined;

beforeAll(async () => {
  for (const root of ["data/workspaces", "data/codex-homes"])
    await mkdir(root, { recursive: true });
  workspace = await mkdtemp(join(resolve("data/workspaces"), "e2e-topology-"));
  home = await mkdtemp(join(resolve("data/codex-homes"), "e2e-topology-"));
});
afterAll(async () => {
  // Only the empty directories returned by mkdtemp; never the operator's homes/workspaces.
  if (workspace) await rm(workspace, { recursive: true });
  if (home) await rm(home, { recursive: true });
});
beforeEach(async () => {
  ({ db, drop } = await database());
  fakes = await services();
});
afterEach(async () => {
  release();
  await running?.stop();
  await fakes?.close();
  await drop?.();
  running = undefined;
  fakes = undefined;
  drop = undefined;
});

describe("generated pairwise configuration rows through Core", () => {
  it.each(cases.topology)("$id", async (row) => {
    const model = new FakeModel();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = row.provider!;
    running = await boot(
      db,
      {
        ...fakes!.env,
        ...Object.fromEntries(
          ["desktop", "news", "browser", "openclaw", "n8n", "codex"].map((flag) => [
            `ENABLE_${flag.toUpperCase()}`,
            String(row[flag] === "on"),
          ]),
        ),
        CODEX_ISOLATION_VERIFIED: "true",
        CODEX_MODEL: "fixture-model",
        CODEX_WORKSPACE: workspace!,
        CODEX_ISOLATED_HOME: home!,
        CODEX_AUTH: "api-key",
        OPENAI_API_KEY: randomBytes(24).toString("hex"),
      },
      model,
      [
        ...(provider === "none" ? [] : [model.executor(provider)]),
        {
          id: "busy-fixture",
          capability: "text.generate",
          external: false,
          retrySafe: true,
          execute: async () => {
            await gate;
            return { text: "Background complete", source: "busy-fixture" };
          },
        },
      ],
    );
    const ready = await running.api<{ providers: { id: string }[] }>("GET", "/readyz");
    expect(ready.status).toBe(200);
    const ids = ready.body.providers.map((p) => p.id);
    for (const [flag, id] of [
      ["desktop", "windows-mcp"],
      ["news", "news"],
      ["browser", "browser-use"],
      ["openclaw", "openclaw"],
      ["n8n", "n8n"],
      ["codex", "codex"],
    ] as const)
      expect(ids.includes(id), flag).toBe(row[flag] === "on");

    const enabled = new Set([
      ...Object.values(catalog)
        .filter((a) => a.kind === "memory" || (a.kind === "desktop" && row.desktop === "on"))
        .map((a) => a.id),
      ...(row.news === "on" ? ["news.brief"] : []),
      ...(row.browser === "on" ? ["browser.read", "browser.read_many"] : []),
      ...(row.openclaw === "on" ? ["agent.delegate"] : []),
      ...(row.n8n === "on" ? ["automation.invoke"] : []),
    ]);
    const permissions = await running.api<PermissionView>("GET", "/v1/permissions");
    expect(permissions.status).toBe(200);
    expect(permissions.body.actions).toHaveLength(Object.keys(catalog).length);
    for (const action of permissions.body.actions)
      expect(action.available, action.id).toBe(enabled.has(action.id));

    const busy: string[] = [];
    if (row.load === "busy") {
      for (let i = 0; i < 2; i++) {
        const task = await running.core.tasks.create(
          {
            objective: "Hold background capacity",
            capability: "text.generate",
            providers: ["busy-fixture"],
            lane: "background",
            deadline: new Date(Date.now() + 60_000).toISOString(),
            verification: { kind: "non-empty" },
          },
          `load-${i}`,
          "operator",
        );
        busy.push(task.id);
      }
      await until(
        () => Promise.all(busy.map((id) => running!.core.tasks.get(id))),
        (tasks) => tasks.every((task) => task.status === "RUNNING"),
      );
    }
    const utterances: Record<string, string> = {
      tr: "Jarvis, merhaba",
      en: "Jarvis, hello",
      mixed: "Jarvis, bugün how are you",
    };
    const utterance = utterances[row.language!]!;
    const turn = await running.api<{ taskId?: string; provider?: string; error?: string }>(
      "POST",
      "/v1/conversation/turns",
      { utterance },
    );
    expect(turn.status).toBe(provider === "none" ? 503 : 200);
    if (provider === "none") {
      expect(turn.body.error).toBe("NO_PROVIDER");
      expect(model.prompts).toHaveLength(0);
      expect((await db.query("SELECT id FROM conversation_turns")).rows).toEqual([]);
    } else {
      expect(turn.body.provider).toBe(provider);
      expect(model.prompts).toHaveLength(1);
      expect(model.prompts[0]!.prompt).toContain(utterance);
      for (const action of Object.keys(catalog))
        expect(model.prompts[0]!.prompt.includes(`${action}(`), action).toBe(enabled.has(action));
      expect(await running.core.tasks.get(turn.body.taskId!)).toMatchObject({
        status: "COMPLETED",
      });
      expect(await running.core.tasks.actions(turn.body.taskId!)).toEqual([
        expect.objectContaining({ target: provider, status: "SUCCEEDED" }),
      ]);
    }
    for (const id of busy)
      expect(await running.core.tasks.get(id)).toMatchObject({ status: "RUNNING" });
    expect(
      (
        await db.query("SELECT target FROM actions WHERE target NOT IN ($1, 'busy-fixture')", [
          provider,
        ])
      ).rows,
    ).toEqual([]);
    expect(fakes!.browser.calls).toEqual([]);
    expect(fakes!.openclaw.calls).toEqual([]);
    expect(fakes!.workflow.calls).toEqual([]);
  });
});
