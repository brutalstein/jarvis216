import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigSchema } from "../../src/app/config.js";
import { type Core, createCore } from "../../src/app/core.js";
import type { Executor, Task } from "../../src/core/contracts.js";
import { type Database, postgres } from "../../src/core/database.js";
import { memoryDatabase } from "../fixtures/pglite.js";

// Boots the whole Core through its composition root, with fake external services reached over
// real HTTP and a fake Windows-MCP over real stdio. Only the language models are injected.

const secret = () => randomBytes(24).toString("hex");
const fixture = fileURLToPath(new URL("../fixtures/fake-windows-mcp.ts", import.meta.url));
export const pages = {
  "https://www.reuters.com/": "Reuters: markets are calm today",
  "https://bbc.com/": "BBC: election coverage continues",
};

async function body(request: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of request) raw += String(chunk);
  return raw;
}
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

// The model behind every text task: queued turn intents for JSON turns, queued plain texts for
// spoken-result briefs. Prompts are kept for assertions.
export class FakeModel {
  turns: ({ intent?: unknown; say?: string; addressed?: boolean } | (() => never))[] = [];
  briefs: string[] = [];
  prompts: { id: string; prompt: string }[] = [];
  executor(id: string): Executor {
    return {
      id,
      capability: "text.generate",
      external: false,
      retrySafe: true,
      execute: async (task: Task) => {
        this.prompts.push({ id, prompt: task.spec.objective });
        if (task.spec.responseFormat !== "json")
          return { text: this.briefs.shift() ?? "Özet hazır, efendim.", source: `${id}:fake` };
        const next = this.turns.shift() ?? { intent: { kind: "reply" }, say: "Buyurun, efendim." };
        if (typeof next === "function") next();
        const turn = next as { intent?: unknown; say?: string; addressed?: boolean };
        return {
          text: JSON.stringify({
            addressed: turn.addressed ?? true,
            say: turn.say ?? "Tamam, efendim.",
            lang: "tr",
            intent: turn.intent ?? { kind: "reply" },
          }),
          source: `${id}:fake`,
        };
      },
    };
  }
}

export type Services = {
  browser: { calls: unknown[]; gate?: Promise<void> };
  openclaw: { calls: { body: unknown; agent: string | undefined }[] };
  workflow: { calls: { body: unknown; key: string | undefined }[] };
  callbacks: unknown[];
  close(): Promise<void>;
  env: Record<string, string>;
};

export async function services(): Promise<Services> {
  const tokens = { browser: secret(), openclaw: secret(), workflow: secret(), callback: secret() };
  const state: Omit<Services, "close" | "env"> = {
    browser: { calls: [] },
    openclaw: { calls: [] },
    workflow: { calls: [] },
    callbacks: [],
  };
  const browser = await listen(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${tokens.browser}`) return res.writeHead(401).end();
    const input = JSON.parse(await body(req)) as {
      pages?: { url: string; expectedText: string }[];
      url?: string;
      expectedText?: string;
    };
    state.browser.calls.push(input);
    const list = input.pages ?? [{ url: input.url ?? "", expectedText: input.expectedText ?? "" }];
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const texts: string[] = [];
    for (const [i, page] of list.entries()) {
      const host = new URL(page.url).hostname;
      res.write(
        `${JSON.stringify({ progress: { index: i + 1, total: list.length, host, state: "reading" } })}\n`,
      );
      await state.browser.gate;
      const text = pages[page.url as keyof typeof pages] ?? "";
      if (!text.includes(page.expectedText)) {
        res.end(`${JSON.stringify({ error: "REQUEST_OR_VERIFICATION_FAILED", status: 400 })}\n`);
        return;
      }
      texts.push(text);
      res.write(
        `${JSON.stringify({ progress: { index: i + 1, total: list.length, host, state: "read" } })}\n`,
      );
    }
    res.end(
      `${JSON.stringify({ result: { text: texts.join("\n\n---\n\n"), source: "browser-use:dom-readback", externalId: randomUUID() } })}\n`,
    );
  });
  const openclaw = await listen(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${tokens.openclaw}`) return res.writeHead(401).end();
    state.openclaw.calls.push({
      body: JSON.parse(await body(req)),
      agent: req.headers["x-openclaw-agent-id"] as string | undefined,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `resp_${randomUUID()}`,
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Ajan raporu: üç tedarikçi karşılaştırıldı." }],
          },
        ],
      }),
    );
  });
  const n8n = await listen(async (req, res) => {
    const raw = await body(req);
    if (req.url === "/callback") {
      if (req.headers.authorization !== `Bearer ${tokens.callback}`)
        return res.writeHead(401).end();
      state.callbacks.push(JSON.parse(raw));
      return res.writeHead(204).end();
    }
    if (req.headers.authorization !== `Bearer ${tokens.workflow}`) return res.writeHead(401).end();
    state.workflow.calls.push({
      body: JSON.parse(raw),
      key: req.headers["x-jarvis-idempotency-key"] as string | undefined,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "Günlük rapor gönderildi.", source: "n8n:daily-report" }));
  });
  const profile = await mkdtemp(join(tmpdir(), "jarvis-e2e-"));
  for (const folder of ["Desktop", "Documents", "Downloads"])
    await mkdir(join(profile, folder), { recursive: true });
  const env: Record<string, string> = {
    DATABASE_URL: "postgresql://jarvis@127.0.0.1:5432/e2e",
    JARVIS_TOKEN: secret(),
    N8N_INGRESS_TOKEN: secret(),
    WORKER_CONCURRENCY: "2",
    INTERACTIVE_CONCURRENCY: "2",
    JARVIS_PRIVATE_PROVIDERS: "claude-code",
    ENABLE_BROWSER: "true",
    BROWSER_WORKER_URL: browser.url,
    BROWSER_WORKER_TOKEN: tokens.browser,
    BROWSER_ALLOWED_URLS: JSON.stringify(Object.keys(pages)),
    ENABLE_OPENCLAW: "true",
    OPENCLAW_POLICY_VERIFIED: "true",
    OPENCLAW_URL: openclaw.url,
    OPENCLAW_AGENT_ID: "jarvis-e2e",
    OPENCLAW_TOKEN: tokens.openclaw,
    ENABLE_N8N: "true",
    N8N_WORKFLOWS_JSON: JSON.stringify({
      "daily-report": {
        url: `${n8n.url}/webhook/daily`,
        tokenRef: "N8N_DAILY_TOKEN",
        version: "1",
      },
    }),
    N8N_DAILY_TOKEN: tokens.workflow,
    N8N_CALLBACK_URL: `${n8n.url}/callback`,
    N8N_CALLBACK_TOKEN: tokens.callback,
    ENABLE_DESKTOP: "true",
    USERPROFILE: profile,
    WINDOWS_MCP_COMMAND: process.execPath,
    WINDOWS_MCP_ARGS: JSON.stringify(["--import", "tsx", fixture]),
    PATH: process.env.PATH ?? "",
  };
  return {
    ...state,
    env,
    async close() {
      for (const { server } of [browser, openclaw, n8n]) {
        server.closeAllConnections();
        server.close();
      }
    },
  };
}

// PGlite by default; a disposable schema on a local PostgreSQL when E2E_DATABASE_URL is set.
export async function database(): Promise<{ db: Database; drop(): Promise<void> }> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    const db = await memoryDatabase();
    return { db, drop: () => db.close() };
  }
  const schema = `jarvis_e2e_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(url);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(url);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const db = postgres(scoped.toString());
  return {
    db,
    async drop() {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  };
}

export type Running = {
  core: Core;
  url: string;
  token: string;
  webhook: string;
  api<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<{ status: number; body: T }>;
  stop(): Promise<void>;
};

export async function boot(
  db: Database,
  env: Record<string, string>,
  model: FakeModel,
  executors: Executor[] = [model.executor("gemini-live"), model.executor("claude-code")],
): Promise<Running> {
  const config = ConfigSchema.parse(env);
  const core = await createCore(config, {
    db,
    env,
    executors,
  });
  const { port } = await core.start({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${port}`;
  return {
    core,
    url,
    token: env.JARVIS_TOKEN ?? "",
    webhook: env.N8N_INGRESS_TOKEN ?? "",
    async api(method, path, payload, token = env.JARVIS_TOKEN) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: {
          ...(token && { authorization: `Bearer ${token}` }),
          ...(payload !== undefined && { "content-type": "application/json" }),
        },
        ...(payload !== undefined && { body: JSON.stringify(payload) }),
      });
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as never };
    },
    stop: () => core.stop(),
  };
}

// The desktop's view of Core: every plan update and announcement from the live stream.
export class Stream {
  plans = new Map<string, Record<string, unknown>>();
  history: Record<string, unknown>[] = [];
  announcements: { text: string; kind: string; planId?: string }[] = [];
  #abort = new AbortController();
  #done: Promise<void>;
  constructor(running: Running) {
    this.#done = (async () => {
      const response = await fetch(`${running.url}/v1/stream`, {
        headers: { authorization: `Bearer ${running.token}` },
        signal: this.#abort.signal,
      });
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body ?? []) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const kind = /^event: (\w+)/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (!kind || !data) continue;
          const value = JSON.parse(data);
          if (kind === "plan") {
            this.plans.set(value.id, value);
            this.history.push(value);
          } else if (kind === "announce") this.announcements.push(value);
        }
      }
    })().catch(() => {});
  }
  async close(): Promise<void> {
    this.#abort.abort();
    await this.#done;
  }
}

export async function until<T>(
  read: () => T | Promise<T>,
  done: (value: T) => boolean,
  ms = 10_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end)
      throw new Error(`timed out; last value: ${JSON.stringify(value)?.slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
export type { Server };
