import { McpToolPort, type ToolPort, type ToolResult } from "@jarvis/action-engine";
import { z } from "zod";
import { type ExecutionResult, type Executor, type Task, taskDeadline } from "../core/contracts.js";
import { ProviderFailure } from "../core/routing.js";
import { playwrightMcpConfig } from "./claude-mcp.js";
import type { CredentialVault } from "./vault.js";

const label = z.string().trim().min(1).max(200);
export const interactiveBrowserActionSchemas = {
  "browser.navigate": z.strictObject({ url: z.url({ protocol: /^https?$/ }).max(2000) }),
  "browser.snapshot": z.strictObject({}),
  "browser.fill": z.strictObject({ label, value: z.string().min(1).max(4000) }),
  "browser.click": z.strictObject({ name: label }),
  "browser.verify": z.strictObject({ text: z.string().trim().min(1).max(4000) }),
  // The password comes from Core's vault, so the model never chooses or sees it.
  "browser.fill_password": z.strictObject({ label }),
  "browser.save_key": z.strictObject({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,59}$/) }),
};
// API keys and tokens as sites show them: known prefixes, or long mixed letter-digit runs.
const keyShaped =
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|nvapi|hf|glpat)[-_][A-Za-z0-9_-]{16,}|\bAIza[A-Za-z0-9_-]{30,}|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
// "*" opens every public https site; this machine and its local network stay out of reach.
const privateHost =
  /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i;
export const interactiveBrowserTools = [
  "browser_navigate",
  "browser_snapshot",
  "browser_type",
  "browser_click",
  "browser_close",
];
export interface InteractiveBrowserPort extends ToolPort {
  list(): Promise<string[]>;
  close(): Promise<void>;
}
type Session = { port: InteractiveBrowserPort; at: number; busy: boolean };
type Snapshot = { url: string; body: string };
type Element = { role: string; name: string; ref: string; value: string };
const result = (
  ok: boolean,
  kind: "observed" | "refused" | "incomplete" | "failed",
  observation: string,
  data?: unknown,
): ExecutionResult => ({
  text: JSON.stringify({
    ok,
    evidence: kind,
    observation,
    provenance: "standalone:playwright-mcp",
    panel: { type: "text", title: "Browser", body: observation },
    ...(data !== undefined && { data }),
  }),
  source: `playwright-mcp:${kind}`,
  outcome: {
    status: ok
      ? "completed"
      : kind === "refused"
        ? "blocked"
        : kind === "failed"
          ? "failed"
          : "incomplete",
    verified: ok,
  },
});
const elements = (body: string): Element[] =>
  body.split("\n").flatMap((line) => {
    const match =
      /^\s*- ([a-z]+) "((?:[^"\\]|\\.)*)"[^\r\n]*?\[ref=([a-zA-Z0-9]+)\][^:\r\n]*(?::\s?(.*))?$/.exec(
        line,
      );
    if (!match) return [];
    let name: string;
    try {
      name = JSON.parse(`"${match[2]}"`) as string;
    } catch {
      return [];
    }
    return [{ role: match[1] ?? "", name, ref: match[3] ?? "", value: match[4] ?? "" }];
  });

/** Typed MCP actions. Origins are checked here; network isolation remains a deployment gate. */
export class InteractiveBrowserExecutor implements Executor {
  readonly id = "playwright-mcp";
  readonly capability = "tool.execute";
  readonly external = true;
  readonly retrySafe = false;
  readonly outcomeObservable = false;
  private origins: Set<string>;
  private anyOrigin: boolean;
  private vault?: CredentialVault;
  private sessions = new Map<string, Session>();
  private createTools: () => InteractiveBrowserPort;
  constructor(options: {
    origins: readonly string[];
    headless?: boolean;
    egressVerified?: boolean;
    createTools?: () => InteractiveBrowserPort;
    vault?: CredentialVault;
  }) {
    this.vault = options.vault;
    this.anyOrigin = options.origins.includes("*");
    if (this.anyOrigin && options.egressVerified !== true)
      throw new Error("BROWSER_EGRESS_UNVERIFIED");
    this.origins = new Set(
      options.origins
        .filter((origin) => origin !== "*")
        .map((origin) => {
          const url = new URL(origin);
          const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
          if (
            url.origin !== origin ||
            url.username ||
            url.password ||
            (url.protocol !== "https:" &&
              !(
                local &&
                url.protocol === "http:" &&
                process.env.JARVIS_BROWSER_ALLOW_LOCALHOST === "true"
              ))
          )
            throw new Error("INVALID_BROWSER_ORIGIN");
          if (local && process.env.JARVIS_BROWSER_ALLOW_LOCALHOST !== "true")
            throw new Error("LOCAL_BROWSER_DISABLED");
          if (!local && options.egressVerified !== true)
            throw new Error("BROWSER_EGRESS_UNVERIFIED");
          return origin;
        }),
    );
    if (!this.origins.size && !this.anyOrigin) throw new Error("INVALID_BROWSER_ORIGIN");
    this.createTools =
      options.createTools ??
      (() => {
        const config = JSON.parse(playwrightMcpConfig({ headless: options.headless ?? true })) as {
          mcpServers: { playwright: { command: string; args: string[] } };
        };
        const server = config.mcpServers.playwright;
        return new McpToolPort({
          ...server,
          env: {
            ...(!this.anyOrigin && { PLAYWRIGHT_MCP_ALLOWED_ORIGINS: [...this.origins].join(";") }),
            PLAYWRIGHT_MCP_BLOCK_SERVICE_WORKERS: "true",
            PLAYWRIGHT_MCP_TIMEOUT_ACTION: "5000",
            PLAYWRIGHT_MCP_TIMEOUT_NAVIGATION: "15000",
          },
          allow: interactiveBrowserTools,
        });
      });
  }

  async discover(): Promise<string[]> {
    const port = this.createTools();
    try {
      return (await port.list()).filter((tool) => interactiveBrowserTools.includes(tool));
    } finally {
      await port.close();
    }
  }
  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.port.close()));
  }
  private allowed(value: string): boolean {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      return (
        this.origins.has(url.origin) ||
        (this.anyOrigin && url.protocol === "https:" && !privateHost.test(url.hostname))
      );
    } catch {
      return false;
    }
  }
  private async snapshot(session: Session, signal: AbortSignal): Promise<Snapshot | null> {
    const response = await this.call(session, "browser_snapshot", {}, signal);
    if (!response.ok || response.text.length > 48000) return null;
    const urls = [...response.text.matchAll(/^- Page URL: (.+)$/gm)];
    const body = /### Snapshot\s*\n```(?:yaml)?\s*\n([\s\S]*?)\n```/.exec(response.text)?.[1];
    const url = urls[0]?.[1]?.trim();
    if (urls.length !== 1 || !url || body === undefined) return null;
    return { url, body };
  }
  private async call(
    session: Session,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    signal.throwIfAborted();
    const response = await session.port.call(name, args, signal);
    return /^### Error\b|^Error\b/m.test(response.text)
      ? { ok: false, text: "Browser operation failed" }
      : response;
  }
  // Nothing the vault holds, nor anything key-shaped on a page, reaches a model.
  async execute(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    const out = await this.run(task, signal);
    let text = out.text.replace(keyShaped, "[secret]");
    for (const secret of (await this.vault?.secrets()) ?? [])
      text = text.split(secret).join("[secret]");
    return { ...out, text };
  }
  private async run(task: Task, signal: AbortSignal): Promise<ExecutionResult> {
    signal.throwIfAborted();
    const input = z
      .strictObject({ action: z.string(), args: z.record(z.string(), z.unknown()) })
      .safeParse(task.spec.input);
    if (
      task.spec.capability !== this.capability ||
      !input.success ||
      !Object.hasOwn(interactiveBrowserActionSchemas, input.data.action)
    )
      return result(false, "refused", "Invalid browser action");
    const action = input.data.action as keyof typeof interactiveBrowserActionSchemas;
    const parsed = interactiveBrowserActionSchemas[action].safeParse(input.data.args);
    const floor =
      action === "browser.click"
        ? "HIGH"
        : [
              "browser.fill",
              "browser.fill_password",
              "browser.navigate",
              "browser.save_key",
            ].includes(action)
          ? "MEDIUM"
          : "LOW";
    if (
      !parsed.success ||
      (floor === "HIGH" && task.spec.risk !== "HIGH") ||
      (floor === "MEDIUM" && task.spec.risk === "LOW")
    )
      return result(false, "refused", "Invalid arguments or insufficient action risk");
    const args = parsed.data as Record<string, string>;
    if (action === "browser.navigate" && !this.allowed(args.url ?? ""))
      return result(false, "refused", "Navigation origin is not approved");
    const key = `${task.principal}:${task.spec.planId ?? task.id}`;
    for (const [id, stale] of this.sessions)
      if (!stale.busy && Date.now() - stale.at > 300000) {
        this.sessions.delete(id);
        await stale.port.close();
      }
    let session = this.sessions.get(key);
    if (!session) {
      if (action !== "browser.navigate")
        return result(false, "refused", "This plan has no active browser session");
      if (this.sessions.size >= 4)
        return result(false, "incomplete", "Browser session capacity reached");
      session = { port: this.createTools(), at: Date.now(), busy: false };
      this.sessions.set(key, session);
    }
    if (session.busy) return result(false, "incomplete", "This browser session is busy");
    session.busy = true;
    const timeout = Math.min(30000, taskDeadline(task) - Date.now());
    if (timeout <= 0) {
      session.busy = false;
      return result(false, "incomplete", "Browser task deadline expired");
    }
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const abandon = async () => {
      this.sessions.delete(key);
      await session.port.close();
    };
    const onAbort = () => {
      void abandon().catch(() => {});
    };
    bounded.addEventListener("abort", onAbort, { once: true });
    try {
      if (action === "browser.navigate") {
        const response = await this.call(session, "browser_navigate", { url: args.url }, bounded);
        if (!response.ok) return result(false, "failed", "Browser navigation failed");
        const after = await this.snapshot(session, bounded);
        if (!after || !this.allowed(after.url)) {
          await abandon();
          return result(
            false,
            "refused",
            "Browser left the approved origins or its location could not be verified",
          );
        }
        if (new URL(after.url).href !== new URL(args.url ?? "").href)
          return result(false, "incomplete", "Requested URL was not independently observed");
        return result(true, "observed", "Navigation URL independently observed", after);
      }
      const before = await this.snapshot(session, bounded);
      if (!before || !this.allowed(before.url)) {
        await abandon();
        return result(false, "refused", "Current browser location could not be verified");
      }
      if (action === "browser.snapshot")
        return result(true, "observed", "Current page accessibility snapshot observed", before);
      if (action === "browser.verify")
        return before.body.includes(args.text ?? "")
          ? result(true, "observed", "Expected text independently observed", {
              url: before.url,
              text: args.text,
            })
          : result(false, "failed", "Expected text was not present");
      if (action === "browser.save_key") {
        if (!this.vault) return result(false, "refused", "No credential vault is configured");
        const keys = [...new Set(before.body.match(keyShaped) ?? [])];
        if (keys.length !== 1 || !keys[0])
          return result(
            false,
            "incomplete",
            keys.length
              ? "More than one key is visible on the page"
              : "No key is visible on the page",
          );
        await this.vault.save(args.name ?? "", keys[0]);
        return result(true, "observed", `Key saved to the vault as ${args.name}`, {
          url: before.url,
        });
      }
      const typing = action === "browser.fill" || action === "browser.fill_password";
      if (action === "browser.fill_password" && !this.vault)
        return result(false, "refused", "No credential vault is configured");
      const candidates = elements(before.body).filter((element) =>
        typing
          ? ["textbox", "searchbox", "spinbutton"].includes(element.role) &&
            element.name === args.label
          : ["button", "link", "checkbox", "radio", "menuitem", "tab"].includes(element.role) &&
            element.name === args.name,
      );
      if (candidates.length !== 1)
        return result(
          false,
          "refused",
          candidates.length ? "Element name is ambiguous" : "Named element is not present",
        );
      const element = candidates[0];
      if (!element) return result(false, "refused", "Named element is not present");
      const text =
        action === "browser.fill_password"
          ? await (this.vault as CredentialVault).password(new URL(before.url).origin)
          : args.value;
      const response = await this.call(
        session,
        typing ? "browser_type" : "browser_click",
        typing
          ? { element: element.name, target: element.ref, text, submit: false }
          : { element: element.name, target: element.ref },
        bounded,
      );
      if (!response.ok) return result(false, "failed", "Browser interaction failed");
      const after = await this.snapshot(session, bounded);
      if (!after || !this.allowed(after.url)) {
        await abandon();
        return result(
          false,
          "refused",
          "Browser left the approved origins or its location could not be verified",
        );
      }
      if (action === "browser.fill_password")
        return result(true, "observed", "Vault password typed; masked fields are not read back", {
          url: after.url,
          label: element.name,
        });
      if (action === "browser.fill") {
        const values = elements(after.body).filter(
          (value) => value.role === element.role && value.name === element.name,
        );
        return values.length === 1 && values[0]?.value === args.value
          ? result(true, "observed", "Field value independently observed", {
              url: after.url,
              label: element.name,
            })
          : result(false, "incomplete", "Filled value could not be independently observed");
      }
      // A changed accessibility tree proves an observed effect, not arbitrary business completion.
      const changed =
        before.url !== after.url ||
        before.body.replace(/\[ref=[^\]]+\]/g, "") !== after.body.replace(/\[ref=[^\]]+\]/g, "");
      return changed
        ? result(true, "observed", "Click produced an independently observed page change", after)
        : result(false, "incomplete", "Click had no independently observed page change");
    } catch (error) {
      await abandon();
      if (signal.aborted) throw signal.reason;
      if (bounded.aborted)
        return result(
          false,
          "incomplete",
          "Browser deadline reached; interaction outcome is unknown",
        );
      throw new ProviderFailure(
        error instanceof Error && /ENOENT|MCP_RESTART_LIMIT/.test(error.message)
          ? "provider-unavailable"
          : "transient",
        false,
      );
    } finally {
      bounded.removeEventListener("abort", onAbort);
      session.busy = false;
      session.at = Date.now();
    }
  }
}
