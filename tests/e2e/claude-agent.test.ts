import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/core/database.js";
import { ClaudeCodeExecutor } from "../../src/integrations/claude-code.js";
import {
  boot,
  database,
  FakeModel,
  type Running,
  type Services,
  services,
  until,
} from "./harness.js";

// End-to-end through Core -> plan -> exact approval -> Gateway -> native CLI protocol.
// Only the real vendor executable and its external subscription are substituted.
const fixture = resolve("tests/fixtures/fake-claude.mjs");
let db: Database;
let drop: () => Promise<void>;
let fakes: Services;
let model: FakeModel;
let running: Running;
let directory: string;
let record: string;

beforeEach(async () => {
  ({ db, drop } = await database());
  fakes = await services();
  model = new FakeModel();
  directory = await mkdtemp(join(tmpdir(), "jarvis-agent-e2e-"));
  record = join(directory, "cli.json");
  const executable = new ClaudeCodeExecutor({
    command: [process.execPath, fixture, "success", record],
    model: "test-model",
    workdir: directory,
    agent: { permissionMode: "auto", maxTurns: 8 },
  });
  running = await boot(
    db,
    {
      ...fakes.env,
      ENABLE_CLAUDE_AGENT: "true",
      CLAUDE_CODE_PATH: process.execPath,
      CLAUDE_CODE_MODEL: "test-model",
    },
    model,
    [model.executor("gemini-live"), executable],
  );
}, 60_000);

afterEach(async () => {
  await running?.stop();
  await fakes?.close();
  await drop?.();
  await rm(directory, { recursive: true, force: true });
}, 60_000);

describe("Claude Code tool-agent lifecycle", () => {
  it("keeps the fixture CLI behind both approvals and preserves unverified outcomes", async () => {
    model.turns.push({
      intent: {
        kind: "plan",
        goal: "Build the operator's project",
        steps: [{ action: "agent.execute", args: { instruction: "Create the requested project" } }],
      },
    });
    model.briefs.push("Görev tamamlandı, efendim.");
    const turn = await running.api<{ planId?: string }>("POST", "/v1/conversation/turns", {
      utterance: "Jarvis, projeyi benim için oluştur",
    });
    expect(turn.status).toBe(200);
    const planId = turn.body.planId;
    expect(planId).toBeTruthy();
    const plan = await running.core.plans.get(planId!);
    expect(plan.status).toBe("AWAITING_APPROVAL");
    expect(plan.steps[0]).toMatchObject({ action: "agent.execute", risk: "HIGH" });
    await expect(readFile(record, "utf8")).rejects.toThrow();
    expect(
      (await running.api("POST", `/v1/plans/${planId}/approve`, { hash: "forged" })).status,
    ).toBe(409);
    expect(
      (await running.api("POST", `/v1/plans/${planId}/approve`, { hash: plan.hash })).status,
    ).toBe(204);
    const pending = await until(
      () => running.core.plans.get(planId!),
      (current) => Boolean(current.steps[0]?.approval),
    );
    const approvalId = pending.steps[0]?.approval?.id;
    expect(approvalId).toBeTruthy();
    await expect(readFile(record, "utf8")).rejects.toThrow();
    expect(
      (
        await running.api("POST", `/v1/actions/${approvalId}/approve`, {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
      ).status,
    ).toBe(204);
    const completed = await until(
      () => running.core.plans.get(planId!),
      (current) => current.status === "RECOVERY_REQUIRED",
      20_000,
    );
    expect(completed.steps[0]?.status).toBe("RECOVERY_REQUIRED");
    const call = JSON.parse(await readFile(record, "utf8")) as {
      argv: string[];
      stdin: string;
    };
    expect(call.stdin).toBe("Create the requested project");
    expect(call.argv).toContain("--max-turns");
    expect(call.argv).toContain("user,project,local");
    expect(call.argv).not.toContain("--disable-slash-commands");
    const actions = await db.query<{ target: string; status: string }>(
      "SELECT target, status FROM actions WHERE target='claude-agent'",
    );
    expect(actions.rows).toEqual([
      expect.objectContaining({ target: "claude-agent", status: "UNCERTAIN" }),
    ]);
  });
});
