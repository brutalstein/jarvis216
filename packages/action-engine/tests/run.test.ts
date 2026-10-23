import { existsSync, readFileSync, renameSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compile } from "../src/catalog.js";
import { runStep } from "../src/run.js";
import type { CompiledStep, ToolPort } from "../src/types.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/windows-mcp/${name}`, import.meta.url), "utf8");
// Windows-MCP 0.8.8 sends the Snapshot text as a JSON array of strings.
const wire = (text: string) => JSON.stringify([text]);
const notepadText = fixture("snapshot-notepad.txt");
const notepad = wire(notepadText);
const dialog = wire(fixture("snapshot-dialog.txt"));
const retitled = (title: string) => wire(notepadText.replaceAll("Adsız, Not Defteri", title));
const closed = retitled("Spotify Premium");
// Notepad still open, but Spotify is in front.
const behind = wire(
  notepadText
    .replace("Adsız, Not Defteri           4", "Spotify Premium              4")
    .replace(
      "Spotify Premium                                 0",
      "Adsız, Not Defteri                              0",
    ),
);

type Schema = { properties: Record<string, unknown>; required?: string[] };
const schemas = new Map(
  (JSON.parse(fixture("tools.json")) as { name: string; inputSchema: Schema }[]).map((tool) => [
    tool.name,
    tool.inputSchema,
  ]),
);

type Call = { name: string; args: Record<string, unknown> };
// Replays Windows-MCP; every call must match the captured tool schema exactly.
function fake(reply: (call: Call) => string) {
  const calls: Call[] = [];
  const port: ToolPort = {
    async call(name, args) {
      const schema = schemas.get(name);
      if (!schema) throw new Error(`unknown tool ${name}`);
      for (const key of Object.keys(args))
        if (!(key in schema.properties)) throw new Error(`${name}: unknown argument ${key}`);
      for (const key of schema.required ?? [])
        if (!(key in args)) throw new Error(`${name}: missing ${key}`);
      calls.push({ name, args });
      return { ok: true, text: reply({ name, args }) };
    },
  };
  return { port, calls, names: () => calls.map((call) => call.name) };
}

function step(action: string, args: Record<string, unknown> = {}): CompiledStep {
  const result = compile([{ action, args }]);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.steps[0] as CompiledStep;
}

let base: string;
let root: string;
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "jarvis-run-"));
  root = join(base, "Desktop");
  await mkdir(join(root, "Raporlar"), { recursive: true });
  await mkdir(join(base, "outside"));
});
afterAll(() => rm(base, { recursive: true, force: true }));
const ctx = (tools: ToolPort, timeoutMs = 50) => ({
  tools,
  roots: [root],
  signal: new AbortController().signal,
  timeoutMs,
});

describe("app.open", () => {
  it("tries the localized Start-menu name and sees the window", async () => {
    const { port, calls } = fake(({ name, args }) => {
      if (name !== "App") return notepad;
      return args.name === "Not Defteri"
        ? "Not Defteri launched."
        : `${args.name} not found in start menu.`;
    });
    const result = await runStep(step("app.open", { name: "notepad" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(calls.filter((call) => call.name === "App").map((call) => call.args)).toEqual([
      { mode: "launch", name: "Notepad" },
      { mode: "launch", name: "Not Defteri" },
    ]);
  });

  it("reports an observed failure when the window never appears", async () => {
    const { port } = fake(({ name }) => (name === "App" ? "Hesap Makinesi launched." : notepad));
    const result = await runStep(step("app.open", { name: "hesap makinesi" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
  });

  it("reports apps missing from the Start menu", async () => {
    const { port, names } = fake(({ args }) => `${args.name} not found in start menu.`);
    const result = await runStep(step("app.open", { name: "Obsidian" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
    expect(names()).toEqual(["App"]);
  });

  it.each(["PowerShell", "poweshell", "Terminal", "Komut İstemi", "Kayıt Defteri Düzenleyicisi"])(
    "refuses to open %s",
    async (name) => {
      const { port, calls } = fake(() => notepad);
      expect(await runStep(step("app.open", { name }), ctx(port))).toMatchObject({
        ok: false,
        evidence: "refused",
      });
      expect(calls).toHaveLength(0);
    },
  );
});

describe("app.focus and app.close", () => {
  it("switches to the open window by its title and sees it in front", async () => {
    let switched = false;
    const { port, calls } = fake(({ name }) => {
      if (name === "App") {
        switched = true;
        return "Switched to Adsız, Not Defteri window.";
      }
      return switched ? notepad : behind;
    });
    const result = await runStep(step("app.focus", { name: "not defteri" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(calls.find((call) => call.name === "App")?.args).toEqual({
      mode: "switch",
      name: "Adsız, Not Defteri",
    });
  });

  it("closes the app when its window is gone", async () => {
    let pressed = false;
    const { port, calls } = fake(({ name }) => {
      if (name === "App") return "Switched to Adsız, Not Defteri window.";
      if (name === "Shortcut") {
        pressed = true;
        return "Pressed alt+f4.";
      }
      return pressed ? closed : notepad;
    });
    const result = await runStep(step("app.close", { name: "Not Defteri'ni" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(calls.find((call) => call.name === "Shortcut")?.args).toEqual({ shortcut: "alt+f4" });
  });

  it("stops and reports an unsaved-changes dialog", async () => {
    let pressed = false;
    const { port } = fake(({ name }) => {
      if (name === "App") return "Switched to Adsız, Not Defteri window.";
      if (name === "Shortcut") {
        pressed = true;
        return "Pressed alt+f4.";
      }
      return pressed ? dialog : notepad;
    });
    const result = await runStep(step("app.close", { name: "not defteri" }), ctx(port, 2000));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
    expect(result.observation).toContain("Kaydet");
  });

  it("never presses alt+f4 when the app did not come to the front", async () => {
    const { port, names } = fake(({ name }) =>
      name === "App" ? "Switched to Adsız, Not Defteri window." : behind,
    );
    const result = await runStep(step("app.close", { name: "not defteri" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
    expect(names()).not.toContain("Shortcut");
  });

  it("reports an app that is not open", async () => {
    const { port, names } = fake(() => closed);
    const result = await runStep(step("app.close", { name: "not defteri" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
    expect(names()).toEqual(["Snapshot"]);
  });
});

describe("ui.type", () => {
  it("types into the focused field and sees the text", async () => {
    const { port, calls } = fake(({ name }) => (name === "Type" ? "Typed." : notepad));
    const result = await runStep(step("ui.type", { text: "yarın" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(calls.find((call) => call.name === "Type")?.args).toEqual({
      text: "yarın",
      loc: [1278, 714],
      press_enter: false,
    });
  });

  it("reports when the field does not show the text", async () => {
    const { port } = fake(({ name }) => (name === "Type" ? "Typed." : notepad));
    const result = await runStep(step("ui.type", { text: "başka bir şey" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
  });

  it("refuses to type into a PowerShell window", async () => {
    const { port, names } = fake(() => retitled("Windows PowerShell"));
    const result = await runStep(step("ui.type", { text: "del *" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "refused" });
    expect(names()).not.toContain("Type");
  });

  it("refuses password fields", async () => {
    const { port, names } = fake(() => wire(notepadText.replace("Metin düzenleyici", "Parola")));
    const result = await runStep(step("ui.type", { text: "1234" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "refused" });
    expect(names()).not.toContain("Type");
  });
});

describe("ui.click and key.shortcut", () => {
  it("returns the candidates when a name is ambiguous", async () => {
    const { port, names } = fake(() => notepad);
    const result = await runStep(step("ui.click", { target: "adsız" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
    expect(result.candidates).toEqual(["Adsız. Değiştirildi.", "Adsız. Değiştirilmedi."]);
    expect(names()).not.toContain("Click");
  });

  it("resolves an ambiguous name with the operator's learned pick and says so", async () => {
    const { port, calls } = fake(({ name }) =>
      name === "Click" ? "Single left clicked." : notepad,
    );
    const seen: { target: string; candidates: string[] }[] = [];
    const result = await runStep(step("ui.click", { target: "adsız" }), {
      ...ctx(port),
      prefer: (target, candidates) => {
        seen.push({ target, candidates });
        return "Adsız. Değiştirilmedi.";
      },
    });
    expect(seen).toEqual([
      { target: "adsız", candidates: ["Adsız. Değiştirildi.", "Adsız. Değiştirilmedi."] },
    ]);
    expect(result).toMatchObject({
      ok: true,
      observation: expect.stringContaining("learned choice"),
      choice: { target: "adsız", picked: "Adsız. Değiştirilmedi." },
    });
    expect(calls.filter((call) => call.name === "Click")).toHaveLength(1);
    // A pick that is no longer among the matches is ignored: the operator chooses again.
    const stale = await runStep(step("ui.click", { target: "adsız" }), {
      ...ctx(fake(() => notepad).port),
      prefer: () => "Başka",
    });
    expect(stale.candidates).toHaveLength(2);
  });

  it("clicks the one matching element", async () => {
    const { port, calls } = fake(({ name }) =>
      name === "Click" ? "Single left clicked." : notepad,
    );
    const result = await runStep(step("ui.click", { target: "kapat" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "tool-ok" });
    expect(calls.find((call) => call.name === "Click")?.args).toEqual({
      loc: [2194, 151],
      button: "left",
      clicks: 1,
    });
  });

  it("refuses a click that would start a terminal", async () => {
    const { port, names } = fake(() => notepad);
    const result = await runStep(step("ui.click", { target: "terminal" }), ctx(port));
    expect(result).toMatchObject({ ok: false, evidence: "refused" });
    expect(names()).not.toContain("Click");
  });

  it("refuses blocked shortcuts and shortcuts into a shell", async () => {
    const blocked = fake(() => notepad);
    expect(await runStep(step("key.shortcut", { keys: "win+r" }), ctx(blocked.port))).toMatchObject(
      { evidence: "refused" },
    );
    const shell = fake(() => retitled("Windows PowerShell"));
    expect(await runStep(step("key.shortcut", { keys: "ctrl+v" }), ctx(shell.port))).toMatchObject({
      evidence: "refused",
    });
    expect([...blocked.names(), ...shell.names()]).not.toContain("Shortcut");
  });

  it("presses an allowed shortcut", async () => {
    const { port, calls } = fake(({ name }) => (name === "Shortcut" ? "Pressed ctrl+s." : notepad));
    const result = await runStep(step("key.shortcut", { keys: "ctrl+s" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "tool-ok" });
    expect(calls.find((call) => call.name === "Shortcut")?.args).toEqual({ shortcut: "ctrl+s" });
  });
});

describe("media, windows, screen and clipboard", () => {
  it("sends media keys through Shortcut", async () => {
    const { port, calls } = fake(() => "Pressed media_play_pause.");
    const result = await runStep(step("media.key", { key: "play_pause" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "tool-ok" });
    expect(calls).toEqual([{ name: "Shortcut", args: { shortcut: "media_play_pause" } }]);
  });

  it("lists windows as a panel and keeps titles out of the observation", async () => {
    const result = await runStep(step("window.list"), ctx(fake(() => notepad).port));
    expect(result.panel).toEqual({
      type: "windows",
      items: ["Adsız, Not Defteri", "Spotify Premium", "Raporlar - Dosya Gezgini"],
    });
    expect(result.observation).not.toContain("Spotify");
  });

  it("describes the screen with secrets redacted", async () => {
    const key = `sk-ant-api03-${"q".repeat(40)}`;
    const text = wire(notepadText.replace("Toplantı", key));
    const result = await runStep(step("screen.describe"), ctx(fake(() => text).port));
    expect(result.ok).toBe(true);
    expect(result.observation).toContain("Metin düzenleyici");
    expect(result.observation).not.toContain(key);
  });

  it("writes the clipboard and reads it back", async () => {
    let clipboard = "";
    const { port } = fake(({ args }) => {
      if (args.mode === "set") clipboard = String(args.text);
      return args.mode === "set" ? "Clipboard set to: x" : `Clipboard content:\n${clipboard}`;
    });
    const result = await runStep(step("clipboard.write", { text: "merhaba" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
  });
  it("shows clipboard and directory contents in text panels", async () => {
    const { port } = fake(({ name }) =>
      name === "Clipboard" ? "Clipboard content:\nprivate note" : "report.txt",
    );
    expect((await runStep(step("clipboard.read"), ctx(port))).panel).toEqual({
      type: "text",
      title: "Clipboard",
      body: "private note",
    });
    expect((await runStep(step("file.list", { folder: root }), ctx(port))).panel).toEqual({
      type: "text",
      title: "Files",
      body: "report.txt",
    });
  });
});

describe("files and web", () => {
  it("refuses moves outside the roots without calling FileSystem", async () => {
    const { port, calls } = fake(() => "Moved");
    const result = await runStep(
      step("file.move", {
        source: join(root, "rapor.txt"),
        destination: join(base, "outside", "rapor.txt"),
      }),
      ctx(port),
    );
    expect(result).toMatchObject({ ok: false, evidence: "refused" });
    expect(calls).toHaveLength(0);
  });

  it("moves into a folder and observes the destination and the gone source", async () => {
    await writeFile(join(root, "rapor.txt"), "x");
    const { port, calls } = fake(({ args }) => {
      renameSync(String(args.path), String(args.destination));
      return `Moved: ${args.path} -> ${args.destination}`;
    });
    const result = await runStep(
      step("file.move", { source: "rapor.txt", destination: "Raporlar" }),
      ctx(port),
    );
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(calls[0]?.args).toEqual({
      mode: "move",
      path: join(root, "rapor.txt"),
      destination: join(root, "Raporlar", "rapor.txt"),
    });
  });

  it("reports FileSystem errors that arrive as plain text", async () => {
    await writeFile(join(root, "a.txt"), "x");
    const { port } = fake(() => "Error: Destination already exists: b.txt.");
    const result = await runStep(
      step("file.copy", { source: "a.txt", destination: "b.txt" }),
      ctx(port),
    );
    expect(result).toMatchObject({ ok: false, evidence: "observed-failure" });
  });

  it("creates a folder inside the roots", async () => {
    const result = await runStep(
      step("file.mkdir", { path: "Yeni Klasör" }),
      ctx(fake(() => "").port),
    );
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(existsSync(join(root, "Yeni Klasör"))).toBe(true);
  });

  it("opens http(s) pages through explorer.exe argv and sees a browser in front", async () => {
    const { port, calls } = fake(({ name }) =>
      name === "App" ? '{"pid": 42}' : retitled("Yeni sekme - Brave"),
    );
    const result = await runStep(step("web.open", { url: "https://example.com/" }), ctx(port));
    expect(result).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(calls[0]).toEqual({
      name: "App",
      args: {
        mode: "launch_executable",
        executable: expect.stringMatching(/explorer\.exe$/i),
        args: ["https://example.com/"],
      },
    });
  });
});

describe("contained file CRUD", () => {
  const execute = (action: string, args: Record<string, unknown>) =>
    runStep(
      step(action, args),
      ctx(
        fake(() => {
          throw new Error("file CRUD must not call MCP");
        }).port,
      ),
    );

  it("creates exclusively and independently reads the actual UTF8 contents", async () => {
    const content = "Merhaba dünya\n  preserved whitespace  ";
    expect(await execute("file.create", { path: "created.txt", content })).toMatchObject({
      ok: true,
      evidence: "postcondition",
    });
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe(content);
    expect(await execute("file.read", { path: "created.txt" })).toMatchObject({
      ok: true,
      evidence: "postcondition",
      panel: { type: "text", title: "created.txt", body: content },
    });
    expect(
      await execute("file.create", { path: "created.txt", content: "overwritten" }),
    ).toMatchObject({ ok: false });
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe(content);
  });

  it("publishes exactly one complete file for concurrent exclusive creates", async () => {
    const [first, second] = await Promise.all([
      execute("file.create", { path: "concurrent.txt", content: "first" }),
      execute("file.create", { path: "concurrent.txt", content: "second" }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await readFile(join(root, "concurrent.txt"), "utf8")).toBe(
      first.ok ? "first" : "second",
    );
  });

  it("does not publish partial content when the disk write fails", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      handle.writeFile = async () => {
        await handle.write("partial");
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      };
      return handle;
    });
    await expect(
      execute("file.create", { path: "partial.txt", content: "complete content" }),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(existsSync(join(root, "partial.txt"))).toBe(false);
    expect((await readdir(root)).filter((name) => name.startsWith(".jarvis-"))).toEqual([]);
  });

  it("keeps the previous file intact when a replacement write fails", async () => {
    await writeFile(join(root, "preserved.txt"), "previous content");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      handle.writeFile = async () => {
        await handle.write("partial");
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      };
      return handle;
    });
    await expect(
      execute("file.write", { path: "preserved.txt", content: "replacement" }),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await readFile(join(root, "preserved.txt"), "utf8")).toBe("previous content");
    expect((await readdir(root)).filter((name) => name.startsWith(".jarvis-"))).toEqual([]);
  });

  it("propagates an unreadable postcondition after publication as uncertain", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const denied = Object.assign(new Error("readback denied"), { code: "EACCES" });
    vi.mocked(open)
      .mockImplementationOnce(actual.open)
      .mockImplementationOnce(actual.open)
      .mockRejectedValueOnce(denied);
    await expect(
      execute("file.create", { path: "uncertain.txt", content: "published" }),
    ).rejects.toBe(denied);
    expect(await readFile(join(root, "uncertain.txt"), "utf8")).toBe("published");
  });

  it("uses an existing allowed root when another configured root is absent", async () => {
    const context = { ...ctx(fake(() => "").port), roots: [root, join(base, "missing-root")] };
    expect(
      await runStep(step("file.create", { path: "available-root.txt", content: "ok" }), context),
    ).toMatchObject({ ok: true, evidence: "postcondition" });
    expect(await readFile(join(root, "available-root.txt"), "utf8")).toBe("ok");
  });

  it("reads all permitted bytes without trimming or truncation", async () => {
    const content = "é".repeat(8000);
    await writeFile(join(root, "boundary.txt"), content);
    expect((await execute("file.read", { path: "boundary.txt" })).panel).toMatchObject({
      body: content,
    });
  });

  it("does not publish a file when the operation is already cancelled", async () => {
    const signal = AbortSignal.abort();
    await expect(
      runStep(step("file.create", { path: "cancelled.txt", content: "no" }), {
        ...ctx(fake(() => "").port),
        signal,
      }),
    ).rejects.toThrow();
    expect(existsSync(join(root, "cancelled.txt"))).toBe(false);
  });

  it("writes only an existing regular file and verifies replacement content", async () => {
    await writeFile(join(root, "written.txt"), "old and longer content");
    expect(await execute("file.write", { path: "written.txt", content: "yeni ✓" })).toMatchObject({
      ok: true,
      evidence: "postcondition",
    });
    expect(await readFile(join(root, "written.txt"), "utf8")).toBe("yeni ✓");
    expect(await execute("file.write", { path: "missing.txt", content: "no" })).toMatchObject({
      ok: false,
    });
    expect(existsSync(join(root, "missing.txt"))).toBe(false);
    expect(await execute("file.write", { path: "Raporlar", content: "no" })).toMatchObject({
      ok: false,
      evidence: "refused",
    });
  });

  it("supports empty files and deletes a regular file with absence evidence", async () => {
    expect((await execute("file.create", { path: "empty.txt", content: "" })).ok).toBe(true);
    expect((await execute("file.read", { path: "empty.txt" })).panel).toMatchObject({ body: "" });
    expect(await execute("file.delete", { path: "empty.txt" })).toMatchObject({
      ok: true,
      evidence: "postcondition",
    });
    await expect(lstat(join(root, "empty.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await execute("file.delete", { path: "Raporlar" })).toMatchObject({
      ok: false,
      evidence: "refused",
    });
    expect((await lstat(join(root, "Raporlar"))).isDirectory()).toBe(true);
  });

  it("does not modify a hard-linked outside file when replacing an allowed file", async () => {
    const outside = join(base, "outside", "hardlinked.txt");
    await writeFile(outside, "outside");
    await link(outside, join(root, "hardlinked.txt"));
    expect((await execute("file.write", { path: "hardlinked.txt", content: "inside" })).ok).toBe(
      true,
    );
    expect(await readFile(outside, "utf8")).toBe("outside");
    expect(await readFile(join(root, "hardlinked.txt"), "utf8")).toBe("inside");
  });

  it("refuses bounded reads of oversized and invalid UTF8 files", async () => {
    await writeFile(join(root, "large.txt"), "é".repeat(8001));
    await writeFile(join(root, "binary.txt"), Buffer.from([0xff, 0xfe]));
    expect(await execute("file.read", { path: "large.txt" })).toMatchObject({
      ok: false,
      evidence: "refused",
    });
    expect(await execute("file.read", { path: "binary.txt" })).toMatchObject({
      ok: false,
      evidence: "refused",
    });
    expect(await execute("file.read", { path: "Raporlar" })).toMatchObject({
      ok: false,
      evidence: "refused",
    });
  });

  it.each(["file.create", "file.read", "file.write", "file.delete"])(
    "refuses root escapes and junctions for %s",
    async (action) => {
      const outside = join(base, "outside", `${action}.txt`);
      await writeFile(outside, "unchanged");
      const junction = join(root, `junction-${action}`);
      await symlink(join(base, "outside"), junction, "junction");
      for (const path of [
        outside,
        `../outside/${action}.txt`,
        join(junction, `${action}.txt`),
        "file.txt:stream",
        "invalid\0.txt",
      ])
        expect(
          await execute(action, {
            path,
            ...(["file.create", "file.write"].includes(action) && { content: "changed" }),
          }),
        ).toMatchObject({ ok: false, evidence: "refused" });
      expect(await readFile(outside, "utf8")).toBe("unchanged");
    },
  );

  it("refuses final symlinks even when they point inside the roots", async () => {
    await writeFile(join(root, "link-target.txt"), "unchanged");
    try {
      await symlink(join(root, "link-target.txt"), join(root, "file-link.txt"), "file");
    } catch (error) {
      // Windows needs developer mode or symlink privilege for file links; junctions run above.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    for (const action of ["file.read", "file.write", "file.delete"])
      expect(
        await execute(action, {
          path: "file-link.txt",
          ...(action === "file.write" && { content: "changed" }),
        }),
      ).toMatchObject({ ok: false, evidence: "refused" });
    expect(await readFile(join(root, "link-target.txt"), "utf8")).toBe("unchanged");
  });
});

describe("snapshot failures", () => {
  it.each(["window.list", "screen.describe", "app.focus"])(
    "does not treat a failed Snapshot as an observation for %s",
    async (action) => {
      const text = '{"code":"USER_CONTROL","status":{"state":"user"}}';
      const calls: string[] = [];
      const port: ToolPort = {
        async call(name) {
          calls.push(name);
          return { ok: false, text };
        },
      };
      const result = await runStep(
        step(action, action === "app.focus" ? { name: "Brave" } : {}),
        ctx(port),
      );
      expect(result).toEqual({ ok: false, evidence: "observed-failure", observation: text });
      expect(calls).toEqual(["Snapshot"]);
    },
  );
});

describe("transport and cancellation", () => {
  it("propagates transport errors unchanged", async () => {
    const boom = new Error("pipe closed");
    const port: ToolPort = {
      call: async () => {
        throw boom;
      },
    };
    await expect(runStep(step("media.key", { key: "mute" }), ctx(port))).rejects.toBe(boom);
  });

  it("stops polling when the signal aborts", async () => {
    const controller = new AbortController();
    const { port } = fake(({ name }) => {
      if (name === "App") return "Hesap Makinesi launched.";
      controller.abort();
      return notepad;
    });
    await expect(
      runStep(step("app.open", { name: "hesap makinesi" }), {
        tools: port,
        roots: [root],
        signal: controller.signal,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });
});
