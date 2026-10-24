import { describe, expect, it } from "vitest";
import { type Task, TaskSpecSchema } from "../src/core/contracts.js";
import { ProviderFailure } from "../src/core/routing.js";
import {
  GuideExecutor,
  likelyLinks,
  modelAsk,
  pageLinks,
  pageText,
  readOfficial,
  vendorDomain,
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
// Answers in order and records every prompt.
const script = (...answers: string[]) => {
  const prompts: string[] = [];
  return {
    prompts,
    ask: async (prompt: string) => {
      prompts.push(prompt);
      return answers.shift() ?? "{}";
    },
  };
};
const doc = html(
  `<nav>${"Products Docs ".repeat(200)}<a href="/pricing">Pricing</a></nav><main><h1>Create a client</h1>` +
    `<p>Open the <a href="https://developer.spotify.com/dashboard">Dashboard</a> and select <b>Create app</b>. ` +
    `Calls go to api.spotify.com. ${"Details. ".repeat(40)}</p></main>`,
  "Spotify for Developers",
);
const official = "https://developer.spotify.com/documentation/web-api";

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

describe("page reading", () => {
  it("keeps readable words and the page's own https links, without site menus", () => {
    expect(
      pageText(
        html("<nav>Products Docs Pricing</nav><p>Select <b>Create&nbsp;key</b> &amp; copy it</p>"),
      ),
    ).toBe("Docs Select Create key & copy it");
    expect(
      pageLinks(
        '<nav><a href="/menu">Menu</a></nav><a href="/keys#new">API &amp; keys</a>' +
          '<a href="javascript:alert(1)">x</a><a href="http://plain.example/">plain</a>' +
          '<a href="/keys">again</a><a href="https://u:p@evil.example/">creds</a><a href="/empty"></a>',
        "https://vendor.example/docs",
      ),
    ).toEqual([{ text: "API & keys", url: "https://vendor.example/keys" }]);
  });

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
    expect(page?.links).toEqual([
      { text: "Dashboard", url: "https://developer.spotify.com/dashboard" },
    ]);
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
  it("researches any topic and offers only links and checks its official pages back", async () => {
    const { fetch, seen } = site({ [official]: { body: doc } });
    const { ask, prompts } = script(
      JSON.stringify({
        officialDomain: "www.Spotify.com",
        pages: [official, "https://blog.example/spotify"],
      }),
      JSON.stringify({
        title: "Spotify client ID",
        steps: ["Dashboard'u aç.", "Create app'e bas."],
        links: [
          { label: "Panel", url: "https://developer.spotify.com/dashboard" },
          { label: "Kötü", url: "https://evil.example/login" },
          { label: "Resmi gibi", url: "https://developer.spotify.com/never-linked" },
        ],
        where: ".env SPOTIFY_CLIENT_ID",
        env: "SPOTIFY_CLIENT_ID",
        verify: {
          url: "https://api.spotify.com/v1/me",
          in: "header",
          name: "Authorization",
          prefix: "Bearer ",
        },
      }),
    );
    const guide = new GuideExecutor({
      n8nUrl: n8n,
      fetch,
      lookup: lookup(),
      ask,
      envNames: ["GEMINI_API_KEY", "JARVIS_TOKEN"],
    });
    const result = outcome(await run(guide, "Spotify client id"));
    expect(result).toMatchObject({ ok: true, provenance: "official-pages" });
    expect(result.panel).toEqual({
      type: "guide",
      title: "Spotify client ID",
      steps: ["Dashboard'u aç.", "Create app'e bas."],
      // Labelled as the vendor's page labels it, not as the model did.
      links: [{ label: "Dashboard", url: "https://developer.spotify.com/dashboard" }],
      sources: [official],
      where: ".env SPOTIFY_CLIENT_ID",
      check: {
        env: "SPOTIFY_CLIENT_ID",
        verify: {
          url: "https://api.spotify.com/v1/me",
          in: "header",
          name: "Authorization",
          prefix: "Bearer ",
        },
      },
    });
    // The writing prompt carries the page text and its links, without the page's scripts.
    expect(prompts[1]).toContain("Create app");
    expect(prompts[1]).toContain("- Dashboard: https://developer.spotify.com/dashboard");
    expect(prompts[1]).not.toContain("steal()");
    // .env names (never values) help pick the right line; Core's own secrets are not offered.
    expect(prompts[0]).toContain("GEMINI_API_KEY");
    expect(prompts[0]).not.toContain("JARVIS_TOKEN");
    expect(seen.some((url) => url.includes("example"))).toBe(false);
  });

  it("links this machine's n8n and checks a key there, but never sends a value to a stranger", async () => {
    const docs = "https://docs.n8n.io/api/authentication/";
    const { fetch } = site({
      [docs]: {
        body: html(`<main><p>${"Settings > n8n API > Create an API key. ".repeat(20)}</p></main>`),
      },
    });
    const answer = (verify: object, env = "N8N_API_KEY") =>
      JSON.stringify({
        title: "n8n API anahtarı",
        steps: ["Settings > n8n API > Create an API key."],
        links: [{ label: "n8n API ayarları", url: `${n8n}/settings/api` }],
        env,
        verify,
      });
    const guideFor = (...answers: string[]) =>
      new GuideExecutor({ n8nUrl: `${n8n}/`, fetch, lookup: lookup(), ...script(...answers) });
    const proposal = JSON.stringify({ officialDomain: "n8n.io", pages: [docs] });
    const local = { url: `${n8n}/api/v1/workflows?limit=1`, in: "header", name: "X-N8N-API-KEY" };
    const first = outcome(await run(guideFor(proposal, answer(local)), "n8n API key"));
    expect(first.panel.links).toEqual([{ label: "n8n API ayarları", url: `${n8n}/settings/api` }]);
    expect(first.panel.check).toEqual({ env: "N8N_API_KEY", verify: local });
    // A host the official pages never name loses the check address, not the guide.
    const stranger = { url: "https://collect.example/k", in: "query", name: "key" };
    expect(
      outcome(await run(guideFor(proposal, answer(stranger)), "n8n API key")).panel.check,
    ).toEqual({
      env: "N8N_API_KEY",
    });
    // Core's own secrets are never a guide's target.
    expect(
      outcome(await run(guideFor(proposal, answer(local, "JARVIS_TOKEN")), "n8n API key")).panel
        .check,
    ).toBeUndefined();
  });

  it("finds moved pages from the vendor's front page and follows one more official hop", async () => {
    const front = html(
      `<main><p>${"Welcome to the docs. ".repeat(20)}<a href="/guides/keys">API keys</a></p></main>`,
      "Vendor Docs",
    );
    const keys = "https://docs.vendor.example/guides/keys";
    const { fetch } = site({
      "https://docs.vendor.example/": { body: front },
      [keys]: {
        body: html(
          `<main><p>${"Open Settings and press New key. ".repeat(20)}</p></main>`,
          "API keys",
        ),
      },
    });
    const { ask, prompts } = script(
      JSON.stringify({
        officialDomain: "vendor.example",
        pages: ["https://vendor.example/old-guess"],
      }),
      JSON.stringify({ title: "", steps: [], links: [], more: [keys] }),
      JSON.stringify({
        title: "Vendor key",
        steps: ["Settings > New key."],
        links: [{ label: "x", url: keys }],
      }),
    );
    const result = outcome(
      await run(new GuideExecutor({ n8nUrl: n8n, fetch, lookup: lookup(), ask }), "vendor key"),
    );
    expect(result.panel).toMatchObject({
      steps: ["Settings > New key."],
      links: [{ label: "API keys", url: keys }],
      sources: [keys, "https://docs.vendor.example/"],
    });
    expect(prompts).toHaveLength(3);
    // The last round may not ask for yet more pages.
    expect(prompts[2]).not.toContain('"more"');
  });

  it("treats the vendor as its whole domain, so docs moved to a sibling subdomain still count", async () => {
    expect(
      [
        "platform.openai.com",
        "www.Spotify.com",
        "console.cloud.google.com",
        "docs.bbc.co.uk",
        "n8n.io",
      ].map(vendorDomain),
    ).toEqual(["openai.com", "spotify.com", "google.com", "bbc.co.uk", "n8n.io"]);
    const moved = "https://developers.openai.com/api/docs/quickstart";
    const { fetch } = site({
      "https://platform.openai.com/docs/quickstart": { status: 301, location: moved },
      [moved]: {
        body: html(
          `<main><p>${"Create an API key in the dashboard. ".repeat(20)}</p></main>`,
          "Quickstart",
        ),
      },
    });
    const { ask } = script(
      JSON.stringify({
        officialDomain: "platform.openai.com",
        pages: ["https://platform.openai.com/docs/quickstart"],
      }),
      JSON.stringify({
        title: "OpenAI API anahtarı",
        steps: ["API keys > Create new secret key."],
        links: [],
        env: "OPENAI_API_KEY",
      }),
    );
    const result = outcome(
      await run(new GuideExecutor({ n8nUrl: n8n, fetch, lookup: lookup(), ask }), "OpenAI API key"),
    );
    expect(result.panel).toMatchObject({ sources: [moved], check: { env: "OPENAI_API_KEY" } });
  });

  it("follows the page's most relevant links itself when the model picks no next page", async () => {
    const base = "https://developers.vendor.example";
    const front = html(
      `<main><p>${"New models and events. ".repeat(20)}</p><a href="/blog">Blog</a>` +
        `<a href="/careers">Careers</a><a href="/docs/quickstart">Developer quickstart</a>` +
        `<a href="/docs/api-keys">Manage API keys</a></main>`,
      "Vendor Developers",
    );
    expect(likelyLinks([{ links: pageLinks(front, `${base}/`) }], "Vendor API key")).toEqual([
      `${base}/docs/api-keys`,
      `${base}/docs/quickstart`,
    ]);
    const { fetch } = site({
      [`${base}/`]: { body: front },
      [`${base}/docs/api-keys`]: {
        body: html(`<main><p>${"Press Create new secret key. ".repeat(20)}</p></main>`, "API keys"),
      },
    });
    const { ask, prompts } = script(
      JSON.stringify({
        officialDomain: "vendor.example",
        pages: ["https://vendor.example/blocked"],
      }),
      '{"title":"","steps":[],"links":[]}',
      JSON.stringify({
        title: "Vendor key",
        steps: ["Create new secret key."],
        links: [],
        env: "VENDOR_API_KEY",
      }),
    );
    const result = outcome(
      await run(new GuideExecutor({ n8nUrl: n8n, fetch, lookup: lookup(), ask }), "Vendor API key"),
    );
    expect(result.panel).toMatchObject({
      steps: ["Create new secret key."],
      sources: [`${base}/docs/api-keys`, `${base}/`],
    });
    expect(prompts).toHaveLength(3);
  });

  it("answers a repeated topic from memory for six hours", async () => {
    const { fetch } = site({ [official]: { body: doc } });
    let now = 1_000;
    const asked: string[] = [];
    const guide = new GuideExecutor({
      n8nUrl: n8n,
      fetch,
      lookup: lookup(),
      now: () => now,
      ask: async (prompt) => {
        asked.push(prompt);
        return asked.length % 2
          ? JSON.stringify({ officialDomain: "spotify.com", pages: [official] })
          : '{"title":"t","steps":["a"],"links":[]}';
      },
    });
    expect(outcome(await run(guide, "Spotify client id")).ok).toBe(true);
    expect(outcome(await run(guide, "  spotify   CLIENT id ")).ok).toBe(true);
    expect(asked).toHaveLength(2);
    now += 7 * 3_600_000;
    await run(guide, "Spotify client id");
    expect(asked).toHaveLength(4);
  });

  it("keeps the writing prompt inside Core's task size even with long pages full of links", async () => {
    const links = Array.from(
      { length: 80 },
      (_, n) => `<a href="/p${n}">Page number ${n} with a long name</a>`,
    ).join("");
    const long = html(`<p>${"Select Create app and copy the Client ID. ".repeat(600)}${links}</p>`);
    const urls = [1, 2, 3].map((n) => `https://developer.spotify.com/doc${n}`);
    const { fetch } = site(Object.fromEntries(urls.map((url) => [url, { body: long }])));
    const { ask, prompts } = script(
      JSON.stringify({ officialDomain: "spotify.com", pages: urls }),
      '{"title":"t","steps":["a"],"links":[]}',
    );
    const guide = new GuideExecutor({ n8nUrl: n8n, fetch, lookup: lookup(), ask });
    expect(outcome(await run(guide, "Spotify client id")).ok).toBe(true);
    expect(prompts[1]?.length).toBeLessThan(16_000);
  });

  it("refuses when no official domain, page or explanation is found", async () => {
    const { fetch } = site({ [official]: { body: doc } });
    const answer = async (...answers: string[]) =>
      outcome(
        await run(
          new GuideExecutor({ n8nUrl: n8n, fetch, lookup: lookup(), ...script(...answers) }),
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
      observation: "No research model configured",
    });
  });
});
