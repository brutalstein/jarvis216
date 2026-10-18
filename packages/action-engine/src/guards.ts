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

export async function containedPath(input: string, roots: string[]): Promise<string> {
  const [first] = roots;
  // On POSIX, path.resolve treats Windows absolute paths as ordinary relative strings.
  // Reject foreign-root forms rather than ever writing a "C:\\..." file in an allowed folder.
  if (!first || input.split(/[\\/]/).includes("..") ||
      (process.platform !== "win32" && path.win32.isAbsolute(input)))
    throw new GuardError("PATH_OUTSIDE_ROOTS");
  const candidate = await realNearest(path.resolve(first, input));
  for (const root of roots) {
    const real = await realpath(root).catch(() => null);
    if (!real) continue;
    const rel = path.relative(real, candidate);
    if (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return candidate;
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
];

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
