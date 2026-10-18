import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Voice } from "../shared";

export async function startVoiceService(options: {
  repoRoot: string;
  coreUrl: string;
  coreToken: string;
  dataDir: string;
  onExit?(): void;
}): Promise<Voice & { stop(): void }> {
  const token = randomBytes(32).toString("hex");
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "HF_HOME",
    "UV_CACHE_DIR",
    "VOICE_SPEAKER_THRESHOLD",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, {
    JARVIS_CORE_URL: options.coreUrl,
    JARVIS_CORE_TOKEN: options.coreToken,
    VOICE_TOKEN: token,
    VOICE_PORT: "0",
    VOICE_DATA_DIR: options.dataDir,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
  });
  const child = spawn(
    "uv",
    [
      "run",
      "--frozen",
      "--directory",
      join(options.repoRoot, "workers/voice"),
      "python",
      "-m",
      "jarvis_voice",
    ],
    {
      cwd: options.repoRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (chunk: Buffer) => {
    if (process.env.JARVIS_E2E === "1")
      console.error(
        String(chunk).replaceAll(options.coreToken, "[redacted]").replaceAll(token, "[redacted]"),
      );
  });
  const stop = () => {
    if (child.exitCode !== null || !child.pid) return;
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 5000,
      });
    } else child.kill("SIGTERM");
  };
  return new Promise((resolve, reject) => {
    let ready = false;
    const fail = () => {
      clearTimeout(timeout);
      stop();
      reject(new Error("VOICE_UNAVAILABLE"));
    };
    const timeout = setTimeout(fail, 30000);
    child.once("error", fail);
    child.once("exit", () => {
      if (!ready) fail();
      else options.onExit?.();
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line: string) => {
      try {
        const event = JSON.parse(line);
        if (
          event.event === "voice.ready" &&
          Number.isInteger(event.port) &&
          event.port > 0 &&
          event.port <= 65535
        ) {
          ready = true;
          clearTimeout(timeout);
          resolve({ url: `http://127.0.0.1:${event.port}`, token, stop });
        } else if (event.event === "turn.timing") {
          // Only numeric timing data leaves the child. Never forward transcripts or credentials.
          const timing = Object.fromEntries(
            Object.entries(event).filter(
              ([key, value]) => key.endsWith("Ms") && typeof value === "number",
            ),
          );
          console.log(JSON.stringify({ event: "turn.timing", ...timing }));
        }
      } catch {
        /* Vendor banners are not protocol messages. */
      }
    });
  });
}
