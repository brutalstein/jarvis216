import { realpath } from "node:fs/promises";
import path from "node:path";
import { normalize } from "./ground.js";

export class GuardError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// Real path of the nearest existing ancestor plus the not-yet-existing remainder, so a new
// destination is checked through any junction or symlink above it.
async function realNearest(target: string): Promise<string> {
  const rest: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new GuardError("PATH_OUTSIDE_ROOTS");
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

const inside = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

export async function containedPath(input: string, roots: string[]): Promise<string> {
  const [first] = roots;
  // On POSIX, path.resolve treats Windows absolute paths as ordinary relative strings.
  // Reject foreign-root forms rather than ever writing a "C:\\..." file in an allowed folder.
  // UNC and device forms (\\host\share, //host, \\?\, \\.\) are refused on every platform:
  // realpath on them makes Windows contact and authenticate to that host.
  if (
    !first ||
    input.split(/[\\/]/).includes("..") ||
    /^[\\/]{2}/.test(input) ||
    (process.platform !== "win32" && /^[a-zA-Z]:[\\/]/.test(input))
  )
    throw new GuardError("PATH_OUTSIDE_ROOTS");
<<<<<<< HEAD
  const resolved = path.resolve(first, input);
  // Lexical check first, so no filesystem call leaves the roots; the real-path check below
  // then catches junctions and symlinks inside them.
  if (!roots.some((root) => inside(root, resolved))) throw new GuardError("PATH_OUTSIDE_ROOTS");
  const candidate = await realNearest(resolved);
  for (const root of roots) {
    const real = await realpath(root).catch(() => null);
    if (real && inside(real, candidate)) return candidate;
=======
  const requested = path.resolve(first, input);
  const candidate = await realNearest(requested);
  for (const root of roots) {
    const real = await realpath(root).catch(() => null);
    if (!real) continue;
    const rel = path.relative(real, candidate);
    if (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) {
      // Canonical paths authorize, while the original spelling preserves Windows 8.3 aliases.
      return requested;
    }
>>>>>>> origin/feature/latest-development
  }
  throw new GuardError("PATH_OUTSIDE_ROOTS");
}

const shellProcesses = new Set([
  "powershell.exe",
  "pwsh.exe",
  "cmd.exe",
  "windowsterminal.exe",
  "wt.exe",
  "conhost.exe",
  "openconsole.exe",
  "wsl.exe",
  "bash.exe",
  "mintty.exe",
  "regedit.exe",
  "taskmgr.exe",
  "mmc.exe",
  "consent.exe",
]);
const escapeTitles: [RegExp, string][] = [
  [/powershell|pwsh/, "SHELL"],
  [/komut istemi|command prompt|\bcmd\b/, "SHELL"],
  [/\bterminal\b|git bash|\bwsl\b/, "SHELL"],
  [/^(run|calistir)$/, "RUN_DIALOG"],
  // Typing into Start or Search launches whatever it finds.
  [/^(baslat|start|ara|arama|search)$/, "START_MENU"],
  [/kayit defteri|registry editor|regedit/, "REGISTRY"],
  [/gorev yoneticisi|task manager/, "TASK_MANAGER"],
  [/user account control|kullanici hesabi denetimi/, "UAC"],
  [/^(administrator|yonetici)\s*:/, "ELEVATED"],
  // Windows-MCP gives titles only (no process names), so consoles are matched by usual titles:
  // Git Bash/MSYS, a shell prompt, WSL distributions, REPLs, Claude Code, an executable path.
  [/^(mingw(32|64)|msys|ucrt64|clang(arm)?64)\b|^[\w.-]+@[\w.-]+:/, "SHELL"],
  [/^(ubuntu|debian|kali-linux|opensuse|fedora|alpine|archlinux)(-[\d.]+)?$/, "SHELL"],
  [/^python \d|^node\.js\b|\bclaude code\b|^[a-z]:\\.*\.exe$/, "SHELL"],
];

// Start-menu names that open a shell or a system tool; Windows-MCP fuzzy-matches app names.
const launchers = [
  "powershell",
  "pwsh",
  "cmd",
  "commandprompt",
  "komutistemi",
  "terminal",
  "windowsterminal",
  "gitbash",
  "bash",
  "wsl",
  "ubuntu",
  "regedit",
  "registryeditor",
  "kayitdefteri",
  "taskmanager",
  "gorevyoneticisi",
  "python",
  "node",
  "run",
  "calistir",
  "mmc",
];

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length] ?? 0;
}

// An app name close to a shell or system tool ("poweshell", "power shell") is refused.
export function blockedApp(name: string): string | null {
  const reason = escapeTarget(name);
  if (reason) return reason;
  const flat = normalize(name).replace(/[\s_.-]+/g, "");
  const near = launchers.some((launcher) =>
    launcher.length <= 4 ? flat === launcher : distance(flat, launcher) <= 2,
  );
  return near ? "SHELL" : null;
}

// Typing or clicking into these windows would turn a MEDIUM action into arbitrary execution.
export function escapeTarget(windowTitle: string, processName?: string): string | null {
  if (processName && shellProcesses.has(processName.toLowerCase())) return "SHELL";
  const title = normalize(windowTitle);
  return escapeTitles.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

// Windows-MCP itself maps "windows" and "command" to Win and "option" to Alt.
const keyAliases = new Map([
  ["windows", "win"],
  ["command", "win"],
  ["option", "alt"],
  ["meta", "win"],
  ["super", "win"],
  ["cmd", "win"],
  ["lwin", "win"],
  ["rwin", "win"],
  ["control", "ctrl"],
  ["escape", "esc"],
  ["del", "delete"],
]);

export function blockedShortcut(keys: string): boolean {
  const tokens = keys
    .toLowerCase()
    .split(/[+\s]+/)
    .filter(Boolean)
    .map((key) => keyAliases.get(key) ?? key);
  const pressed = new Set(tokens);
  const all = (...names: string[]) => names.every((name) => pressed.has(name));
  // Any Windows-key combination reaches Run, the power menu or a search that launches programs;
  // ctrl+esc opens Start, launch_* keys start apps, and braces would smuggle SendKeys syntax.
  return (
    tokens.some((key) => key.startsWith("launch_") || !/^([a-z0-9_]+|[^a-z0-9_{}()])$/.test(key)) ||
    pressed.has("win") ||
    all("ctrl", "esc") ||
    all("ctrl", "alt", "delete") ||
    all("alt", "f4")
  );
}
