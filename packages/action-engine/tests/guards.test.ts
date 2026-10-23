import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  blockedApp,
  blockedShortcut,
  containedPath,
  escapeTarget,
  GuardError,
  secretNote,
} from "../src/guards.js";

// realpath on a UNC path makes Windows contact (and authenticate to) that host.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

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
  it("rejects network, device and outside paths before touching the filesystem", async () => {
    vi.mocked(realpath).mockClear();
    for (const input of [
      String.raw`\\evil.example\s`,
      "//evil.example/s",
      String.raw`\\?\C:\x`,
      String.raw`\\.\pipe\x`,
      join(base, "outside", "x"),
    ])
      await rejects(input);
    expect(realpath).not.toHaveBeenCalled();
  });
  it("accepts existing and new paths under a root", async () => {
    expect(await containedPath(join(root, "Raporlar"), [root])).toBe(join(root, "Raporlar"));
    expect(await containedPath(join(root, "Raporlar", "yeni.txt"), [root])).toBe(
      join(root, "Raporlar", "yeni.txt"),
    );
  });

  it("resolves relative paths against the first root", async () => {
    expect(await containedPath("Raporlar", [root])).toBe(join(root, "Raporlar"));
  });

  it("maps a home-relative or named well-known folder to its root", async () => {
    const docs = join(base, "Documents");
    await mkdir(docs, { recursive: true });
    const roots = [root, docs];
    expect(await containedPath("~/Desktop", roots)).toBe(root);
    expect(await containedPath(String.raw`~\Desktop\Raporlar`, roots)).toBe(join(root, "Raporlar"));
    expect(await containedPath("Masaüstü/Raporlar", roots)).toBe(join(root, "Raporlar"));
    expect(await containedPath("~/Belgeler", roots)).toBe(docs);
    expect(await containedPath("documents/a.txt", roots)).toBe(join(docs, "a.txt"));
    for (const input of ["~", "~/outside", "~/AppData/x"])
      await expect(containedPath(input, roots)).rejects.toMatchObject({
        code: "PATH_OUTSIDE_ROOTS",
      });
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

  // Windows-MCP Snapshot gives titles only, so consoles are recognised by their usual titles.
  it.each([
    "MINGW64:/c/Users/cenke",
    "MSYS:/home/cenke",
    "cenke@laptop: ~/jarvis216",
    "Ubuntu",
    "Ubuntu-22.04",
    "kali-linux",
    "Python 3.12 (64-bit)",
    String.raw`C:\Windows\py.exe`,
    "Node.js",
    String.raw`C:\Program Files\nodejs\node.exe`,
    "✳ Claude Code",
  ])("refuses console title %s", (title) => {
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

describe("blockedApp", () => {
  // Windows-MCP fuzzy-matches Start menu names, so a near miss still launches the shell.
  it.each([
    "PowerShell",
    "poweshell",
    "power shell",
    "Komut İstemi",
    "komut istemci",
    "cmd",
    "Windows Terminal",
    "git-bash",
    "wsl",
    "regedt",
    "Görev Yöneticisi",
    "python",
  ])("refuses %s", (name) => {
    expect(blockedApp(name)).not.toBeNull();
  });
  it.each([
    "Spotify",
    "Not Defteri",
    "Notepad",
    "Hesap Makinesi",
    "Calculator",
    "Chrome",
    "WhatsApp",
    "Word",
    "Paint",
    "Steam",
    "Teams",
    "Discord",
  ])("allows %s", (name) => {
    expect(blockedApp(name)).toBeNull();
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

describe("secretNote", () => {
  it.each([
    "Wi-Fi şifrem kedi123",
    "my password is hunter2",
    "PIN 4821",
    "kartım 4111 1111 1111 1111",
    "IBAN TR33 0006 1005 1978 6457 8413 26",
    "token sk-abcdefghijklmnopqrstuv",
  ])("refuses %j", (note) => {
    expect(secretNote(note)).toBe(true);
  });
  it.each([
    "Annemin doğum günü 3 Mayıs",
    "I take my coffee black",
    "Toplantılar her salı 10:00'da",
    "Ali'nin telefonu 0532 123 45 67",
  ])("keeps %j", (note) => {
    expect(secretNote(note)).toBe(false);
  });
});
