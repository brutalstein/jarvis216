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
  if (!first || input.split(/[\\/]/).includes("..")) throw new GuardError("PATH_OUTSIDE_ROOTS");
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
  [/windows terminal|git bash|\bwsl\b/, "SHELL"],
  [/^(run|calistir)$/, "RUN_DIALOG"],
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

const keyAliases = new Map([
  ["windows", "win"],
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
  const pressed = new Set(
    keys
      .toLowerCase()
      .split(/[+\s]+/)
      .filter(Boolean)
      .map((key) => keyAliases.get(key) ?? key),
  );
  const all = (...names: string[]) => names.every((name) => pressed.has(name));
  // Any Windows-key combination reaches Run, the power menu or a search that launches programs.
  return (
    pressed.has("win") ||
    all("ctrl", "shift", "esc") ||
    all("ctrl", "alt", "delete") ||
    all("alt", "f4")
  );
}
