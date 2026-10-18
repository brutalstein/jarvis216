import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockedShortcut, containedPath, escapeTarget, GuardError } from "../src/guards.js";

let base: string;
let root: string;
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "jarvis-guard-"));
  root = join(base, "Desktop");
  await mkdir(join(root, "Raporlar"), { recursive: true });
  await mkdir(join(base, "Desktop2"));
  await mkdir(join(base, "outside"));
  await symlink(join(base, "outside"), join(root, "link"), "junction");
});
afterAll(() => rm(base, { recursive: true, force: true }));

const rejects = (input: string) =>
  expect(containedPath(input, [root])).rejects.toMatchObject({ code: "PATH_OUTSIDE_ROOTS" });

describe("containedPath", () => {
  it("accepts existing and new paths under a root", async () => {
    expect(await containedPath(join(root, "Raporlar"), [root])).toBe(join(root, "Raporlar"));
    expect(await containedPath(join(root, "Raporlar", "yeni.txt"), [root])).toBe(
      join(root, "Raporlar", "yeni.txt"),
    );
  });

  it("resolves relative paths against the first root", async () => {
    expect(await containedPath("Raporlar", [root])).toBe(join(root, "Raporlar"));
  });

  it("rejects parent traversal, sibling prefixes and junctions leading outside", async () => {
    await rejects(join(root, "..", "outside", "x.txt"));
    await rejects("../outside/x.txt");
    await rejects(join(base, "Desktop2", "x.txt"));
    await rejects(join(root, "link", "x.txt"));
    await rejects("C:\\Windows\\System32\\drivers\\etc\\hosts");
  });

  it("never returns a path outside the roots (property)", async () => {
    const segment = fc.constantFrom("..", ".", "a", "Raporlar", "link", "b.txt");
    await fc.assert(
      fc.asyncProperty(fc.array(segment, { minLength: 1, maxLength: 6 }), async (parts) => {
        try {
          const result = await containedPath(parts.join("/"), [root]);
          const rel = relative(resolve(root), result);
          expect(rel.startsWith("..")).toBe(false);
          // Only root/link is the junction; "Raporlar/link" is an ordinary new path inside.
          expect(rel.split(/[\\/]/)[0]).not.toBe("link");
        } catch (error) {
          expect(error).toBeInstanceOf(GuardError);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("escapeTarget", () => {
  it.each([
    "Windows PowerShell",
    "Administrator: Windows PowerShell",
    "Komut İstemi",
    "C:\\WINDOWS\\system32\\cmd.exe",
    "Çalıştır",
    "Run",
    "Kayıt Defteri Düzenleyicisi",
    "Registry Editor",
    "Görev Yöneticisi",
    "Task Manager",
    "Windows Terminal",
    "User Account Control",
    "Kullanıcı Hesabı Denetimi",
    "Terminal",
    "Başlat",
    "Search",
  ])("refuses %s", (title) => {
    expect(escapeTarget(title)).not.toBeNull();
  });

  it("refuses shell processes whatever the title", () => {
    expect(escapeTarget("Untitled", "pwsh.exe")).not.toBeNull();
  });

  it.each([
    "Untitled - Notepad",
    "Adsız - Not Defteri",
    "Adsız, Not Defteri",
    "Spotify Premium",
    "Running Club - Chrome",
  ])("allows %s", (title) => {
    expect(escapeTarget(title)).toBeNull();
  });
});

describe("blockedShortcut", () => {
  // Windows-MCP aliases "command" to Win; ctrl+esc opens Start; launch_* keys start apps;
  // braces would smuggle SendKeys syntax into one key.
  it.each([
    "win+r",
    "Win+X",
    "windows+e",
    "command+r",
    "ctrl+shift+esc",
    "ctrl+esc",
    "Ctrl+Alt+Delete",
    "alt+f4",
    "win",
    "launch_app1",
    "ctrl+{win}r",
  ])("blocks %s", (keys) => {
    expect(blockedShortcut(keys)).toBe(true);
  });

  it.each(["ctrl+s", "ctrl+c", "ctrl+shift+t", "f5"])("allows %s", (keys) => {
    expect(blockedShortcut(keys)).toBe(false);
  });
});
