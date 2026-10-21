import { expect, it, vi } from "vitest";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { conversationProviders } from "../src/services/conversation.js";

const fake = vi.hoisted(() => ({
  options: vi.fn(),
  start: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    constructor(options: unknown) {
      fake.options(options);
    }
    startThread(options: unknown) {
      fake.start(options);
      return {
        id: "fixture-thread",
        run: fake.run,
        runStreamed: async () => ({
          events: (async function* () {
            const result = await fake.run();
            for (const item of result.items) yield { type: "item.completed", item };
            if (result.usage) yield { type: "turn.completed", usage: result.usage };
          })(),
        }),
      };
    }
  },
}));

import { CodexExecutor } from "../src/integrations/models.js";

const task = {
  spec: TaskSpecSchema.parse({
    objective: "Reply in Turkish",
    capability: "text.generate",
    providers: ["codex-live"],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "non-empty" },
  }),
} as Task;

it("registers a separate conversation profile without weakening general Codex approval", async () => {
  const general = new CodexExecutor({ kind: "chatgpt" }, "fixture", "workspace", "home");
  expect(general.riskFloor).toBe("HIGH");
  const live = new CodexExecutor({ kind: "chatgpt" }, "fixture", "workspace", "home", {
    conversation: true,
  });
  expect(live.id).toBe("codex-live");
  expect(live.riskFloor).toBe("LOW");
  const options = fake.options.mock.lastCall?.[0];
  expect(options.config).toMatchObject({
    features: {
      shell_tool: false,
      apps: false,
      plugins: false,
      hooks: false,
      multi_agent: false,
      browser_use: false,
      computer_use: false,
      view_image: false,
      code_mode_host: false,
    },
    mcp_servers: {},
    project_doc_max_bytes: 0,
  });
  fake.run.mockResolvedValue({
    finalResponse: "Merhaba",
    items: [
      { type: "error", message: "Nonfatal runtime notice" },
      { type: "agent_message", text: "Merhaba" },
    ],
    usage: { input_tokens: 7, output_tokens: 2 },
  });
  expect(await live.execute(task, AbortSignal.timeout(1000))).toMatchObject({
    text: "Merhaba",
    usage: { inputTokens: 7, outputTokens: 2 },
  });
  expect(fake.start.mock.lastCall?.[0]).toMatchObject({
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });
  expect(conversationProviders(["codex", "codex-live"])).toEqual(["codex-live"]);
});

it("rejects unexpected tool execution and empty conversational output", async () => {
  const live = new CodexExecutor({ kind: "chatgpt" }, "fixture", "workspace", "home", {
    conversation: true,
  });
  for (const result of [
    { finalResponse: "done", items: [{ type: "mcp_tool_call" }] },
    { finalResponse: " ", items: [] },
  ]) {
    fake.run.mockResolvedValue(result);
    await expect(live.execute(task, AbortSignal.timeout(1000))).rejects.toThrow("invalid-response");
  }
});
