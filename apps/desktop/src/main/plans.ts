import { setTimeout as delay } from "node:timers/promises";
import type { PlanView, UiEvent } from "../shared";

/** Core is the only event source; drop oversized or malformed frames and reconnect. */
export async function streamPlans(
  env: { coreUrl: string; coreToken: string },
  receive: (event: UiEvent) => void,
  signal: AbortSignal,
) {
  let backoff = 500;
  while (!signal.aborted) {
    const connection = new AbortController();
    const stop = () => connection.abort();
    signal.addEventListener("abort", stop, { once: true });
    let idle = setTimeout(stop, 20000);
    try {
      const response = await fetch(`${env.coreUrl}/v1/stream`, {
        headers: { authorization: `Bearer ${env.coreToken}`, accept: "text/event-stream" },
        signal: connection.signal,
      });
      if (!response.ok || !response.body) throw new Error("CORE_STREAM_UNAVAILABLE");
      backoff = 500;
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const bytes of response.body) {
        clearTimeout(idle);
        idle = setTimeout(stop, 20000);
        buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(/\r\n/g, "\n");
        if (buffer.length > 4_000_000) throw new Error("CORE_STREAM_TOO_LARGE");
        let end = buffer.indexOf("\n\n");
        while (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const kind = /^event:\s*(\w+)/m.exec(frame)?.[1];
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) {
            try {
              const value = JSON.parse(data);
              if (
                kind === "plan" &&
                typeof value?.id === "string" &&
                Array.isArray(value.steps) &&
                Array.isArray(value.panels)
              )
                receive({ type: "plan", plan: value as PlanView });
              else if (
                kind === "announce" &&
                typeof value?.text === "string" &&
                ["tr", "en"].includes(value.lang)
              )
                receive({ type: "announce", text: value.text.slice(0, 600), lang: value.lang });
            } catch {
              /* A bad frame cannot stop later plan updates. */
            }
          }
          end = buffer.indexOf("\n\n");
        }
      }
    } catch {
      /* Reconnect while Core restarts; no renderer credentials or raw errors. */
    } finally {
      clearTimeout(idle);
      signal.removeEventListener("abort", stop);
      connection.abort();
    }
    await delay(backoff, undefined, { signal }).catch(() => {});
    backoff = Math.min(backoff * 2, 10000);
  }
}
