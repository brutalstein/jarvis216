import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { connect } from "node:net";
import type { BootStatus } from "../shared";

export type BootStep = {
  id: string;
  label: string;
  /** Steps that must be ready first; independent steps run at the same time. */
  after?: string[];
  /** Resolves with what the loading screen says about the step; throws an error code. */
  run(): Promise<{ detail?: string; skipped?: boolean } | undefined>;
};

/** Runs every step as soon as its dependencies are ready; true once all are ready or skipped. */
export async function runBoot(
  steps: BootStep[],
  report: (status: BootStatus) => void,
): Promise<boolean> {
  const status: BootStatus = {
    phase: "running",
    steps: steps.map(({ id, label }) => ({ id, label, state: "waiting" })),
  };
  const send = () => report(structuredClone(status));
  const started = new Map<string, Promise<void>>();
  const start = (step: BootStep): Promise<void> => {
    const known = started.get(step.id);
    if (known) return known;
    const entry = status.steps[steps.indexOf(step)] as BootStatus["steps"][number];
    const running = (async () => {
      await Promise.all(
        (step.after ?? []).map((id) => {
          const dependency = steps.find((item) => item.id === id);
          if (!dependency) throw new Error(`BOOT_STEP_UNKNOWN:${id}`);
          return start(dependency);
        }),
      );
      entry.state = "running";
      send();
      try {
        const result = await step.run();
        entry.state = result?.skipped ? "skipped" : "ready";
        if (result?.detail) entry.detail = result.detail;
      } catch (error) {
        entry.state = "failed";
        entry.detail = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        send();
      }
    })();
    started.set(step.id, running);
    return running;
  };
  send();
  const results = await Promise.allSettled(steps.map(start));
  status.phase = results.every((result) => result.status === "fulfilled") ? "ready" : "failed";
  send();
  return status.phase === "ready";
}

export type Service = { stop(): void; exited: Promise<void> };

/**
 * A background process JARVIS owns: hidden, logged straight to a file, stopped with its whole
 * tree. No pipe runs through Electron, so one that is not stopped outlives the app.
 */
export function startService(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: string },
): Service {
  const log = openSync(options.log, "w");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  return {
    exited,
    stop() {
      if (child.exitCode !== null || !child.pid) return;
      // Core and OpenClaw start their own children (MCP servers, browsers): end the whole tree.
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 5000,
        });
      else child.kill("SIGTERM");
    },
  };
}

/** Polls until the probe passes; fails with `code` on timeout or when the process exits. */
export async function waitFor(
  probe: () => Promise<boolean>,
  options: { timeoutMs: number; code: string; exited?: Promise<void> },
): Promise<void> {
  let gone = false;
  void options.exited?.then(() => {
    gone = true;
  });
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    if (gone) throw new Error(`${options.code}_EXITED`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${options.code}_TIMEOUT`);
}

export async function httpOk(url: string, token?: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}
