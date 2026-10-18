import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { appNames } from "./apps.js";
import { ground, normalize, type UiElement } from "./ground.js";
import { blockedShortcut, containedPath, escapeTarget, GuardError } from "./guards.js";
import type { NewsItem } from "./news.js";
import { parseSnapshot, redactSecrets, type Snapshot, snapshotText } from "./snapshot.js";
import type { CompiledStep, ToolPort, ToolResult } from "./types.js";

export type Panel =
  | { type: "windows"; items: string[] }
  | { type: "news"; title: string; items: NewsItem[] };
export type Evidence = {
  ok: boolean;
  evidence: "postcondition" | "tool-ok" | "observed-failure" | "refused";
  observation: string;
  candidates?: string[];
  panel?: Panel;
};
export type RunContext = {
  tools: ToolPort;
  roots: string[];
  signal: AbortSignal;
  timeoutMs?: number;
};

const seen = (observation: string, panel?: Panel): Evidence => ({
  ok: true,
  evidence: "postcondition",
  observation,
  ...(panel && { panel }),
});
const done = (observation: string): Evidence => ({ ok: true, evidence: "tool-ok", observation });
const failed = (observation: string, candidates?: string[]): Evidence => ({
  ok: false,
  evidence: "observed-failure",
  observation,
  ...(candidates && { candidates }),
});
const refused = (observation: string): Evidence => ({
  ok: false,
  evidence: "refused",
  observation,
});

// Windows-MCP reports most failures as ordinary text with isError false.
const errorText = /^error\b/i;
const appFailure = /not found|^failed|^error|^invalid/i;
const bad = (result: ToolResult, pattern = errorText) =>
  !result.ok || pattern.test(result.text.trim());

type Seen = Snapshot & { text: string };
async function look(ctx: RunContext): Promise<Seen> {
  const result = await ctx.tools.call(
    "Snapshot",
    { use_vision: false, use_annotation: false },
    ctx.signal,
  );
  return { ...parseSnapshot(result.text), text: snapshotText(result.text) };
}

// Observes until the condition holds, bounded by the step's time and the signal.
async function until<T>(ctx: RunContext, check: (snapshot: Seen) => T | undefined) {
  const deadline = Date.now() + (ctx.timeoutMs ?? 5000);
  for (;;) {
    const snapshot = await look(ctx);
    const hit = check(snapshot);
    if (hit !== undefined || Date.now() >= deadline) return { hit, snapshot };
    await sleep(300, undefined, { signal: ctx.signal });
  }
}

const hasName = (title: string, names: string[]) =>
  names.some((name) => normalize(title).includes(normalize(name)));
const frontTitle = (snapshot: Snapshot) =>
  snapshot.windows.find((window) => window.focused)?.title ?? "";

const secretField = /parola|sifre|password|passcode|\bpin\b/;
// Clicking a pinned "Terminal" or typing into a password box is refused whatever the window.
function unsafe(element: UiElement): string | null {
  const launcher = escapeTarget(element.name);
  return (
    escapeTarget(element.window) ??
    (launcher === "START_MENU" || launcher === "RUN_DIALOG" ? null : launcher) ??
    (secretField.test(normalize(element.name)) ? "PASSWORD" : null)
  );
}

async function openWindow(ctx: RunContext, names: string[]) {
  return (await look(ctx)).windows.find((window) => hasName(window.title, names))?.title;
}

async function bringToFront(ctx: RunContext, title: string): Promise<boolean> {
  const result = await ctx.tools.call("App", { mode: "switch", name: title }, ctx.signal);
  if (bad(result, appFailure)) return false;
  const { hit } = await until(ctx, (snapshot) =>
    frontTitle(snapshot) === title ? true : undefined,
  );
  return hit === true;
}

const dialogWords = /^(kaydet|kaydetme|save|dont save|iptal|cancel)$/;
const dialogButtons = (snapshot: Snapshot, title: string) =>
  snapshot.elements
    .filter((element) => element.window === title && dialogWords.test(normalize(element.name)))
    .map((element) => element.name);

const outsideRoots = "that path is outside the allowed folders";
async function inside(ctx: RunContext, input: string): Promise<string | null> {
  try {
    return await containedPath(input, ctx.roots);
  } catch (error) {
    if (error instanceof GuardError) return null;
    throw error;
  }
}
const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );
const isFolder = (target: string) =>
  stat(target).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

async function transfer(
  ctx: RunContext,
  mode: "move" | "copy",
  source: string,
  destination: string,
  intoFolder = true,
): Promise<Evidence> {
  const from = await inside(ctx, source);
  let to = await inside(ctx, destination);
  if (!from || !to) return refused(outsideRoots);
  // "Raporlar'a taşı": an existing folder as the destination means into that folder.
  if (intoFolder && (await isFolder(to))) to = path.join(to, path.basename(from));
  const result = await ctx.tools.call(
    "FileSystem",
    { mode, path: from, destination: to },
    ctx.signal,
  );
  if (bad(result)) return failed(result.text);
  const arrived = await exists(to);
  const left = mode === "copy" || !(await exists(from));
  return arrived && left
    ? seen(`${path.basename(to)} is in ${path.dirname(to)}`)
    : failed(result.text);
}

const mediaKeys = new Map([
  ["play_pause", "media_play_pause"],
  ["next", "media_next_track"],
  ["previous", "media_prev_track"],
  ["volume_up", "volume_up"],
  ["volume_down", "volume_down"],
  ["mute", "volume_mute"],
]);
const browsers = /brave|chrome|edge|firefox|opera|vivaldi/;
const clipboardPrefix = "Clipboard content:\n";

type Args = Record<string, unknown>;
const text = (args: Args, key: string) => (typeof args[key] === "string" ? args[key] : "");

const bindings: Record<string, (args: Args, ctx: RunContext) => Promise<Evidence>> = {
  async "app.open"(args, ctx) {
    const names = appNames(text(args, "name"));
    if (names.some((name) => escapeTarget(name)))
      return refused(`${names[0]} opens a shell or a system tool`);
    for (const name of names) {
      const result = await ctx.tools.call("App", { mode: "launch", name }, ctx.signal);
      if (bad(result, appFailure)) continue;
      const { hit } = await until(
        ctx,
        (snapshot) => snapshot.windows.find((window) => hasName(window.title, [name]))?.title,
      );
      return hit ? seen(`${hit} is open`) : failed(`${name} did not open`);
    }
    return failed(`${names[0]} is not in the Start menu`);
  },

  async "app.focus"(args, ctx) {
    const names = appNames(text(args, "name"));
    const title = await openWindow(ctx, names);
    if (!title) return failed(`${names[0]} is not open`);
    return (await bringToFront(ctx, title))
      ? seen(`${title} is in front`)
      : failed(`${title} did not come to the front`);
  },

  async "app.close"(args, ctx) {
    const names = appNames(text(args, "name"));
    const title = await openWindow(ctx, names);
    if (!title) return failed(`${names[0]} is not open`);
    // Alt+F4 closes whatever is in front, so it is pressed only after the window is seen there.
    if (!(await bringToFront(ctx, title)))
      return failed(`${title} did not come to the front; nothing was closed`);
    const pressed = await ctx.tools.call("Shortcut", { shortcut: "alt+f4" }, ctx.signal);
    if (bad(pressed)) return failed(pressed.text);
    const { hit, snapshot } = await until(ctx, (seenNow) => {
      if (!seenNow.windows.some((window) => window.title === title)) return "gone";
      return dialogButtons(seenNow, title).length >= 2 ? "dialog" : undefined;
    });
    if (hit === "gone") return seen(`${title} is closed`);
    const buttons = dialogButtons(snapshot, title);
    return failed(
      buttons.length >= 2
        ? `${title} asks before closing: ${buttons.join(" / ")}`
        : `${title} is still open`,
    );
  },

  async "window.list"(_args, ctx) {
    const items = (await look(ctx)).windows.map((window) => window.title).filter(Boolean);
    // Titles go to the panel only; the observation stays free of screen content.
    return seen(`${items.length} windows`, { type: "windows", items });
  },

  async "screen.describe"(_args, ctx) {
    return seen(redactSecrets((await look(ctx)).text));
  },

  async "media.key"(args, ctx) {
    const shortcut = mediaKeys.get(text(args, "key")) ?? "";
    const result = await ctx.tools.call("Shortcut", { shortcut }, ctx.signal);
    return bad(result) ? failed(result.text) : done(result.text);
  },

  async "ui.click"(args, ctx) {
    const target = text(args, "target");
    const before = await look(ctx);
    const found = ground(target, before.elements, text(args, "window") || undefined);
    if (found.kind === "none") return failed(`I can't see "${target}"`);
    if (found.kind === "many")
      return failed(
        `"${target}" matches ${found.candidates.length} elements`,
        found.candidates.map((element) => element.name),
      );
    const reason = unsafe(found.element);
    if (reason) return refused(`${found.element.name}: ${reason}`);
    const { x, y } = found.element;
    const result = await ctx.tools.call(
      "Click",
      { loc: [x, y], button: "left", clicks: 1 },
      ctx.signal,
    );
    if (bad(result)) return failed(result.text);
    const after = await look(ctx);
    return done(after.text === before.text ? "clicked; the screen did not change" : "clicked");
  },

  async "ui.type"(args, ctx) {
    const typed = text(args, "text");
    const target = text(args, "target");
    const before = await look(ctx);
    const front = frontTitle(before);
    const frontReason = escapeTarget(front);
    if (frontReason) return refused(`${front}: ${frontReason}`);
    let field = before.elements.find((element) => element.focused);
    if (target) {
      const found = ground(target, before.elements, front || undefined);
      if (found.kind === "many")
        return failed(
          `"${target}" matches ${found.candidates.length} elements`,
          found.candidates.map((element) => element.name),
        );
      if (found.kind === "none") return failed(`I can't see "${target}"`);
      field = found.element;
    }
    if (!field) return failed("no text field is focused");
    const reason = unsafe(field);
    if (reason) return refused(`${field.name}: ${reason}`);
    const submit = args.submit === true;
    const result = await ctx.tools.call(
      "Type",
      { text: typed, loc: [field.x, field.y], press_enter: submit },
      ctx.signal,
    );
    if (bad(result)) return failed(result.text);
    if (submit) return done("typed and submitted");
    const { x, y, name } = field;
    const value = (await look(ctx)).elements.find(
      (element) => element.x === x && element.y === y && element.name === name,
    )?.value;
    if (value === undefined) return done("typed");
    return value.includes(typed) ? seen("typed") : failed("the field does not show the typed text");
  },

  async "key.shortcut"(args, ctx) {
    const keys = text(args, "keys");
    if (blockedShortcut(keys)) return refused(`${keys} is not allowed`);
    const front = frontTitle(await look(ctx));
    const reason = escapeTarget(front);
    if (reason) return refused(`${front}: ${reason}`);
    const result = await ctx.tools.call("Shortcut", { shortcut: keys }, ctx.signal);
    return bad(result) ? failed(result.text) : done(result.text);
  },

  async "clipboard.read"(_args, ctx) {
    const result = await ctx.tools.call("Clipboard", { mode: "get" }, ctx.signal);
    if (!result.ok) return failed(result.text);
    return seen(
      result.text.startsWith(clipboardPrefix)
        ? result.text.slice(clipboardPrefix.length)
        : "the clipboard has no text",
    );
  },

  async "clipboard.write"(args, ctx) {
    const written = text(args, "text");
    const set = await ctx.tools.call("Clipboard", { mode: "set", text: written }, ctx.signal);
    if (bad(set)) return failed(set.text);
    const back = await ctx.tools.call("Clipboard", { mode: "get" }, ctx.signal);
    const held = back.text.replace(/\r\n/g, "\n");
    return back.ok && held === `${clipboardPrefix}${written.replace(/\r\n/g, "\n")}`
      ? seen("the clipboard holds the text")
      : failed("the clipboard does not hold the text");
  },

  async "file.list"(args, ctx) {
    const folder = await inside(ctx, text(args, "folder"));
    if (!folder) return refused(outsideRoots);
    const result = await ctx.tools.call("FileSystem", { mode: "list", path: folder }, ctx.signal);
    return bad(result) ? failed(result.text) : seen(result.text);
  },

  "file.move": (args, ctx) =>
    transfer(ctx, "move", text(args, "source"), text(args, "destination")),
  "file.copy": (args, ctx) =>
    transfer(ctx, "copy", text(args, "source"), text(args, "destination")),

  "file.rename"(args, ctx) {
    const source = text(args, "source");
    const name = text(args, "destination");
    // A bare new name stays in the source's folder.
    const destination = /[\\/]/.test(name)
      ? name
      : path.join(path.dirname(path.resolve(ctx.roots[0] ?? "", source)), name);
    return transfer(ctx, "move", source, destination, false);
  },

  async "file.mkdir"(args, ctx) {
    const target = await inside(ctx, text(args, "path"));
    if (!target) return refused(outsideRoots);
    // Windows-MCP FileSystem has no mkdir mode.
    const error = await mkdir(target, { recursive: true }).then(
      () => null,
      (reason: Error) => reason,
    );
    if (error) return failed(error.message);
    return (await isFolder(target))
      ? seen(`${path.basename(target)} is ready`)
      : failed("the folder was not created");
  },

  async "web.open"(args, ctx) {
    // explorer.exe hands an http(s) URL to the default browser; argv, never a shell.
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
    const result = await ctx.tools.call(
      "App",
      { mode: "launch_executable", executable, args: [text(args, "url")] },
      ctx.signal,
    );
    if (bad(result)) return failed(result.text);
    const { hit } = await until(ctx, (snapshot) => {
      const front = frontTitle(snapshot);
      return browsers.test(normalize(front)) ? front : undefined;
    });
    return hit ? seen(`${hit} is in front`) : failed("no browser came to the front");
  },
};

// One desktop step: guards, grounding, the Windows-MCP call, then an observed postcondition.
// Transport errors from the tool port propagate unchanged; Core classifies them as uncertain.
export async function runStep(step: CompiledStep, ctx: RunContext): Promise<Evidence> {
  ctx.signal.throwIfAborted();
  const binding = Object.hasOwn(bindings, step.action) ? bindings[step.action] : undefined;
  if (!binding) throw new Error(`${step.action} is not a desktop action`);
  return binding(step.args, ctx);
}
