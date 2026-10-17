import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "native OpenClaw launcher creates its lock directory before CLI admission and preserves locks",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "jarvis-openclaw-launch-"));
    try {
      const scripts = path.join(root, "scripts");
      const bin = path.join(root, "bin");
      const home = path.join(root, "profile");
      const locks = path.join(home, "AppData/Local/OpenClaw/locks/openclaw-state-owners");
      mkdirSync(scripts);
      mkdirSync(bin);
      mkdirSync(home);
      copyFileSync("scripts/openclaw-native.ps1", path.join(scripts, "openclaw-native.ps1"));
      writeFileSync(
        path.join(bin, "openclaw.ps1"),
        `
$lockDir = Join-Path $env:USERPROFILE 'AppData\\Local\\OpenClaw\\locks\\openclaw-state-owners'
if (-not (Test-Path -LiteralPath $lockDir -PathType Container)) { exit 17 }
if ($env:OPENAI_API_KEY -or $env:CODEX_API_KEY -or $env:GEMINI_API_KEY -or $env:GOOGLE_API_KEY -or $env:ANTHROPIC_API_KEY) { exit 18 }
Write-Output ($args -join '|')
exit 0
`,
      );
      const powershell = path.join(
        process.env.SystemRoot ?? "C:/Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      const launch = () =>
        spawnSync(
          powershell,
          [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            path.join(scripts, "openclaw-native.ps1"),
            "models",
            "status",
            "--agent",
            "jarvis-reader",
          ],
          {
            env: {
              ...process.env,
              USERPROFILE: home,
              PATH: `${bin};${process.env.PATH}`,
              OPENAI_API_KEY: "must-not-bill-api",
              CODEX_API_KEY: "must-not-bill-api",
              GEMINI_API_KEY: "unused",
              GOOGLE_API_KEY: "unused",
              ANTHROPIC_API_KEY: "unused",
            },
            encoding: "utf8",
            timeout: 10_000,
          },
        );
      const first = launch();
      expect({ status: first.status, stderr: first.stderr }).toEqual({ status: 0, stderr: "" });
      expect(first.stdout.trim()).toBe("models|status|--agent|jarvis-reader");
      const sentinel = path.join(locks, "existing-owner.lock");
      writeFileSync(sentinel, "preserve this live ownership record");
      expect(launch().status).toBe(0);
      expect(readFileSync(sentinel, "utf8")).toBe("preserve this live ownership record");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
