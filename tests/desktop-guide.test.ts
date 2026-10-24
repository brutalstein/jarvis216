import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkGuide, probe, saveValue } from "../apps/desktop/src/main/guide.js";

const env = async (text: string) => {
  const file = join(await mkdtemp(join(tmpdir(), "jarvis-guide-")), ".env");
  await writeFile(file, text);
  return file;
};
// A vendor that accepts only "good", and records how it was asked.
function vendor() {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const ok =
      headers.get("authorization") === "Bearer good" || url.searchParams.get("key") === "good";
    return new Response("{}", { status: ok ? 200 : 401 });
  }) as typeof fetch;
  return { fetcher, seen };
}
const bearer = {
  url: "https://api.vendor.example/v1/me",
  in: "header",
  name: "authorization",
  prefix: "Bearer ",
} as const;

it("sets one .env line, keeps the others and the line endings, and never writes Core's secrets", async () => {
  const file = await env("PORT=2160\r\nVENDOR_API_KEY=old\r\nJARVIS_TOKEN=t\r\n");
  await saveValue(file, "VENDOR_API_KEY", "new-1");
  expect(await readFile(file, "utf8")).toBe(
    "PORT=2160\r\nVENDOR_API_KEY=new-1\r\nJARVIS_TOKEN=t\r\n",
  );
  await saveValue(file, "OTHER_ID", "abc");
  expect(await readFile(file, "utf8")).toBe(
    "PORT=2160\r\nVENDOR_API_KEY=new-1\r\nJARVIS_TOKEN=t\r\nOTHER_ID=abc\r\n",
  );
  for (const [name, value] of [
    ["JARVIS_TOKEN", "x"],
    ["DATABASE_URL", "x"],
    ["lower_case", "x"],
    ["VENDOR_API_KEY", "two words"],
    ["VENDOR_API_KEY", 'quo"te'],
    ["VENDOR_API_KEY", "a\nPORT=1"],
  ] as [string, string][])
    await expect(saveValue(file, name, value)).rejects.toThrow("INVALID_VALUE");
});

it("tests a pasted value before saving it, and saves nothing the vendor refuses", async () => {
  const file = await env("PORT=2160\n");
  const { fetcher, seen } = vendor();
  const check = { env: "VENDOR_API_KEY", verify: bearer };
  expect(await checkGuide(file, check, undefined, fetcher)).toEqual({
    state: "missing",
    saved: false,
  });
  expect(await checkGuide(file, check, "bad", fetcher)).toEqual({
    state: "rejected",
    saved: false,
  });
  expect(await readFile(file, "utf8")).toBe("PORT=2160\n");
  expect(await checkGuide(file, check, " good ", fetcher)).toEqual({
    state: "verified",
    saved: true,
  });
  expect(await readFile(file, "utf8")).toBe("PORT=2160\nVENDOR_API_KEY=good\n");
  // A value written into .env by hand is found and tested too.
  expect(await checkGuide(file, check, undefined, fetcher)).toEqual({
    state: "verified",
    saved: false,
  });
  expect(seen.every((call) => call.init?.redirect === "manual")).toBe(true);
  // Without a documented check the value is kept but not claimed to work.
  expect(await checkGuide(file, { env: "OTHER_ID" }, "abc", fetcher)).toEqual({
    state: "present",
    saved: true,
  });
  await expect(checkGuide(file, { env: "JARVIS_TOKEN" }, "x", fetcher)).rejects.toThrow(
    "INVALID_CHECK",
  );
});

it("puts the value only where the check says and refuses plain http beyond this machine", async () => {
  const { fetcher, seen } = vendor();
  expect(
    await probe(
      { url: "https://api.vendor.example/v1/models?key=old", in: "query", name: "key" },
      "good",
      fetcher,
    ),
  ).toBe(true);
  // A made-up value goes first; the vendor must refuse it before a 2xx counts.
  expect(seen.map((call) => new URL(call.url).searchParams.getAll("key"))).toEqual([
    [expect.stringMatching(/^invalid-/)],
    ["good"],
  ]);
  expect(
    await probe({ ...bearer, url: "http://vendor.example/v1/me" }, "good", fetcher),
  ).toBeUndefined();
  expect(await probe({ ...bearer, url: "http://127.0.0.1:5678/api/v1/me" }, "good", fetcher)).toBe(
    true,
  );
  expect(seen).toHaveLength(4);
  const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  expect(await probe(bearer, "good", down)).toBeUndefined();
});

it("never calls a value verified when the address answers anything, like a docs page", async () => {
  const open = (async () =>
    new Response("<html>docs</html>", { status: 200 })) as unknown as typeof fetch;
  expect(await probe(bearer, "anything", open)).toBeUndefined();
  const file = await env("PORT=2160\n");
  expect(await checkGuide(file, { env: "VENDOR_API_KEY", verify: bearer }, "k1", open)).toEqual({
    state: "present",
    saved: true,
  });
});
