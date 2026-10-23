import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import { catalog } from "@jarvis/action-engine";
import { describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { AutomationBuilder, compileWorkflow } from "../src/integrations/n8n-builder.js";

type Shape = {
  name: string;
  nodes: {
    name: string;
    type: string;
    typeVersion?: number;
    parameters: Record<string, unknown>;
    credentials?: Record<string, string>;
  }[];
  connections: { from: string; to: string }[];
};
// The daily Shorts upload: pick the next unseen video in the mounted folder and publish it.
const shorts: Shape = {
  name: "YouTube Shorts",
  nodes: [
    {
      name: "Her gün 18:00",
      type: "scheduleTrigger",
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 18 * * *" }] } },
    },
    {
      name: "Videoları oku",
      type: "readWriteFile",
      parameters: { fileSelector: "/home/node/.n8n-files/shorts/*.mp4" },
    },
    {
      name: "Yüklenmişleri atla",
      type: "removeDuplicates",
      parameters: {
        operation: "removeItemsSeenInPreviousExecutions",
        dedupeValue: "={{ $binary.data.fileName }}",
      },
    },
    { name: "Bir tane", type: "limit", parameters: { maxItems: 1 } },
    {
      name: "YouTube'a yükle",
      type: "youTube",
      parameters: {
        resource: "video",
        operation: "upload",
        title: "={{ $binary.data.fileName.replace(/\\.[^.]+$/, '') }} #Shorts",
        regionCode: "TR",
        categoryId: "22",
        binaryProperty: "data",
        options: { privacyStatus: "public" },
      },
      credentials: { youTubeOAuth2Api: "" },
    },
  ],
  connections: [
    { from: "Her gün 18:00", to: "Videoları oku" },
    { from: "Videoları oku", to: "Yüklenmişleri atla" },
    { from: "Yüklenmişleri atla", to: "Bir tane" },
    { from: "Bir tane", to: "YouTube'a yükle" },
  ],
};
const spec = (value: unknown) => catalog["automation.create"]?.args.parse(value);

describe("automation.create arguments", () => {
  it("accept the Shorts automation and refuse code, shell and unknown nodes", () => {
    expect(spec(shorts)).toBeTruthy();
    for (const type of ["code", "executeCommand", "ssh", "n8n", "httpRequest", "function"])
      expect(() =>
        spec({ ...shorts, nodes: [...shorts.nodes, { name: "x", type, parameters: {} }] }),
      ).toThrow();
  });
});

describe("compileWorkflow", () => {
  it("builds an n8n workflow owned by JARVIS with full node types and wired connections", () => {
    const workflow = compileWorkflow(spec(shorts), "Europe/Istanbul");
    expect(workflow.name).toBe("JARVIS · YouTube Shorts");
    expect(workflow.settings).toEqual({ executionOrder: "v1", timezone: "Europe/Istanbul" });
    expect(workflow.nodes.map((node) => [node.type, node.typeVersion])).toEqual([
      ["n8n-nodes-base.scheduleTrigger", 1.2],
      ["n8n-nodes-base.readWriteFile", 1],
      ["n8n-nodes-base.removeDuplicates", 2],
      ["n8n-nodes-base.limit", 1],
      ["n8n-nodes-base.youTube", 1],
    ]);
    expect(new Set(workflow.nodes.map((node) => node.id)).size).toBe(5);
    expect(workflow.connections["Bir tane"]).toEqual({
      main: [[{ node: "YouTube'a yükle", type: "main", index: 0 }]],
    });
  });

  it("refuses unsafe or broken shapes", () => {
    const broken = (change: (value: Shape) => Shape) => () =>
      compileWorkflow(spec(change(structuredClone(shorts))), "UTC");
    const files = (w: Shape) => w.nodes[1] as Shape["nodes"][number];
    expect(broken((w) => ({ ...w, nodes: w.nodes.slice(1), connections: [] }))).toThrow(
      "AUTOMATION_NEEDS_TRIGGER",
    );
    expect(
      broken((w) => ({ ...w, connections: [...w.connections, { from: "Yok", to: "Bir tane" }] })),
    ).toThrow("AUTOMATION_UNKNOWN_NODE");
    expect(broken((w) => ({ ...w, nodes: [...w.nodes, files(w)] }))).toThrow(
      "AUTOMATION_DUPLICATE_NODE",
    );
    for (const fileSelector of ["/etc/passwd", "/home/node/.n8n-files/../.n8n/config", "={{ 1 }}"])
      expect(
        broken((w) => {
          files(w).parameters = { fileSelector };
          return w;
        }),
      ).toThrow("AUTOMATION_FILE_OUTSIDE");
    expect(
      broken((w) => {
        files(w).parameters.operation = "write";
        return w;
      }),
    ).toThrow("AUTOMATION_FILE_WRITE");
    expect(
      broken((w) => {
        files(w).typeVersion = 9;
        return w;
      }),
    ).toThrow("AUTOMATION_NODE_VERSION");
  });
});

type Seen = { method: string; url: string; body?: unknown };
async function fakeN8n(options: {
  credentials: unknown[];
  existing?: { id: string; name: string };
}) {
  const seen: Seen[] = [];
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  };
  const server = createServer(async (req, res) => {
    const body = await read(req);
    seen.push({ method: req.method ?? "", url: req.url ?? "", ...(body && { body }) });
    if (req.headers["x-n8n-api-key"] !== "n8n-key") {
      res.statusCode = 401;
      return res.end("{}");
    }
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://n8n");
    if (url.pathname === "/api/v1/credentials")
      return res.end(JSON.stringify({ data: options.credentials, nextCursor: null }));
    if (url.pathname === "/api/v1/workflows" && req.method === "GET")
      return res.end(JSON.stringify({ data: options.existing ? [options.existing] : [] }));
    if (url.pathname === "/api/v1/workflows" && req.method === "POST")
      return res.end(JSON.stringify({ id: "wf-new", name: body.name, active: false }));
    const id = url.pathname.split("/")[4];
    if (req.method === "PUT") return res.end(JSON.stringify({ id, name: body.name }));
    if (url.pathname.endsWith("/publish")) return res.end(JSON.stringify({ id, active: true }));
    return res.end(JSON.stringify({ id, name: "JARVIS · YouTube Shorts", active: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return {
    seen,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

function task(args: unknown, risk = "HIGH"): Task {
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
      objective: "Create automation",
      capability: "tool.execute",
      input: { action: "automation.create", args },
      providers: ["n8n-builder"],
      risk,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "postcondition" },
    }),
  };
}
const outcome = (result: { text: string }) => JSON.parse(result.text);
const youtube = { id: "c-yt", name: "YouTube hesabım", type: "youTubeOAuth2Api" };

describe("AutomationBuilder against a local n8n API", () => {
  it("creates, links the YouTube credential, publishes and verifies the workflow", async () => {
    const n8n = await fakeN8n({ credentials: [youtube] });
    try {
      const builder = new AutomationBuilder({ url: n8n.url, apiKey: "n8n-key", timezone: "UTC" });
      const result = await builder.execute(task(spec(shorts)), new AbortController().signal);
      expect(outcome(result)).toMatchObject({ ok: true, data: { id: "wf-new", active: true } });
      expect(result.outcome).toEqual({ status: "completed", verified: true });
      const created = n8n.seen.find(
        (call) => call.method === "POST" && call.url === "/api/v1/workflows",
      );
      const body = created?.body as { nodes: { credentials?: unknown }[] } | undefined;
      const upload = body?.nodes.at(-1);
      expect(upload?.credentials).toEqual({
        youTubeOAuth2Api: { id: "c-yt", name: "YouTube hesabım" },
      });
      expect(n8n.seen.map((call) => `${call.method} ${call.url.split("?")[0]}`)).toEqual([
        "GET /api/v1/credentials",
        "GET /api/v1/workflows",
        "POST /api/v1/workflows",
        "POST /api/v1/workflows/wf-new/publish",
        "GET /api/v1/workflows/wf-new",
      ]);
    } finally {
      await n8n.close();
    }
  });

  it("updates its own workflow of the same name instead of adding a second one", async () => {
    const n8n = await fakeN8n({
      credentials: [youtube],
      existing: { id: "wf-old", name: "JARVIS · YouTube Shorts" },
    });
    try {
      const builder = new AutomationBuilder({ url: n8n.url, apiKey: "n8n-key", timezone: "UTC" });
      const result = await builder.execute(task(spec(shorts)), new AbortController().signal);
      expect(outcome(result)).toMatchObject({ ok: true, data: { id: "wf-old" } });
      expect(
        n8n.seen.some((call) => call.method === "PUT" && call.url === "/api/v1/workflows/wf-old"),
      ).toBe(true);
      expect(
        n8n.seen.some((call) => call.method === "POST" && call.url === "/api/v1/workflows"),
      ).toBe(false);
    } finally {
      await n8n.close();
    }
  });

  it("refuses without writing when a needed n8n credential is missing or risk is not HIGH", async () => {
    const n8n = await fakeN8n({ credentials: [] });
    try {
      const builder = new AutomationBuilder({ url: n8n.url, apiKey: "n8n-key", timezone: "UTC" });
      const missing = await builder.execute(task(spec(shorts)), new AbortController().signal);
      expect(outcome(missing)).toMatchObject({ ok: false, evidence: "refused" });
      expect(outcome(missing).observation).toContain("youTubeOAuth2Api");
      const low = await builder.execute(task(spec(shorts), "MEDIUM"), new AbortController().signal);
      expect(outcome(low)).toMatchObject({ ok: false, evidence: "refused" });
      expect(n8n.seen.filter((call) => call.method !== "GET")).toEqual([]);
    } finally {
      await n8n.close();
    }
  });
});
