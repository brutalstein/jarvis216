import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/contracts.js";
import { ClaudeCodeExecutor, claudeCodeEnvKeys } from "../src/integrations/claude-code.js";
import { ProviderFailure } from "../src/routing.js";

const fixture = path.resolve("tests/fixtures/fake-claude.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-claude-code-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const flags = [
  "-p",
  "--output-format",
  "json",
  "--model",
  "test-model",
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--safe-mode",
];

function task(objective = "Return verified"): Task {
  return {
    id: "cdad17bd-0bf0-4609-bddb-e5c2f6285015",
    correlation_id: "df115bb0-e318-437a-9913-89fb752eb441",
    principal: "operator",
    status: "RUNNING",
    fence: 1,
    owner: "w",
    lease_until: Date.now() + 10_000,
    calls: 0,
    attempt: 1,
    result: null,
    created_at: Date.now(),
    spec: TaskSpecSchema.parse({
      objective,
      capability: "text.generate",
      providers: ["claude-code"],
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "contains", value: "verified" },
    }),
  };
}
let n = 0;
function run(
  mode: string,
  objective?: string,
  script = fixture,
  signal?: AbortSignal,
  binary = process.execPath,
) {
  const record = path.join(dir, `record-${n++}.json`);
  const executor = new ClaudeCodeExecutor({
    command: [binary, script, mode, record],
    model: "test-model",
    workdir: dir,
  });
  const recorded = () =>
    JSON.parse(readFileSync(record, "utf8")) as {
      argv: string[];
      env: Record<string, string>;
      stdin: string;
      pid: number;
    };
  return {
    result: executor.execute(task(objective), signal ?? new AbortController().signal),
    recorded,
  };
}
async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderFailure);
  return error as ProviderFailure;
}

describe("Claude Code subscription executor", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("success returns text, source and session id", async () => {
    const { result } = run("success");
    expect(await result).toEqual({
      text: "verified",
      source: "claude-code:test-model:subscription",
      externalId: "s-1",
    });
  });

  it("argv carries the fixed flags and no objective", async () => {
    const { result, recorded } = run("success", "Secret objective text");
    await result;
    expect(recorded().argv).toEqual(flags);
    expect(recorded().argv.join(" ")).not.toContain("Secret objective text");
  });

  it("long objective travels on stdin", async () => {
    const objective = "o".repeat(16_000);
    const { result, recorded } = run("success", objective);
    await result;
    expect(recorded().stdin).toBe(objective);
  });

  it("child env is the allowlist only", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-should-not-pass";
    const { result, recorded } = run("success");
    await result;
    const keys = Object.keys(recorded().env);
    // Windows injects these even when spawn receives an empty environment.
    const osKeys =
      process.platform === "win32"
        ? [
            "HOMEDRIVE",
            "HOMEPATH",
            "LOGONSERVER",
            "SYSTEMDRIVE",
            "USERDOMAIN",
            "USERNAME",
            "WINDIR",
          ]
        : [];
    expect(keys).not.toContain("ANTHROPIC_API_KEY");
    for (const key of Object.keys(process.env).filter(
      (k) => !(claudeCodeEnvKeys as readonly string[]).includes(k),
    ))
      if (!osKeys.includes(key.toUpperCase())) expect(keys).not.toContain(key);
  });

  it("not logged in is authentication-required and not dispatched", async () => {
    const error = await failure(run("login").result);
    expect(error.kind).toBe("authentication-required");
    expect(error.dispatched).toBe(false);
  });

  it("usage limit result is rate-limited", async () => {
    const error = await failure(run("limit").result);
    expect(error.kind).toBe("rate-limited");
    expect(error.retryable).toBe(true);
  });

  it("noise around JSON is invalid-response", async () => {
    expect((await failure(run("noise").result)).kind).toBe("invalid-response");
  });

  it("organization subscription denial is policy-denied", async () => {
    const error = await failure(run("organization-denied").result);
    expect(error.kind).toBe("policy-denied");
    expect(error.retryable).toBe(false);
  });

  it("oversized stdout is invalid-response", async () => {
    expect((await failure(run("huge").result)).kind).toBe("invalid-response");
  });

  it("stdout limit counts UTF-8 bytes", async () => {
    expect((await failure(run("multibyte").result)).kind).toBe("invalid-response");
  });

  it("an already aborted signal never launches the child", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before dispatch"));
    const { result, recorded } = run("success", undefined, fixture, controller.signal);
    await expect(result).rejects.toThrow("cancelled before dispatch");
    expect(recorded).toThrow();
  });

  it("missing binary is provider-unavailable and not dispatched", async () => {
    const executor = new ClaudeCodeExecutor({
      command: ["C:/nonexistent/claude.exe"],
      model: "test-model",
      workdir: dir,
    });
    const error = await failure(executor.execute(task(), new AbortController().signal));
    expect(error.kind).toBe("provider-unavailable");
    expect(error.dispatched).toBe(false);
  });

  it("abort kills the child", async () => {
    const controller = new AbortController();
    const { result, recorded } = run("hang", undefined, fixture, controller.signal);
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    await expect(result).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2000);
    const pid = recorded().pid;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("binary path with spaces spawns", async () => {
    const spaced = path.join(dir, "fake claude");
    mkdirSync(spaced, { recursive: true });
    const script = path.join(spaced, "fake claude.mjs");
    copyFileSync(fixture, script);
    const binary = path.join(spaced, path.basename(process.execPath));
    copyFileSync(process.execPath, binary);
    expect((await run("success", undefined, script, undefined, binary).result).text).toBe(
      "verified",
    );
  });
});
