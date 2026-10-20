import { writeFileSync } from "node:fs";

const [mode, record, ...argv] = process.argv.slice(2);
writeFileSync(record, JSON.stringify({ argv, env: process.env, pid: process.pid }));
if (mode === "auth") {
  process.stderr.write("Run gh auth login. secret-from-child-must-not-leak");
  process.exit(4);
}
if (mode === "failure") {
  process.stderr.write("HTTP 503 secret-from-child-must-not-leak");
  process.exit(1);
}
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "invalid") process.stdout.write("not JSON");
else if (mode === "huge") process.stdout.write("x".repeat(100_000));
else
  process.stdout.write(
    JSON.stringify({
      login: "fixture-operator",
      id: 1234,
      url: mode === "foreign" ? "https://evil.example/" : "https://github.com/fixture-operator",
      token: "secret-extra-field-must-not-leak",
    }),
  );
