import { appendFileSync } from "node:fs";

const [mode, record, ...argv] = process.argv.slice(2);
let input = "";
for await (const chunk of process.stdin) input += chunk;
appendFileSync(record, `${JSON.stringify({ argv, input, env: process.env, pid: process.pid })}\n`);
if (mode === "auth") {
  process.stderr.write("HTTP 401 secret-child");
  process.exit(4);
}
if (mode === "huge") {
  process.stdout.write("x".repeat(200000));
  process.exit(0);
}
const endpoint = argv[argv.indexOf("--method") + 2];
const repo = {
  id: 1,
  name: "demo",
  full_name: "fixture/demo",
  private: false,
  html_url: "https://github.com/fixture/demo",
  default_branch: "main",
  token: "secret-extra",
};
const issue = {
  id: 2,
  number: 3,
  title: "Fixture issue",
  body: "Details",
  state: "open",
  html_url: "https://github.com/fixture/demo/issues/3",
};
let result = {
  id: 1234,
  login: "fixture",
  html_url: "https://github.com/fixture",
  token: "secret-extra",
};
if (endpoint?.includes("/contents/"))
  result = {
    type: "file",
    path: "README.md",
    size: 5,
    encoding: "base64",
    content: "aGVsbG8=",
    sha: "a".repeat(40),
    html_url: "https://github.com/fixture/demo/blob/main/README.md",
  };
else if (endpoint?.includes("/issues/")) result = issue;
else if (endpoint?.includes("/issues")) result = argv.includes("POST") ? issue : [issue];
else if (endpoint?.includes("/repos?")) result = [repo];
else if (endpoint?.startsWith("repos/")) result = repo;
if (mode === "invalid") result = { arbitrary: "secret-child-value" };
if (mode === "foreign") result.html_url = "https://evil.example/";
process.stdout.write(JSON.stringify(result));
