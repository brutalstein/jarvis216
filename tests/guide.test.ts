import { describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import {
  curatedGuide,
  GuideExecutor,
  modelAsk,
  pageText,
  readOfficial,
} from "../src/integrations/guide.js";

const n8n = "http://127.0.0.1:5678";
const html = (body: string, title = "Docs") =>
  `<html><head><title>${title}</title><script>steal()</script></head><body>${body}</body></html>`;
// Every name resolves to a public address unless listed as private.
const lookup =
  (privateHosts: string[] = []) =>
  async (host: string) =>
    privateHosts.includes(host) ? ["10.0.0.5"] : ["93.184.216.34"];
function site(pages: Record<string, { status?: number; location?: string; body?: string }>) {
  const seen: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const page = pages[url];
    if (!page)
      return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(page.body ?? "", {
      status: page.status ?? 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        ...(page.location && { location: page.location }),
      },
    });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}
const ctx = (fetch: typeof globalThis.fetch, privateHosts?: string[]) => ({
  fetch,
  lookup: lookup(privateHosts),
  signal: new AbortController().signal,
});

function task(topic: string): Task {
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
      objective: "Show setup steps",
      capability: "tool.execute",
      input: { action: "help.guide", args: { topic } },
      providers: ["guide"],
      risk: "LOW",
      deadline: new Date(Date.now() + 60_000).toISOString(),
      verification: { kind: "postcondition" },
    }),
  };
}
const outcome = (result: { text: string }) => JSON.parse(result.text);
const run = (guide: GuideExecutor, topic: string) =>
  guide.execute(task(topic), new AbortController().signal);
const doc = html(
  `<nav>${"Products Docs ".repeat(200)}</nav><main><h1>Create a client</h1><p>Open the Dashboard and select <b>Create app</b>. ${"Details. ".repeat(40)}</p></main>`,
  "Spotify for Developers",
);
const official = "https://developer.spotify.com/documentation/web-api";

describe("curated guides", () => {
  it("answer known needs by id or by the operator's words, with official sources", () => {
    expect(curatedGuide("n8n-api-key", n8n)?.links[0]?.url).toBe(`${n8n}/settings/api`);
    expect(curatedGuide("n8n API anahtarı lazım", n8n)?.title).toBe("n8n API anahtarı");
    expect(curatedGuide("YouTube hesabımı n8n'e bağla", n8n)?.title).toBe("YouTube'u n8n'e bağla");
    expect(curatedGuide("gemini key", `${n8n}/`)?.sources).toEqual([
      "https://ai.google.dev/gemini-api/docs/api-key",
    ]);
    expect(curatedGuide("Spotify client id", n8n)).toBeUndefined();
    for (const id of [
      "youtube-n8n",
      "n8n-api-key",
      "gemini-api-key",
      "openrouter-api-key",
      "anthropic-api-key",
      "github-cli",
    ]) {
      const guide = curatedGuide(id, n8n);
      expect(guide?.steps.length).toBeGreaterThan(0);
      for (const source of guide?.sources ?? []) expect(source).toMatch(/^https:\/\//);
      for (const link of guide?.links ?? [])
        expect(link.url).toMatch(/^(https:\/\/|http:\/\/127\.0\.0\.1:5678\/)/);
    }
  });
});

describe("modelAsk", () => {
  it("skips a rate-limited model, asks for JSON, and fails only when every model fails", async () => {
    const asked: string[] = [];
    const writer = (id: string, answer?: string) => ({
      id,
      execute: async (task: Task) => {
        asked.push(`${id}:${task.spec.responseFormat}:${task.spec.objective}`);
        if (answer === undefined) throw new ProviderFailure("rate-limited", true);
        return { text: answer, source: id };
      },
    });
    const signal = new AbortController().signal;
    expect(await modelAsk([writer("gemini"), writer("or-a", '{"ok":1}')])("soru", signal)).toBe(
      '{"ok":1}',
    );
    expect(asked).toEqual(["gemini:json:soru", "or-a:json:soru"]);
    await expect(modelAsk([writer("gemini"), writer("or-a", " ")])("soru", signal)).rejects.toThrow(
      "provider-unavailable",
    );
  });
});

describe("pageText", () => {
  it("keeps readable words only, without site menus", () => {
    expect(
      pageText(
        html("<nav>Products Docs Pricing</nav><p>Select <b>Create&nbsp;key</b> &amp; copy it</p>"),
      ),
    ).toBe("Docs Select Create key & copy it");
  });
});

describe("readOfficial", () => {
  it("follows redirects only while they stay public, https and on the official domain", async () => {
    const { fetch } = site({
      "https://developer.spotify.com/a": { status: 301, location: "/documentation/web-api" },
      [official]: { body: doc },
      "https://developer.spotify.com/out": { status: 302, location: "https://evil.example/x" },
    });
    const page = await readOfficial("https://developer.spotify.com/a", "spotify.com", ctx(fetch));
    expect(page?.url).toBe(official);
    // Only the page's main content is kept, without the site menu.
    expect(page?.text.startsWith("Create a client")).toBe(true);
    for (const url of [
      "http://developer.spotify.com/documentation/web-api",
      "https://spotify.com.evil.example/x",
      "https://developer.spotify.com/out",
      "https://127.0.0.1/x",
    ])
      expect(await readOfficial(url, "spotify.com", ctx(fetch))).toBeUndefined();
    expect(
      await readOfficial(official, "spotify.com", ctx(fetch, ["developer.spotify.com"])),
    ).toBeUndefined();
  });
});

describe("GuideExecutor", () => {
  it("answers a known topic from the curated guide without a model or the network", async () => {
    const guide = new GuideExecutor({
      n8nUrl: n8n,
      ask: () => Promise.reject(new Error("no model")),
      fetch: (() => Promise.reject(new Error("no network"))) as typeof fetch,
    });
    const result = await run(guide, "n8n-api-key");
    expect(outcome(result)).toMatchObject({
      ok: true,
      provenance: "curated-official",
      panel: { type: "guide", title: "n8n API anahtarı" },
    });
    expect(result.outcome).toEqual({ status: "completed", verified: true });
  });

  it("researches other topics on pages it read itself and keeps only official links", async () => {
    const { fetch, seen } = site({
      [official]: { body: doc },
      "https://developer.spotify.com/dashboard": { body: doc },
    });
    const prompts: string[] = [];
    const answers = [
      JSON.stringify({
        officialDomain: "www.Spotify.com",
        pages: [official, "https://blog.example/spotify"],
      }),
      JSON.stringify({
        title: "Spotify client ID",
        steps: ["Dashboard'u aç.", "Create app'e bas."],
        links: [
          { label: "Dashboard", url: "https://developer.spotify.com/dashboard" },
          { label: "Kötü", url: "https://evil.example/login" },
        ],
        where: ".env SPOTIFY_CLIENT_ID",
      }),
    ];
    const guide = new GuideExecutor({
      n8nUrl: n8n,
      fetch,
      lookup: lookup(),
      ask: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? "{}";
      },
    });
    const result = outcome(await run(guide, "Spotify client id"));
    expect(result).toMatchObject({ ok: true, provenance: "official-pages" });
    expect(result.panel).toEqual({
      type: "guide",
      title: "Spotify client ID",
      steps: ["Dashboard'u aç.", "Create app'e bas."],
      links: [{ label: "Spotify for Developers", url: "https://developer.spotify.com/dashboard" }],
      sources: [official],
      where: ".env SPOTIFY_CLIENT_ID",
    });
    // The second prompt carries the page text it read, without the page's scripts.
    expect(prompts[1]).toContain("Create app");
    expect(prompts[1]).not.toContain("steal()");
    expect(seen.some((url) => url.includes("example"))).toBe(false);
  });

  it("keeps the writing prompt inside Core's task size even with three long pages", async () => {
    const long = html(`<p>${"Select Create app and copy the Client ID. ".repeat(600)}</p>`);
    const urls = [1, 2, 3].map((n) => `https://developer.spotify.com/doc${n}`);
    const { fetch } = site(Object.fromEntries(urls.map((url) => [url, { body: long }])));
    const prompts: string[] = [];
    const answers = [
      JSON.stringify({ officialDomain: "spotify.com", pages: urls }),
      '{"title":"t","steps":["a"],"links":[]}',
    ];
    const guide = new GuideExecutor({
      n8nUrl: n8n,
      fetch,
      lookup: lookup(),
      ask: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? "{}";
      },
    });
    expect(outcome(await run(guide, "Spotify client id")).ok).toBe(true);
    expect(prompts[1]?.length).toBeLessThan(16_000);
  });

  it("refuses when no official domain, page or explanation is found", async () => {
    const { fetch } = site({ [official]: { body: doc } });
    const answer = async (...answers: string[]) =>
      outcome(
        await run(
          new GuideExecutor({
            n8nUrl: n8n,
            fetch,
            lookup: lookup(),
            ask: async () => answers.shift() ?? "{}",
          }),
          "Spotify client id",
        ),
      );
    expect(await answer('{"officialDomain":"","pages":[]}')).toMatchObject({
      ok: false,
      evidence: "refused",
    });
    expect(
      await answer(
        '{"officialDomain":"spotify.com","pages":["https://developer.spotify.com/nope"]}',
      ),
    ).toMatchObject({ ok: false, observation: "No readable official page on spotify.com" });
    expect(
      await answer(
        `{"officialDomain":"spotify.com","pages":["${official}"]}`,
        '{"title":"","steps":[],"links":[]}',
      ),
    ).toMatchObject({
      ok: false,
      observation: "The official pages on spotify.com do not explain this",
    });
    expect(outcome(await run(new GuideExecutor({ n8nUrl: n8n }), "Spotify"))).toMatchObject({
      ok: false,
    });
  });
});
