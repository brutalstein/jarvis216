import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { type Content, type FunctionDeclaration, GoogleGenAI, type Part } from "@google/genai";
import { GuardError, McpToolPort, type ToolResult } from "@jarvis/action-engine";
import { z } from "zod";
import {
  type ExecutionResult,
  type Executor,
  type Progress,
  type Task,
  taskDeadline,
} from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";
import { claudeCodeEnvKeys, failure as claudeFailure } from "./claude-code.js";
import { jsonRequest, serviceUrl } from "./http.js";
import { keyShaped } from "./interactive-browser.js";
import { classify } from "./models.js";

export const computerActionSchemas = {
  "computer.use": z.strictObject({ task: z.string().trim().min(1).max(2000) }),
};
// munim-computer-use: accessibility-first control of every desktop app (background input where
// the app allows it), the operator's signed-in Chrome through its extension, and the operator's
// own allow/ask/block rules per app and site in its policy.json.
export const computerTools = [
  "list_apps",
  "get_app_state",
  "screenshot",
  "zoom",
  "list_displays",
  "click",
  "right_click",
  "hover",
  "drag",
  "scroll",
  "type_text",
  "set_value",
  "select_text",
  "press_key",
  "activate_app",
  "wait",
  "clipboard_read",
  "clipboard_write",
  "browser_open_tab",
  "browser_list_tabs",
  "browser_use_tab",
  "browser_release_tab",
  "browser_select_tab",
  "browser_navigate",
  "browser_snapshot",
  "browser_read",
  "browser_click",
  "browser_type",
  "browser_request_credentials",
  "browser_press_key",
  "browser_close_tab",
  "browser_close_all_tabs",
];
export interface ComputerPort {
  describe(): Promise<{ name: string; description: string; inputSchema: unknown }[]>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
  close(): Promise<void>;
}
/** One model turn: the next reply (text and/or function calls) for the conversation so far. */
export type ComputerTurn = (
  request: { system: string; tools: FunctionDeclaration[]; contents: Content[] },
  signal: AbortSignal,
) => Promise<Content>;

const done: FunctionDeclaration = {
  name: "done",
  description:
    "Finish the task. Call it once the goal is reached and you have seen the result on screen, " +
    "or when it cannot be reached (success false, with the reason).",
  parametersJsonSchema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      summary: {
        type: "string",
        description:
          "What you did and what you observed that proves it, in the operator's language",
      },
    },
    required: ["success", "summary"],
  },
};
const finished = z.object({ success: z.boolean(), summary: z.string().trim().min(1).max(4000) });
const system = (now: Date, finish = "Finish with done.") =>
  [
    "You are JARVIS operating the operator's Windows computer with munim-computer-use tools. " +
      "Do the whole task yourself, step by step, until it is done.",
    "Work look, act, verify: list_apps for the exact app value, get_app_state for element ids " +
      "(use query to find a control by label), act by element id with return_state: true so " +
      "the result shows the new state, and screenshot or zoom only when the tree cannot show it.",
    "An app that is not running: press_key key='win', type its name with type_text, then " +
      "press_key key='return', wait, and list_apps again.",
    "Web pages: browser_* tools work in the operator's signed-in Chrome when its extension is " +
      "connected; otherwise drive the browser window like any other app.",
    "Never type passwords or secrets yourself: use browser_request_credentials so the operator " +
      "signs in. Do not buy, send money, delete data or send messages beyond what the task " +
      "explicitly asks. A refused app or site is the operator's rule: do not work around it.",
    "The operator's own windows, tabs and documents stay as they are: open a new window, tab or " +
      "document for the task unless it names an existing one. Keystrokes go to whatever has " +
      "focus, so set_value or click the target field by id before type_text and press_key.",
    "If an action fails, read the state again and try another way; do not repeat a click that " +
      "may already have worked without looking first.",
    `Now: ${now.toISOString()}. ${finish}`,
  ].join("\n");

/**
 * Gemini function calling. A per-minute free-tier limit waits and retries; a spent daily quota
 * fails at once so the next model takes over.
 */
export function geminiTurn(key: string, model: string, client?: GoogleGenAI): ComputerTurn {
  const gemini =
    client ??
    new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        baseUrl: "https://generativelanguage.googleapis.com",
        retryOptions: { attempts: 1 },
      },
    });
  return async ({ system, tools, contents }, signal) => {
    for (let attempt = 1; ; attempt++) {
      let daily = false;
      try {
        const result = await classify(() =>
          gemini.models
            .generateContent({
              model,
              contents,
              config: {
                systemInstruction: system,
                tools: [{ functionDeclarations: tools }],
                maxOutputTokens: 8192,
                abortSignal: signal,
              },
            })
            .catch((error: unknown) => {
              daily = /PerDay/.test(error instanceof Error ? error.message : "");
              throw error;
            }),
        );
        const content = result.candidates?.[0]?.content;
        if (!content?.parts?.length) throw new ProviderFailure("invalid-response", true);
        return { role: "model", parts: content.parts };
      } catch (error) {
        if (
          !(error instanceof ProviderFailure) ||
          error.kind !== "rate-limited" ||
          daily ||
          attempt >= 4
        )
          throw error;
        await sleep(attempt * 10_000, undefined, { signal });
      }
    }
  };
}

const ChatSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().max(256),
                function: z.object({ name: z.string().max(128), arguments: z.string() }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
});
type ChatMessage = Record<string, unknown>;
/** The conversation as OpenAI chat messages; calls without ids get stable ones by position. */
export function chatMessages(system: string, contents: Content[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: system }];
  let pending: string[] = [];
  for (const [index, content] of contents.entries()) {
    const parts = content.parts ?? [];
    const text = parts.flatMap((part) => (part.text && !part.thought ? [part.text] : [])).join("");
    if (content.role === "model") {
      const calls = parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
      pending = calls.map((call, n) => call.id ?? `call_${index}_${n}`);
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length && {
          tool_calls: calls.map((call, n) => ({
            id: pending[n],
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
          })),
        }),
      });
      continue;
    }
    let n = 0;
    for (const part of parts)
      if (part.functionResponse)
        messages.push({
          role: "tool",
          tool_call_id: part.functionResponse.id ?? pending[n++] ?? `call_${index}_${n}`,
          content: JSON.stringify(part.functionResponse.response ?? {}),
        });
    const images = parts.flatMap((part) =>
      part.inlineData
        ? [
            {
              type: "image_url",
              image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
            },
          ]
        : [],
    );
    if (text || images.length)
      messages.push({
        role: "user",
        content: images.length ? [...(text ? [{ type: "text", text }] : []), ...images] : text,
      });
  }
  return messages;
}

/** OpenAI-compatible function calling (OpenRouter, NVIDIA): the free fallback models. */
export function chatTurn(options: {
  base: string;
  key: string;
  model: string;
  extraBody?: Record<string, unknown>;
  timeoutMs?: number;
}): ComputerTurn {
  return async ({ system, tools, contents }, signal) => {
    // Free endpoints sometimes hang; a per-call limit lets the next model take over in time.
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 90_000);
    let body: unknown;
    try {
      body = await jsonRequest(
        `${serviceUrl(options.base)}/chat/completions`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${options.key}`, "content-type": "application/json" },
          body: JSON.stringify({
            ...options.extraBody,
            model: options.model,
            messages: chatMessages(system, contents),
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parametersJsonSchema,
              },
            })),
            max_tokens: 8192,
          }),
        },
        AbortSignal.any([signal, timeout]),
      );
    } catch (error) {
      if (error instanceof ProviderFailure || signal.aborted) throw error;
      throw new ProviderFailure(timeout.aborted ? "provider-unavailable" : "transient", true);
    }
    const message = ChatSchema.safeParse(body).data?.choices[0]?.message;
    const parts: Part[] = [
      ...(message?.content?.trim() ? [{ text: message.content }] : []),
      ...(message?.tool_calls ?? []).map((call) => {
        let args: Record<string, unknown> = {};
        try {
          args = z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(call.function.arguments || "{}"));
        } catch {}
        return { functionCall: { id: call.id, name: call.function.name, args } };
      }),
    ];
    if (!parts.length) throw new ProviderFailure("invalid-response", true);
    return { role: "model", parts };
  };
}

const evidence = (
  ok: boolean,
  kind: "observed" | "refused" | "incomplete" | "failed",
  observation: string,
  steps: number,
): ExecutionResult => ({
  text: JSON.stringify({
    ok,
    evidence: kind,
    observation,
    provenance: "standalone:munim-computer-use",
    panel: { type: "text", title: "Bilgisayar", body: observation },
    data: { steps },
  }),
  source: `munim-computer-use:${kind}`,
  // A finished task is the agent's own report after looking at the screen, not an independent
  // postcondition, so success carries no verified outcome; failures are definite.
  ...(!ok && {
    outcome: {
      status: kind === "refused" ? "blocked" : kind === "failed" ? "failed" : "incomplete",
      verified: false,
    },
  }),
});
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n[... ${text.length - max} more characters]` : text;
const label = (name: string, args: Record<string, unknown>) =>
  [name.replace(/_/g, " "), typeof args.app === "string" ? args.app : undefined]
    .filter(Boolean)
    .join(" · ");

const ClaudeResult = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: finished.optional().catch(undefined),
});
const reportSchema = done.parametersJsonSchema;

/**
 * Runs one open-ended computer task. Claude Code (the operator's subscription) drives munim
 * first; when it is unavailable before touching anything, the models in order drive munim's
 * tools here, each taking over from the last when it fails.
 */
export class ComputerUseExecutor implements Executor {
  readonly id = "computer-use";
  readonly capability = "tool.execute";
  readonly external = true;
  readonly retrySafe = false;
  readonly riskFloor = "HIGH" as const;
  private busy = false;
  private maxSteps: number;
  private now: () => Date;
  private server: { command: string; args: string[] };
  private claude?: { command: readonly [string, ...string[]]; model: string };
  private createTools: () => ComputerPort;
  constructor(
    private turns: ComputerTurn[],
    options: {
      command?: string;
      args?: string[];
      claude?: { command: readonly [string, ...string[]]; model: string };
      maxSteps?: number;
      createTools?: () => ComputerPort;
      now?: () => Date;
    } = {},
  ) {
    this.maxSteps = options.maxSteps ?? 80;
    this.now = options.now ?? (() => new Date());
    this.server = {
      command: options.command ?? "npx",
      args: options.args ?? ["-y", "munim-computer-use@0.7.3"],
    };
    if (options.claude) this.claude = options.claude;
    this.createTools =
      options.createTools ??
      (() => new McpToolPort({ ...this.server, env: {}, allow: computerTools }));
  }

  // The official binary, headless, with munim as its only tools and the subscription login.
  private runClaude(
    goal: string,
    signal: AbortSignal,
    onTool: (name: string, args: Record<string, unknown>) => void,
  ): Promise<z.infer<typeof finished> | string> {
    const claude = this.claude as { command: readonly [string, ...string[]]; model: string };
    const flags = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      claude.model,
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: { munim: this.server } }),
      "--allowedTools",
      "mcp__munim",
      "--permission-mode",
      "dontAsk",
      "--max-turns",
      String(this.maxSteps),
      "--append-system-prompt",
      system(this.now(), "Finish with the structured result: success and a summary."),
      "--json-schema",
      JSON.stringify(reportSchema),
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
    ];
    const env = {
      ...Object.fromEntries(
        claudeCodeEnvKeys.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
      ),
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
    };
    return new Promise((resolve, reject) => {
      const child = spawn(claude.command[0], [...claude.command.slice(1), ...flags], {
        cwd: tmpdir(),
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "";
      let stderr = "";
      let result: unknown;
      const read = (line: string) => {
        let event: {
          type?: string;
          message?: { content?: { type?: string; name?: unknown; input?: unknown }[] };
        };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === "result") result = event;
        if (event.type === "assistant")
          // Only munim's tools are moves on the computer; the structured report is not.
          for (const item of event.message?.content ?? [])
            if (item.type === "tool_use" && /^mcp__munim__/.test(String(item.name)))
              onTool(
                String(item.name).replace(/^mcp__munim__/, ""),
                (item.input ?? {}) as Record<string, unknown>,
              );
      };
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        buffer += chunk;
        for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
          read(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
        }
        // One event line carries at most a screenshot; anything larger is not Claude Code.
        if (buffer.length > 32 * 1024 * 1024) child.kill();
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
      });
      child.on("error", () => {
        signal.removeEventListener("abort", abort);
        reject(new ProviderFailure("provider-unavailable", true, false));
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
        read(buffer);
        const parsed = ClaudeResult.safeParse(result);
        if (!parsed.success) return reject(claudeFailure(stderr));
        if (parsed.data.subtype === "error_max_turns")
          return resolve(`Stopped after ${this.maxSteps} steps`);
        if (parsed.data.is_error || code !== 0)
          return reject(claudeFailure(`${parsed.data.result ?? ""} ${stderr}`));
        resolve(parsed.data.structured_output ?? parsed.data.result ?? "");
      });
      child.stdin.on("error", () => {});
      child.stdin.end(goal);
    });
  }

  // Nothing key-shaped on screen reaches the model or the operator's transcript.
  async execute(
    task: Task,
    signal: AbortSignal,
    progress?: (update: Progress) => void,
  ): Promise<ExecutionResult> {
    const input = z
      .strictObject({
        action: z.literal("computer.use"),
        args: computerActionSchemas["computer.use"],
      })
      .safeParse(task.spec.input);
    if (task.spec.capability !== this.capability || !input.success || task.spec.risk !== "HIGH")
      return evidence(false, "refused", "Invalid computer task", 0);
    if (this.busy) return evidence(false, "incomplete", "Another computer task is running", 0);
    this.busy = true;
    const bounded = AbortSignal.any([
      signal,
      AbortSignal.timeout(Math.max(1, taskDeadline(task) - Date.now())),
    ]);
    const act = (name: string, args: Record<string, unknown>) =>
      progress?.({ stage: "acting", detail: label(name, args), index: step, total: this.maxSteps });
    let step = 0;
    let port: ComputerPort | undefined;
    try {
      if (this.claude) {
        try {
          const report = await this.runClaude(input.data.args.task, bounded, (name, args) => {
            step++;
            act(name, args);
          });
          if (typeof report === "string")
            return evidence(
              false,
              "incomplete",
              clip(report.replace(keyShaped, "[secret]") || "Finished without a report", 2000),
              step,
            );
          const summary = report.summary.replace(keyShaped, "[secret]");
          return evidence(report.success, report.success ? "observed" : "failed", summary, step);
        } catch (error) {
          // Another model may start over only when Claude has not touched the computer yet.
          if (!(error instanceof ProviderFailure) || step > 0 || !this.turns.length) throw error;
        }
      }
      port = this.createTools();
      let current = 0;
      const turn: ComputerTurn = async (request, signal) => {
        for (;;) {
          const model = this.turns[current];
          if (!model) throw new ProviderFailure("provider-unavailable", false);
          try {
            return await model(request, signal);
          } catch (error) {
            // The next model continues the same conversation where this one stopped.
            if (!(error instanceof ProviderFailure) || signal.aborted || !this.turns[current + 1])
              throw error;
            current++;
          }
        }
      };
      const tools: FunctionDeclaration[] = [
        ...(await port.describe()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.inputSchema,
        })),
        done,
      ];
      const contents: Content[] = [{ role: "user", parts: [{ text: input.data.args.task }] }];
      let nudged = false;
      while (step < this.maxSteps) {
        step++;
        const reply = await turn({ system: system(this.now()), tools, contents }, bounded);
        contents.push(reply);
        const calls = (reply.parts ?? []).flatMap((part) =>
          part.functionCall ? [part.functionCall] : [],
        );
        if (!calls.length) {
          // A reply in prose instead of a tool call gets one reminder, then the task stops.
          const said = (reply.parts ?? [])
            .map((part) => part.text ?? "")
            .join("")
            .trim();
          if (nudged)
            return evidence(
              false,
              "incomplete",
              clip(said.replace(keyShaped, "[secret]") || "Stopped without finishing", 2000),
              step,
            );
          nudged = true;
          contents.push({
            role: "user",
            parts: [{ text: "Continue with the tools, or call done." }],
          });
          continue;
        }
        nudged = false;
        const responses: Part[] = [];
        const images: Part[] = [];
        for (const call of calls) {
          const name = call.name ?? "";
          const args = call.args ?? {};
          if (name === "done") {
            const report = finished.safeParse(args);
            if (!report.success)
              return evidence(false, "incomplete", "Finished without a report", step);
            const summary = report.data.summary.replace(keyShaped, "[secret]");
            return evidence(
              report.data.success,
              report.data.success ? "observed" : "failed",
              summary,
              step,
            );
          }
          act(name, args);
          let out: ToolResult;
          try {
            out = await port.call(name, args, bounded);
          } catch (error) {
            if (!(error instanceof GuardError)) throw error;
            out = { ok: false, text: `Unknown tool ${name}` };
          }
          const text = clip(out.text.replace(keyShaped, "[secret]"), 20_000);
          responses.push({
            functionResponse: {
              ...(call.id && { id: call.id }),
              name,
              response: out.ok ? { output: text } : { error: text || "Tool failed" },
            },
          });
          for (const image of out.images ?? []) images.push({ inlineData: image });
        }
        // Only the newest screenshot stays and older tool output shrinks, so long tasks fit.
        for (const [index, content] of contents.entries()) {
          if (content.role !== "user" || index === 0) continue;
          content.parts = (content.parts ?? []).filter((part) => !part.inlineData);
          if (index < contents.length - 6)
            for (const part of content.parts) {
              const response = part.functionResponse?.response;
              for (const key of ["output", "error"])
                if (response && typeof response[key] === "string")
                  response[key] = clip(response[key], 600);
            }
        }
        contents.push({ role: "user", parts: [...responses, ...images] });
      }
      return evidence(false, "incomplete", `Stopped after ${this.maxSteps} steps`, step);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (bounded.aborted)
        return evidence(
          false,
          "incomplete",
          "Computer task deadline reached; the last step's outcome is unknown",
          step,
        );
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure(
        error instanceof Error && /ENOENT|MCP_RESTART_LIMIT/.test(error.message)
          ? "provider-unavailable"
          : "transient",
        false,
      );
    } finally {
      this.busy = false;
      await port?.close().catch(() => {});
    }
  }
}
