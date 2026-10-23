import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { appNames } from "./apps.js";
import { ground, normalize, type UiElement } from "./ground.js";
import { blockedApp, blockedShortcut, containedPath, escapeTarget, GuardError } from "./guards.js";
import type { NewsItem } from "./news.js";
import { parseSnapshot, redactSecrets, type Snapshot, snapshotText } from "./snapshot.js";
import type { CompiledStep, ToolPort, ToolResult } from "./types.js";

export type Panel =
  | { type: "windows"; items: string[] }
  | { type: "news"; title: string; items: NewsItem[] }
  | { type: "text"; title: string; body: string };
export type Evidence = {
  ok: boolean;
  evidence: "postcondition" | "tool-ok" | "observed-failure" | "refused";
  observation: string;
  candidates?: string[];
  // Set when a learned preference resolved several matches, so a correction can unlearn it.
  choice?: { target: string; candidates: string[]; picked: string };
  panel?: Panel;
};
export type RunContext = {
  tools: ToolPort;
  roots: string[];
  signal: AbortSignal;
  timeoutMs?: number;
  // The operator's earlier pick among exactly these candidates for this target, if any.
  prefer?: (target: string, candidates: string[]) => string | undefined;
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
class SnapshotFailure extends Error {}

async function look(ctx: RunContext): Promise<Seen> {
  const result = await ctx.tools.call(
    "Snapshot",
    { use_vision: false, use_annotation: false },
    ctx.signal,
  );
  if (bad(result)) throw new SnapshotFailure(redactSecrets(result.text));
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

// Several matches: the operator's learned pick in this exact situation, if it is still there.
function preferred(ctx: RunContext, target: string, candidates: UiElement[]) {
  const names = candidates.map((element) => element.name);
  const pick = ctx.prefer?.(target, names);
  const found = pick ? candidates.filter((element) => element.name === pick) : [];
  return found.length === 1 && found[0] && pick
    ? { element: found[0], choice: { target, candidates: names, picked: pick } }
    : undefined;
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

const maxFileBytes = 16_000;

async function regularFile(target: string) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink())
    throw new GuardError("only regular files are allowed");
  return info;
}

async function readTextFile(target: string): Promise<string> {
  const before = await regularFile(target);
  if (before.size > maxFileBytes) throw new GuardError("file exceeds 16000 UTF8 bytes");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new GuardError("file changed before reading");
    const buffer = Buffer.alloc(maxFileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxFileBytes) throw new GuardError("file exceeds 16000 UTF8 bytes");
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, length),
      );
    } catch {
      throw new GuardError("file is not valid UTF8");
    }
  } finally {
    await handle.close();
  }
}

async function fileAction(
  operation: "create" | "read" | "write" | "delete",
  args: Record<string, unknown>,
  ctx: RunContext,
): Promise<Evidence> {
  const input = text(args, "path");
  // Refuse Windows alternate streams and NUL paths on every host, before filesystem access.
  if (input.includes("\0") || input.replace(/^[a-z]:[\\/]/i, "").includes(":"))
    return refused(outsideRoots);
  const requested = await inside(ctx, input);
  if (!requested) return refused(outsideRoots);
  let temporary: string | undefined;
  let published = false;
  try {
    // Use the canonical parent so an already-resolved junction is not traversed for the write.
    const target = path.join(await realpath(path.dirname(requested)), path.basename(requested));
    const roots = (
      await Promise.all(ctx.roots.map((root) => realpath(root).catch(() => null)))
    ).filter((root): root is string => root !== null);
    await containedPath(target, roots);
    ctx.signal.throwIfAborted();
    if (operation === "read") {
      const content = await readTextFile(target);
      ctx.signal.throwIfAborted();
      return seen(`${path.basename(target)} was read`, {
        type: "text",
        title: path.basename(target),
        body: content,
      });
    }
    if (operation === "delete") {
      await regularFile(target);
      ctx.signal.throwIfAborted();
      await unlink(target);
      published = true;
      const missing = await lstat(target).then(
        () => false,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return true;
          throw error;
        },
      );
      return missing
        ? seen(`${path.basename(target)} is absent`)
        : failed("the file is still present");
    }
    const content = text(args, "content");
    if (!content.isWellFormed() || Buffer.byteLength(content, "utf8") > maxFileBytes)
      return refused("content exceeds 16000 UTF8 bytes or is invalid");
    const before = operation === "write" ? await regularFile(target) : undefined;
    const destination = path.join(path.dirname(target), `.jarvis-${randomUUID()}.tmp`);
    const handle = await open(destination, "wx", before ? before.mode & 0o777 : 0o600);
    temporary = destination;
    try {
      await handle.writeFile(content, { encoding: "utf8", signal: ctx.signal });
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await readTextFile(destination)) !== content)
      throw new Error("file content readback failed");
    if (before) {
      const current = await regularFile(target);
      if (
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        current.mtimeMs !== before.mtimeMs ||
        current.size !== before.size
      )
        throw new GuardError("file changed before replacement");
      await containedPath(target, roots);
      ctx.signal.throwIfAborted();
      // shortcut: portable Node paths cannot lock parent directories against hostile replacement.
      await rename(destination, target);
      temporary = undefined;
      published = true;
    } else {
      await containedPath(target, roots);
      ctx.signal.throwIfAborted();
      // Linking a prepared sibling publishes complete content and refuses an existing target.
      await link(destination, target);
      published = true;
    }
    return (await readTextFile(target)) === content
      ? seen(`${path.basename(target)} holds the requested content`)
      : failed("the file does not hold the requested content");
  } catch (error) {
    if (published) throw error;
    if (error instanceof GuardError) return refused(error.message);
    // These are definite filesystem refusals; unexpected I/O failures remain uncertain to Core.
    if (
      ["ENOENT", "EEXIST", "EISDIR", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return failed((error as Error).message);
    throw error;
  } finally {
    if (temporary)
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
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
    if (names.some((name) => blockedApp(name)))
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
    const learned = found.kind === "many" ? preferred(ctx, target, found.candidates) : undefined;
    if (found.kind === "many" && !learned)
      return failed(
        `"${target}" matches ${found.candidates.length} elements`,
        found.candidates.map((element) => element.name),
      );
    const element = learned?.element ?? (found.kind === "one" ? found.element : undefined);
    if (!element) return failed(`I can't see "${target}"`);
    const reason = unsafe(element);
    if (reason) return refused(`${element.name}: ${reason}`);
    const { x, y } = element;
    const result = await ctx.tools.call(
      "Click",
      { loc: [x, y], button: "left", clicks: 1 },
      ctx.signal,
    );
    if (bad(result)) return failed(result.text);
    const after = await look(ctx);
    const observation =
      after.text === before.text ? "clicked; the screen did not change" : "clicked";
    return learned
      ? { ...done(`${observation} (learned choice)`), choice: learned.choice }
      : done(observation);
  },

  async "ui.type"(args, ctx) {
    const typed = text(args, "text");
    const target = text(args, "target");
    const before = await look(ctx);
    const front = frontTitle(before);
    const frontReason = escapeTarget(front);
    if (frontReason) return refused(`${front}: ${frontReason}`);
    let field = before.elements.find((element) => element.focused);
    let learned: ReturnType<typeof preferred>;
    if (target) {
      const found = ground(target, before.elements, front || undefined);
      learned = found.kind === "many" ? preferred(ctx, target, found.candidates) : undefined;
      if (found.kind === "many" && !learned)
        return failed(
          `"${target}" matches ${found.candidates.length} elements`,
          found.candidates.map((element) => element.name),
        );
      if (found.kind === "none") return failed(`I can't see "${target}"`);
      field = learned?.element ?? (found.kind === "one" ? found.element : undefined);
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
    const withChoice = (evidence: Evidence): Evidence =>
      learned ? { ...evidence, choice: learned.choice } : evidence;
    if (submit) return withChoice(done("typed and submitted"));
    const { x, y, name } = field;
    const value = (await look(ctx)).elements.find(
      (element) => element.x === x && element.y === y && element.name === name,
    )?.value;
    if (value === undefined) return withChoice(done("typed"));
    return value.includes(typed)
      ? withChoice(seen("typed"))
      : failed("the field does not show the typed text");
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
    const content = result.text.startsWith(clipboardPrefix)
      ? result.text.slice(clipboardPrefix.length)
      : "the clipboard has no text";
    return seen(content, { type: "text", title: "Clipboard", body: content.slice(0, 4000) });
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
    return bad(result)
      ? failed(result.text)
      : seen(result.text, { type: "text", title: "Files", body: result.text.slice(0, 4000) });
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

  "file.create": (args, ctx) => fileAction("create", args, ctx),
  "file.read": (args, ctx) => fileAction("read", args, ctx),
  "file.write": (args, ctx) => fileAction("write", args, ctx),
  "file.delete": (args, ctx) => fileAction("delete", args, ctx),

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
  try {
    return await binding(step.args, ctx);
  } catch (error) {
    if (error instanceof SnapshotFailure) return failed(error.message);
    throw error;
  }
}
