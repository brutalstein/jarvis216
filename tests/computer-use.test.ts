import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Content } from "@google/genai";
import { GuardError, type ToolResult } from "@jarvis/action-engine";
import { expect, it } from "vitest";
import { type Progress, type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import {
  type ComputerPort,
  type ComputerTurn,
  ComputerUseExecutor,
  chatMessages,
  geminiTurn,
} from "../src/integrations/computer-use.js";

function task(args: unknown = { task: "Open Notepad and type hello" }, risk = "HIGH"): Task {
  return {
    id: "6c0b1f9e-0a43-4d5c-9b6e-1f2a3b4c5d6e",
    correlation_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    principal: "operator",
    status: "RUNNING",
    fence: 1,
    owner: "w",
    lease_until: Date.now() + 60_000,
    calls: 0,
    attempt: 1,
    result: null,
    created_at: Date.now(),
    spec: TaskSpecSchema.parse({
      objective: "Do the task",
      capability: "tool.execute",
      input: { action: "computer.use", args },
      providers: ["computer-use"],
      risk,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "non-empty" },
    }),
  };
}
// A munim stand-in: answers each call from the table and records it.
function machine(answers: Record<string, ToolResult> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let closed = 0;
  const port: ComputerPort = {
    describe: async () =>
      ["list_apps", "click", "screenshot"].map((name) => ({
        name,
        description: `${name} tool`,
        inputSchema: { type: "object", properties: {} },
      })),
    call: async (name, args) => {
      calls.push({ name, args });
      if (name === "secret_tool") throw new GuardError("TOOL_NOT_ALLOWED");
      return answers[name] ?? { ok: true, text: `${name} ok` };
    },
    close: async () => {
      closed++;
    },
  };
  return { port, calls, closed: () => closed };
}
const call = (name: string, args: Record<string, unknown> = {}, id?: string): Content => ({
  role: "model",
  parts: [{ functionCall: { name, args, ...(id && { id }) } }],
});
// Replies in order and keeps a copy of what the model was shown each turn.
function brain(...replies: Content[]) {
  const seen: { system: string; tools: string[]; contents: Content[] }[] = [];
  const turn: ComputerTurn = async ({ system, tools, contents }) => {
    seen.push({
      system,
      tools: tools.map((tool) => tool.name ?? ""),
      contents: structuredClone(contents),
    });
    const reply = replies.shift();
    if (!reply) throw new Error("no more replies");
    return reply;
  };
  return { turn, seen };
}
const evidence = (result: { text: string }) => JSON.parse(result.text);
// Built at run time so secret scanners do not flag a made-up key.
const fakeKey = ["sk", "abcdefghijklmnopqrstuvwxyz123456"].join("-");

it("lets the model drive munim's tools until it reports done, streaming each move", async () => {
  const pc = machine({
    list_apps: { ok: true, text: `Notepad [notepad] api ${fakeKey}` },
    screenshot: { ok: true, text: "shot 1", images: [{ data: "AAAA", mimeType: "image/png" }] },
  });
  const { turn, seen } = brain(
    call("list_apps", {}, "c1"),
    call("screenshot", { app: "notepad" }),
    call("click", { element_id: "e3", return_state: true }),
    call("done", { success: true, summary: "Notepad shows hello" }),
  );
  const moves: Progress[] = [];
  const computer = new ComputerUseExecutor([turn], { createTools: () => pc.port });
  const result = await computer.execute(task(), new AbortController().signal, (update) =>
    moves.push(update),
  );
  expect(evidence(result)).toMatchObject({
    ok: true,
    evidence: "observed",
    observation: "Notepad shows hello",
    panel: { type: "text", title: "Bilgisayar", body: "Notepad shows hello" },
    data: { steps: 4 },
  });
  // The agent's own report is not an independent postcondition.
  expect(result.outcome).toBeUndefined();
  expect(pc.calls.map((item) => item.name)).toEqual(["list_apps", "screenshot", "click"]);
  expect(pc.calls[2]?.args).toEqual({ element_id: "e3", return_state: true });
  expect(pc.closed()).toBe(1);
  expect(moves.map((move) => move.detail)).toEqual(["list apps", "screenshot · notepad", "click"]);
  expect(moves.every((move) => move.stage === "acting" && move.total === 80)).toBe(true);
  // munim's tools plus done, and the operator's task first.
  expect(seen[0]?.tools).toEqual(["list_apps", "click", "screenshot", "done"]);
  expect(seen[0]?.contents).toEqual([
    { role: "user", parts: [{ text: "Open Notepad and type hello" }] },
  ]);
  expect(seen[0]?.system).toContain("look, act, verify");
  // Tool output answers its call by id, with key-shaped text masked.
  expect(seen[1]?.contents[2]).toEqual({
    role: "user",
    parts: [
      {
        functionResponse: {
          id: "c1",
          name: "list_apps",
          response: { output: "Notepad [notepad] api [secret]" },
        },
      },
    ],
  });
  // The screenshot reaches the next turn only, then leaves the context.
  expect(seen[2]?.contents.at(-1)?.parts?.[1]).toEqual({
    inlineData: { data: "AAAA", mimeType: "image/png" },
  });
  expect(JSON.stringify(seen[3]?.contents)).not.toContain("inlineData");
});

it("reports a task the model could not finish, and refuses what is not a HIGH computer task", async () => {
  const pc = machine({ click: { ok: false, text: "element e9 is gone" } });
  const { turn, seen } = brain(
    call("click", { element_id: "e9" }),
    call("secret_tool"),
    call("done", { success: false, summary: "The Save button never appeared" }),
  );
  const computer = new ComputerUseExecutor([turn], { createTools: () => pc.port });
  const failed = await computer.execute(task(), new AbortController().signal);
  expect(evidence(failed)).toMatchObject({
    ok: false,
    evidence: "failed",
    observation: "The Save button never appeared",
  });
  expect(failed.outcome).toEqual({ status: "failed", verified: false });
  // Tool errors and tools outside the allow-list go back to the model, which tries again.
  expect(seen[1]?.contents.at(-1)?.parts?.[0]?.functionResponse?.response).toEqual({
    error: "element e9 is gone",
  });
  expect(seen[2]?.contents.at(-1)?.parts?.[0]?.functionResponse?.response).toEqual({
    error: "Unknown tool secret_tool",
  });
  for (const bad of [
    task(undefined, "MEDIUM"),
    task({ task: "" }),
    task({ task: "x", extra: 1 }),
  ]) {
    const refused = await computer.execute(bad, new AbortController().signal);
    expect(refused.outcome).toEqual({ status: "blocked", verified: false });
  }
});

it("reminds a model that answers in prose once, and stops at the step limit", async () => {
  const prose: Content = { role: "model", parts: [{ text: "I think it is done." }] };
  const pc = machine();
  const talk = brain(prose, prose);
  const talker = new ComputerUseExecutor([talk.turn], { createTools: () => pc.port });
  const stopped = await talker.execute(task(), new AbortController().signal);
  expect(evidence(stopped)).toMatchObject({ ok: false, observation: "I think it is done." });
  expect(talk.seen[1]?.contents.at(-1)).toEqual({
    role: "user",
    parts: [{ text: "Continue with the tools, or call done." }],
  });
  const loop = brain(...Array.from({ length: 3 }, () => call("list_apps")));
  const looper = new ComputerUseExecutor([loop.turn], { maxSteps: 3, createTools: () => pc.port });
  const limited = await looper.execute(task(), new AbortController().signal);
  expect(evidence(limited).observation).toBe("Stopped after 3 steps");
  expect(limited.outcome).toEqual({ status: "incomplete", verified: false });
});

it("runs one computer task at a time and closes munim when the operator cancels", async () => {
  const pc = machine();
  const turn: ComputerTurn = (_request, signal) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const computer = new ComputerUseExecutor([turn], { createTools: () => pc.port });
  const controller = new AbortController();
  const first = computer.execute(task(), controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await computer.execute(task(), new AbortController().signal);
  expect(evidence(second).observation).toBe("Another computer task is running");
  controller.abort(new Error("operator cancelled"));
  await expect(first).rejects.toThrow("operator cancelled");
  expect(pc.closed()).toBe(1);
});

it("hands the same conversation to the next model when one fails, and fails when all do", async () => {
  const pc = machine();
  const limited: ComputerTurn = async () => {
    throw new ProviderFailure("rate-limited", true);
  };
  const first = brain(call("list_apps"));
  const second = brain(call("done", { success: true, summary: "ok" }));
  let calls = 0;
  const flaky: ComputerTurn = async (request, signal) =>
    ++calls === 1 ? first.turn(request, signal) : limited(request, signal);
  const computer = new ComputerUseExecutor([flaky, second.turn], { createTools: () => pc.port });
  expect(evidence(await computer.execute(task(), new AbortController().signal)).ok).toBe(true);
  // The second model saw the first one's call and its result.
  expect(second.seen[0]?.contents.map((content) => content.role)).toEqual([
    "user",
    "model",
    "user",
  ]);
  const failing = new ComputerUseExecutor(
    [
      limited,
      async () => {
        throw new ProviderFailure("authentication-required", false);
      },
    ],
    { createTools: () => pc.port },
  );
  await expect(failing.execute(task(), new AbortController().signal)).rejects.toMatchObject({
    kind: "authentication-required",
  });
});

// A stand-in for the claude binary: the model name picks how the run goes.
async function fakeClaude() {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-claude-"));
  const record = join(dir, "seen.json");
  const script = join(dir, "claude.mjs");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const model = argv[argv.indexOf("--model") + 1];
let stdin = "";
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv, stdin }));
  const say = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  say({ type: "system", subtype: "init" });
  if (model !== "limit")
    say({ type: "assistant", message: { content: [
      { type: "text", text: "looking" },
      { type: "tool_use", name: "mcp__munim__list_apps", input: {} },
      { type: "tool_use", name: "mcp__munim__click", input: { app: "notepad", element_id: "e1" } },
    ] } });
  if (model === "ok")
    return say({ type: "result", subtype: "success", is_error: false, result: "",
      structured_output: { success: true, summary: "Notepad shows hello; key " + "sk" + "-abcdefghijklmnopqrstuvwxyz123456" } });
  say({ type: "result", subtype: "success", is_error: true, result: "Claude usage limit reached" });
  process.exit(1);
});
`,
  );
  return { command: [process.execPath, script] as const, record };
}

it("lets Claude Code drive munim on the subscription, with only munim's tools", async () => {
  const claude = await fakeClaude();
  const moves: Progress[] = [];
  const computer = new ComputerUseExecutor([], {
    command: "munim",
    args: ["--serve"],
    claude: { command: claude.command, model: "ok" },
    createTools: () => {
      throw new Error("the model loop must not start");
    },
  });
  const result = await computer.execute(task(), new AbortController().signal, (update) =>
    moves.push(update),
  );
  expect(evidence(result)).toMatchObject({
    ok: true,
    evidence: "observed",
    observation: "Notepad shows hello; key [secret]",
    data: { steps: 2 },
  });
  expect(moves.map((move) => [move.detail, move.index])).toEqual([
    ["list apps", 1],
    ["click · notepad", 2],
  ]);
  const seen = JSON.parse(await readFile(claude.record, "utf8")) as {
    argv: string[];
    stdin: string;
  };
  expect(seen.stdin).toBe("Open Notepad and type hello");
  const flag = (name: string) => seen.argv[seen.argv.indexOf(name) + 1];
  expect(flag("--tools")).toBe("");
  expect(flag("--allowedTools")).toBe("mcp__munim");
  expect(flag("--permission-mode")).toBe("dontAsk");
  expect(JSON.parse(flag("--mcp-config") ?? "")).toEqual({
    mcpServers: { munim: { command: "munim", args: ["--serve"] } },
  });
  expect(seen.argv).toContain("--strict-mcp-config");
  expect(JSON.parse(flag("--json-schema") ?? "").required).toEqual(["success", "summary"]);
});

it("falls back to the models only when Claude stopped before touching the computer", async () => {
  const claude = await fakeClaude();
  const pc = machine();
  const backup = brain(call("done", { success: true, summary: "done by Gemini" }));
  const early = new ComputerUseExecutor([backup.turn], {
    claude: { command: claude.command, model: "limit" },
    createTools: () => pc.port,
  });
  expect(evidence(await early.execute(task(), new AbortController().signal)).observation).toBe(
    "done by Gemini",
  );
  // Claude already acted: starting over with another model could repeat its clicks.
  const late = new ComputerUseExecutor([backup.turn], {
    claude: { command: claude.command, model: "late" },
    createTools: () => pc.port,
  });
  await expect(late.execute(task(), new AbortController().signal)).rejects.toMatchObject({
    kind: "rate-limited",
  });
});

it("speaks OpenAI-style function calling to the free models", async () => {
  const contents: Content[] = [
    { role: "user", parts: [{ text: "go" }] },
    { role: "model", parts: [{ text: "ok" }, { functionCall: { name: "list_apps", args: {} } }] },
    {
      role: "user",
      parts: [
        { functionResponse: { name: "list_apps", response: { output: "Notepad" } } },
        { inlineData: { data: "AAAA", mimeType: "image/png" } },
      ],
    },
  ];
  expect(chatMessages("sys", contents)).toEqual([
    { role: "system", content: "sys" },
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "ok",
      tool_calls: [
        { id: "call_1_0", type: "function", function: { name: "list_apps", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1_0", content: '{"output":"Notepad"}' },
    {
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
    },
  ]);
});

it("asks Gemini with munim's tools as JSON-schema function declarations", async () => {
  const requests: unknown[] = [];
  const client = {
    models: {
      generateContent: async (request: unknown) => {
        requests.push(request);
        return { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] };
      },
    },
  } as unknown as Parameters<typeof geminiTurn>[2];
  const turn = geminiTurn("key", "gemini-test", client);
  const tools = [{ name: "click", parametersJsonSchema: { type: "object" } }];
  const contents: Content[] = [{ role: "user", parts: [{ text: "go" }] }];
  expect(
    await turn({ system: "be careful", tools, contents }, new AbortController().signal),
  ).toEqual({ role: "model", parts: [{ text: "ok" }] });
  expect(requests[0]).toMatchObject({
    model: "gemini-test",
    contents,
    config: { systemInstruction: "be careful", tools: [{ functionDeclarations: tools }] },
  });
  const denied = geminiTurn("key", "gemini-test", {
    models: {
      generateContent: async () => {
        throw Object.assign(new Error("denied"), { status: 403 });
      },
    },
  } as unknown as Parameters<typeof geminiTurn>[2]);
  await expect(
    denied({ system: "", tools, contents }, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "authentication-required" });
});
