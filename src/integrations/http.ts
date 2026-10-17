import { ProviderFailure } from "../routing.js";

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

export async function jsonRequest(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { ...init, signal, redirect: "error" });
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
    throw new ProviderFailure(kind, response.status === 429 || response.status >= 500);
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
