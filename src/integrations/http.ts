import { context, propagation } from "@opentelemetry/api";
import { Agent } from "undici";
import { ProviderFailure } from "../routing.js";

// Shared keep-alive pool for loopback OpenClaw / browser / n8n. One dispatcher per process.
export const serviceDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 8,
  pipelining: 1,
});

export function serviceUrl(raw: string): string {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("INVALID_SERVICE_URL");
  // HTTP is limited to local deployment aliases; remote service credentials require TLS.
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]", "openclaw", "browser-worker", "n8n"].includes(url.hostname)
  )
    throw new Error("REMOTE_SERVICE_REQUIRES_TLS");
  return url.href.replace(/\/$/, "");
}

// Failures before a TCP connection exists: the request cannot have reached the service.
const notConnected = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);
export function networkCode(error: unknown): string | undefined {
  for (let item = error, depth = 0; item && typeof item === "object" && depth < 5; depth++) {
    if ("code" in item && typeof item.code === "string") return item.code;
    item = "cause" in item ? item.cause : undefined;
  }
  return undefined;
}
export function neverDispatched(error: unknown): boolean {
  return notConnected.has(networkCode(error) ?? "");
}

export async function jsonRequest(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal,
      redirect: "error",
      // Node's fetch is undici; reuse TCP to local gateways.
      dispatcher: serviceDispatcher,
    } as RequestInit & { dispatcher: Agent });
  } catch (error) {
    if (!signal.aborted && neverDispatched(error))
      throw new ProviderFailure("provider-unavailable", true, false);
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    const kind =
      response.status === 401 || response.status === 403
        ? "authentication-required"
        : response.status === 429
          ? "rate-limited"
          : response.status >= 500
            ? "provider-unavailable"
            : "permanent";
    // Authentication is checked before a request is processed: a 401/403 was not executed.
    throw new ProviderFailure(
      kind,
      response.status === 429 || response.status >= 500,
      kind !== "authentication-required",
    );
  }
  if (!response.body) throw new ProviderFailure("invalid-response", false);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128_000) throw new ProviderFailure("invalid-response", false);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
