import { randomUUID } from "node:crypto";
import path from "node:path";
import { catalog } from "@jarvis/action-engine";
import { z } from "zod";
import type { ExecutionResult, Executor, Task } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";
import { jsonRequest, serviceUrl } from "./http.js";

const definition = catalog["automation.create"];
if (!definition) throw new Error("TOOL_ACTION_NOT_IN_CATALOG");
const schema = definition.args;
export const automationActionSchemas = { "automation.create": schema };
type Spec = {
  name: string;
  nodes: {
    name: string;
    type: string;
    typeVersion?: number;
    parameters: Record<string, unknown>;
    credentials?: Record<string, string>;
  }[];
  connections: { from: string; to: string; output: number }[];
};

// Installed n8n 2.43 node versions: the default JARVIS writes and the newest it accepts.
const versions: Record<string, [number, number]> = {
  scheduleTrigger: [1.2, 1.4],
  manualTrigger: [1, 1],
  readWriteFile: [1, 1.1],
  youTube: [1, 1],
  googleDrive: [3, 3],
  set: [3.4, 3.5],
  if: [2.2, 2.3],
  filter: [2.2, 2.3],
  sort: [1, 1],
  limit: [1, 1],
  removeDuplicates: [2, 2],
  splitInBatches: [3, 3],
  merge: [3, 3.2],
  wait: [1.1, 1.1],
  dateTime: [2, 2],
  noOp: [1, 1],
  rssFeedRead: [1.2, 1.2],
};
const triggers = new Set(["scheduleTrigger", "manualTrigger"]);
// n8n 2.x restricts file nodes to this folder; compose mounts the operator's media there read-only.
const FILES = "/home/node/.n8n-files";
const PREFIX = "JARVIS · ";

export class AutomationError extends Error {}
const refuse = (code: string): never => {
  throw new AutomationError(code);
};

/** Turns JARVIS's compact spec into an n8n workflow body; refuses unsafe or broken shapes. */
export function compileWorkflow(args: unknown, timezone: string) {
  const spec = schema.parse(args) as Spec;
  const names = new Set<string>();
  for (const node of spec.nodes) {
    if (names.has(node.name)) refuse("AUTOMATION_DUPLICATE_NODE");
    names.add(node.name);
    const [, max] = versions[node.type] ?? refuse("AUTOMATION_NODE_TYPE");
    if ((node.typeVersion ?? 1) > max) refuse("AUTOMATION_NODE_VERSION");
    if (node.type === "readWriteFile") {
      const { operation = "read", fileSelector } = node.parameters;
      if (operation !== "read") refuse("AUTOMATION_FILE_WRITE");
      // Expressions could compute a path at run time; only literal paths under FILES pass.
      if (
        typeof fileSelector !== "string" ||
        fileSelector.startsWith("=") ||
        !path.posix.normalize(fileSelector).startsWith(`${FILES}/`)
      )
        refuse("AUTOMATION_FILE_OUTSIDE");
    }
  }
  if (!spec.nodes.some((node) => triggers.has(node.type))) refuse("AUTOMATION_NEEDS_TRIGGER");
  const connections: Record<string, { main: { node: string; type: "main"; index: 0 }[][] }> = {};
  for (const link of spec.connections) {
    if (!names.has(link.from) || !names.has(link.to)) refuse("AUTOMATION_UNKNOWN_NODE");
    const entry = connections[link.from] ?? { main: [] };
    connections[link.from] = entry;
    while (entry.main.length <= link.output) entry.main.push([]);
    entry.main[link.output]?.push({ node: link.to, type: "main", index: 0 });
  }
  return {
    name: `${PREFIX}${spec.name}`,
    nodes: spec.nodes.map((node, index) => ({
      id: randomUUID(),
      name: node.name,
      type: `n8n-nodes-base.${node.type}`,
      typeVersion: node.typeVersion ?? versions[node.type]?.[0] ?? 1,
      position: [index * 240, 0] as [number, number],
      parameters: node.parameters,
    })),
    connections,
    settings: { executionOrder: "v1" as const, timezone },
  };
}

const evidence = (
  ok: boolean,
  kind: "observed" | "refused" | "incomplete",
  observation: string,
  data?: unknown,
): ExecutionResult => ({
  text: JSON.stringify({
    ok,
    evidence: kind,
    observation,
    provenance: "n8n-public-api",
    ...(data !== undefined && { data }),
  }),
  source: `n8n-builder:${kind}`,
  outcome: {
    status: ok ? "completed" : kind === "refused" ? "blocked" : "incomplete",
    verified: ok,
  },
});
const Credentials = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
});
const Workflows = z.object({ data: z.array(z.object({ id: z.string(), name: z.string() })) });
const Workflow = z.object({ id: z.string(), active: z.boolean().optional() });

/** Writes JARVIS-named workflows through n8n's public API; it never runs or deletes them. */
export class AutomationBuilder implements Executor {
  readonly id = "n8n-builder";
  readonly capability = "tool.execute";
  readonly external = false;
  readonly retrySafe = false;
  // A published automation acts unattended; every one needs the operator's exact approval.
  readonly riskFloor = "HIGH" as const;
  private base: string;
  constructor(private options: { url: string; apiKey: string; timezone: string }) {
    this.base = serviceUrl(options.url);
  }

  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const input = z
      .strictObject({ action: z.literal("automation.create"), args: z.unknown() })
      .safeParse(task.spec.input);
    if (task.spec.capability !== this.capability || !input.success || task.spec.risk !== "HIGH")
      return evidence(false, "refused", "Invalid automation action or insufficient risk");
    let workflow: ReturnType<typeof compileWorkflow>;
    try {
      workflow = compileWorkflow(input.data.args, this.options.timezone);
    } catch (error) {
      const code = error instanceof AutomationError ? error.message : "AUTOMATION_INVALID";
      return evidence(false, "refused", code);
    }
    const spec = schema.parse(input.data.args) as Spec;
    const { data: credentials } = Credentials.parse(
      await this.call("GET", "credentials?limit=100", signal),
    );
    for (const [index, node] of spec.nodes.entries()) {
      if (!node.credentials) continue;
      const linked: Record<string, { id: string; name: string }> = {};
      for (const [type, wanted] of Object.entries(node.credentials)) {
        const found = credentials.find((c) => c.type === type && (!wanted || c.name === wanted));
        if (!found)
          return evidence(
            false,
            "refused",
            `n8n has no ${type} credential${wanted ? ` named ${wanted}` : ""}; connect it in n8n first`,
          );
        linked[type] = { id: found.id, name: found.name };
      }
      Object.assign(workflow.nodes[index] ?? {}, { credentials: linked });
    }
    const query = `workflows?name=${encodeURIComponent(workflow.name)}&excludePinnedData=true&limit=10`;
    const existing = Workflows.parse(await this.call("GET", query, signal)).data.find(
      (item) => item.name === workflow.name,
    );
    const saved = Workflow.parse(
      existing
        ? await this.call("PUT", `workflows/${existing.id}`, signal, workflow)
        : await this.call("POST", "workflows", signal, workflow),
    );
    try {
      await this.call("POST", `workflows/${saved.id}/publish`, signal);
    } catch (error) {
      if (!(error instanceof ProviderFailure)) throw error;
      return evidence(false, "incomplete", "Saved in n8n but publishing failed", { id: saved.id });
    }
    const check = Workflow.parse(await this.call("GET", `workflows/${saved.id}`, signal));
    const data = {
      id: saved.id,
      name: workflow.name,
      active: check.active === true,
      updated: Boolean(existing),
      url: `${this.base}/workflow/${saved.id}`,
    };
    return check.active
      ? evidence(true, "observed", `${workflow.name} is published in n8n`, data)
      : evidence(false, "incomplete", "Saved in n8n but not active", data);
  }

  private call(method: string, route: string, signal: AbortSignal, body?: unknown) {
    return jsonRequest(
      `${this.base}/api/v1/${route}`,
      {
        method,
        headers: {
          "X-N8N-API-KEY": this.options.apiKey,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
      signal,
    );
  }
}
