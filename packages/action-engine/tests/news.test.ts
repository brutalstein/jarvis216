import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { briefPrompt, fetchNews, type NewsItem, readBrief } from "../src/news.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/rss/${name}`, import.meta.url), "utf8");
const google = "https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr";
const bbc = "https://feeds.bbci.co.uk/turkce/rss.xml";
const thumbnail = "https://ichef.bbci.co.uk/ace/ws/240/example-1.jpg";
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const xml = (body: string) =>
  new Response(body, { headers: { "content-type": "application/xml" } });
const image = (bytes: Uint8Array<ArrayBuffer>, type = "image/png") =>
  new Response(bytes, { headers: { "content-type": type } });

// A fake web: only the listed URLs answer; every request is recorded.
function web(routes: Record<string, () => Response>) {
  const requested: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    const route = routes[url];
    if (!route) throw new TypeError(`fetch failed: ${url}`);
    return route();
  }) as typeof globalThis.fetch;
  return { fetch, requested };
}
const publicHost = async (_host: string) => ["151.101.0.81"];
const ctx = (fetch: typeof globalThis.fetch, feeds: string[], lookup = publicHost) => ({
  fetch,
  feeds,
  lookup,
  signal: new AbortController().signal,
});

describe("fetchNews", () => {
  it("reads headlines verbatim, newest first, deduplicated and sliced", async () => {
    const { fetch } = web({ [google]: () => xml(fixture("google-tr.xml")) });
    expect(await fetchNews({ count: 3 }, ctx(fetch, [google]))).toEqual([
      {
        headline: "İstanbul'da sağanak uyarısı: Akşam saatlerine dikkat",
        source: "Hava Haber",
        publishedAt: "2026-10-18T10:05:00.000Z",
        url: "https://news.google.com/rss/articles/CBMiB2?oc=5",
      },
      {
        headline: "Merkez Bankası faiz kararını açıkladı",
        source: "Örnek Gazete",
        publishedAt: "2026-10-18T09:30:00.000Z",
        url: "https://news.google.com/rss/articles/CBMiA1?oc=5",
      },
      {
        headline: "Ekonomi & piyasalar: Borsa güne yükselişle başladı",
        source: "Piyasa Ekranı",
        publishedAt: "2026-10-18T08:15:00.000Z",
        url: "https://news.google.com/rss/articles/CBMiC3?oc=5",
      },
    ]);
  });

  it("merges feeds and takes thumbnails from the feed's own image URL", async () => {
    const { fetch } = web({
      [google]: () => xml(fixture("google-tr.xml")),
      [bbc]: () => xml(fixture("bbc-turkce.xml")),
      [thumbnail]: () => image(png),
      "https://ichef.bbci.co.uk/ace/ws/240/example-2.jpg": () => image(png),
    });
    const items = await fetchNews({ count: 8 }, ctx(fetch, [google, bbc]));
    expect(items).toHaveLength(7);
    const economy = items.find((item) => item.headline.startsWith("Ekonomide"));
    expect(economy?.source).toBe("BBC News Türkçe");
    expect(economy?.image).toMatch(/^data:image\/png;base64,/);
    expect(items.find((item) => item.headline.startsWith("Uzay"))?.image).toBeUndefined();
  });

  it("skips an HTML error page and an oversized feed", async () => {
    const down = "https://down.example/rss";
    const big = "https://big.example/rss";
    const { fetch } = web({
      [down]: () =>
        new Response(fixture("html-error.html"), { headers: { "content-type": "text/html" } }),
      [big]: () => xml(`<rss><channel>${"x".repeat(3_000_000)}</channel></rss>`),
      [google]: () => xml(fixture("google-tr.xml")),
    });
    expect(await fetchNews({}, ctx(fetch, [down, big, google]))).toHaveLength(4);
  });

  it("returns no items when every feed fails", async () => {
    const { fetch } = web({ [google]: () => new Response("busy", { status: 503 }) });
    expect(await fetchNews({}, ctx(fetch, [google, bbc]))).toEqual([]);
  });

  it("adds a Google News search feed for a topic and filters other feeds by it", async () => {
    const { fetch, requested } = web({ [bbc]: () => xml(fixture("bbc-turkce.xml")) });
    const items = await fetchNews({ topic: "ekonomi" }, ctx(fetch, [bbc]));
    expect(requested).toContain(
      "https://news.google.com/rss/search?q=ekonomi&hl=tr&gl=TR&ceid=TR:tr",
    );
    expect(items.map((item) => item.headline)).toEqual([
      "Ekonomide yeni dönem: Enflasyon verileri açıklandı",
    ]);
  });

  it("uses the world edition for world news", async () => {
    const { fetch, requested } = web({});
    await fetchNews({ region: "world" }, ctx(fetch, []));
    expect(requested).toContain("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en");
  });

  it.each([
    "https://127.0.0.1/a.png",
    "https://10.1.2.3/a.png",
    "https://localhost/a.png",
    "https://[::1]/a.png",
    "http://ichef.bbci.co.uk/a.png",
    "https://intranet.example/a.png",
  ])("never fetches the thumbnail %s", async (unsafe) => {
    const feed = fixture("bbc-turkce.xml").replace(thumbnail, unsafe);
    const { fetch, requested } = web({ [bbc]: () => xml(feed), [unsafe]: () => image(png) });
    const lookup = async (host: string) =>
      host === "intranet.example" ? ["10.0.0.5"] : ["151.101.0.81"];
    const [item] = await fetchNews({ count: 1 }, ctx(fetch, [bbc], lookup));
    expect(item?.image).toBeUndefined();
    expect(requested).not.toContain(unsafe);
  });

  const large = new Uint8Array(300_000);
  large.set(png);
  it.each([
    ["larger than 200 KB", () => image(large)],
    ["HTML", () => new Response("<html></html>", { headers: { "content-type": "text/html" } })],
    ["not JPEG, PNG or WebP", () => image(new TextEncoder().encode("GIF89a-not-allowed"))],
  ])("drops a thumbnail that is %s", async (_label, respond) => {
    const { fetch } = web({ [bbc]: () => xml(fixture("bbc-turkce.xml")), [thumbnail]: respond });
    const [item] = await fetchNews({ count: 1 }, ctx(fetch, [bbc]));
    expect(item?.headline).toMatch(/^Ekonomide/);
    expect(item?.image).toBeUndefined();
  });
});

describe("brief", () => {
  const items: NewsItem[] = [
    {
      headline: "Birinci haber",
      source: "X",
      publishedAt: "2026-10-18T09:00:00.000Z",
      url: "https://a.example/",
    },
    {
      headline: "İkinci haber",
      source: "Y",
      publishedAt: "2026-10-18T08:00:00.000Z",
      url: "https://b.example/",
    },
  ];

  it("lists every headline and allows only them", () => {
    for (const lang of ["tr", "en"] as const)
      for (const item of items) expect(briefPrompt(items, lang)).toContain(item.headline);
    expect(briefPrompt(items, "tr")).toContain("Yalnızca bu başlıklar");
    expect(briefPrompt(items, "en")).toContain("Use only these headlines");
  });

  it("accepts a short brief and rejects empty or long ones", () => {
    expect(readBrief("  Bugün iki gelişme öne çıkıyor.  ")).toBe("Bugün iki gelişme öne çıkıyor.");
    expect(readBrief("   ")).toBeNull();
    expect(readBrief("a".repeat(601))).toBeNull();
  });
});
