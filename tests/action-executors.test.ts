import { describe, expect, it, vi } from "vitest";
import { ResultSchema, type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import { DesktopExecutor, NewsExecutor } from "../src/integrations/actions.js";

const signal = () => new AbortController().signal;
function task(action: string, args: Record<string, unknown> = {}, risk = "LOW"): Task {
  return {
    id: "12bef226-dd16-4ed6-9600-5e2196fe7df5",
    correlation_id: "706e41dc-aa62-454d-a159-18d0eb5255fa",
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
      objective: action,
      capability: action === "news.brief" ? "info.fetch" : "desktop.act",
      input: { action, args },
      providers: [action === "news.brief" ? "news" : "windows-mcp"],
      risk,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "contains", value: '"ok":true' },
    }),
  };
}

describe("DesktopExecutor", () => {
  it.each(["LOW", "MEDIUM"])("refuses a HIGH file deletion downgraded to %s", async (risk) => {
    const call = vi.fn();
    await expect(
      new DesktopExecutor({ call }, []).execute(
        task("file.delete", { path: "isolated.txt" }, risk),
        signal(),
      ),
    ).rejects.toMatchObject({ kind: "policy-denied", dispatched: false });
    expect(call).not.toHaveBeenCalled();
  });
  it("maps typed evidence to the Core result contract", async () => {
    const call = vi.fn(async () => ({ ok: true, text: "Media key sent" }));
    const executor = new DesktopExecutor({ call }, []);
    expect(executor).toMatchObject({
      id: "windows-mcp",
      capability: "desktop.act",
      external: false,
      retrySafe: false,
      outcomeObservable: true,
    });
    const result = await executor.execute(task("media.key", { key: "play_pause" }), signal());
    expect(ResultSchema.parse(result)).toEqual({
      text: JSON.stringify({ ok: true, evidence: "tool-ok", observation: "Media key sent" }),
      source: "windows-mcp:tool-ok",
    });
    expect(call).toHaveBeenCalledWith(
      "Shortcut",
      { shortcut: "media_play_pause" },
      expect.any(AbortSignal),
    );
  });

  it("preserves refused evidence without calling a tool", async () => {
    const call = vi.fn();
    const result = await new DesktopExecutor({ call }, []).execute(
      task("app.open", { name: "powershell" }),
      signal(),
    );
    expect(JSON.parse(result.text)).toMatchObject({ ok: false, evidence: "refused" });
    expect(call).not.toHaveBeenCalled();
  });

  it("classifies a lost MCP channel as dispatched and never retryable", async () => {
    const call = vi.fn(async () => {
      throw new Error("MCP_CHANNEL_LOST");
    });
    await expect(
      new DesktopExecutor({ call }, []).execute(task("media.key", { key: "mute" }), signal()),
    ).rejects.toMatchObject({ kind: "transient", retryable: false, dispatched: true });
  });

  it.each([
    ["app.close", { name: "Notepad" }],
    ["ui.type", { text: "hello" }],
  ])("refuses a manually downgraded %s before dispatch", async (action, args) => {
    const call = vi.fn();
    await expect(
      new DesktopExecutor({ call }, []).execute(task(action, args), signal()),
    ).rejects.toMatchObject({ kind: "policy-denied", dispatched: false });
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses invalid catalog arguments and a wrong capability", async () => {
    const call = vi.fn();
    const executor = new DesktopExecutor({ call }, []);
    await expect(
      executor.execute(task("media.key", { key: "ctrl+s" }), signal()),
    ).rejects.toBeInstanceOf(ProviderFailure);
    await expect(executor.execute(task("news.brief"), signal())).rejects.toMatchObject({
      kind: "policy-denied",
      dispatched: false,
    });
    const wrong = task("media.key", { key: "mute" });
    wrong.spec.capability = "info.fetch";
    await expect(executor.execute(wrong, signal())).rejects.toMatchObject({
      kind: "policy-denied",
      dispatched: false,
    });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("NewsExecutor", () => {
  const rss =
    "<rss><channel><title>Publisher</title><item><title>Verbatim headline</title><pubDate>Sun, 18 Oct 2026 10:00:00 GMT</pubDate><link>https://example.com/story</link></item></channel></rss>";
  it("returns verbatim fetched headlines in a news panel", async () => {
    const fetch = vi.fn(async () => new Response(rss)) as unknown as typeof globalThis.fetch;
    const executor = new NewsExecutor(["https://example.com/rss"], { fetch });
    expect(executor).toMatchObject({
      id: "news",
      capability: "info.fetch",
      external: true,
      retrySafe: true,
    });
    const result = ResultSchema.parse(await executor.execute(task("news.brief"), signal()));
    expect(JSON.parse(result.text)).toMatchObject({
      ok: true,
      evidence: "postcondition",
      panel: {
        type: "news",
        items: [
          { headline: "Verbatim headline", source: "Publisher", url: "https://example.com/story" },
        ],
      },
    });
  });

  it("reports an observed failure if no feed items were available", async () => {
    const fetch = vi.fn(
      async () => new Response("", { status: 503 }),
    ) as unknown as typeof globalThis.fetch;
    const result = await new NewsExecutor(["https://example.com/rss"], { fetch }).execute(
      task("news.brief"),
      signal(),
    );
    expect(JSON.parse(result.text)).toMatchObject({
      ok: false,
      evidence: "observed-failure",
      panel: { type: "news", items: [] },
    });
  });

  it("does not fetch for a desktop action or wrong capability", async () => {
    const fetch = vi.fn();
    const executor = new NewsExecutor([], { fetch });
    await expect(
      executor.execute(task("media.key", { key: "mute" }), signal()),
    ).rejects.toMatchObject({ kind: "policy-denied", dispatched: false });
    const wrong = task("news.brief");
    wrong.spec.capability = "desktop.act";
    await expect(executor.execute(wrong, signal())).rejects.toMatchObject({
      kind: "policy-denied",
      dispatched: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
