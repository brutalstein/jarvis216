// Stand-in for claude.exe: node fake-claude.mjs <mode> <recordFile> <claude args...>
import { writeFileSync } from "node:fs";

const [mode, record, ...argv] = process.argv.slice(2);
const result = (isError, text) =>
  JSON.stringify({
    type: "result",
    subtype: isError ? "error" : "success",
    is_error: isError,
    result: text,
    session_id: "s-1",
  });
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  writeFileSync(record, JSON.stringify({ argv, env: process.env, stdin, pid: process.pid }));
  if (mode === "success") process.stdout.write(`${result(false, "verified")}\n`);
  else if (mode === "login") {
    process.stdout.write(`${result(true, "Not logged in · Please run /login")}\n`);
    process.exitCode = 1;
  } else if (mode === "limit")
    process.stdout.write(`${result(true, "Claude AI usage limit reached|1760000000")}\n`);
  else if (mode === "organization-denied") {
    process.stdout.write(
      result(true, "Your organization has disabled Claude subscription access for Claude Code"),
    );
    process.exitCode = 1;
  } else if (mode === "noise")
    process.stdout.write(`update available\n${result(false, "verified")}\n`);
  else if (mode === "huge") process.stdout.write("x".repeat(2 * 1024 * 1024));
  else if (mode === "multibyte") process.stdout.write(result(false, "界".repeat(400_000)));
  else if (mode === "hang") setInterval(() => {}, 1000);
});
