import { readFile } from "node:fs/promises";

async function main() {
  const [command, argument, extra] = process.argv.slice(2);
  const token = process.env.JARVIS_TOKEN;
  if (!token) throw new Error("JARVIS_TOKEN required");
  const base = `http://127.0.0.1:${process.env.PORT ?? "2160"}`;
  let path: string;
  let method = "GET";
  let body: string | undefined;
  switch (command) {
    case "submit":
      path = "/v1/tasks";
      method = "POST";
      body = await readFile(argument ?? "", "utf8");
      break;
    case "get":
      path = `/v1/tasks/${argument}`;
      break;
    case "events":
      path = `/v1/tasks/${argument}/events`;
      break;
    case "actions":
      path = `/v1/tasks/${argument}/actions`;
      break;
    case "cancel":
      path = `/v1/tasks/${argument}/cancel`;
      method = "POST";
      break;
    case "approve":
      path = `/v1/actions/${argument}/approve`;
      method = "POST";
      body = JSON.stringify({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
      break;
    case "reconcile":
      path = `/v1/actions/${argument}/reconcile`;
      method = "POST";
      body = await readFile(extra ?? "", "utf8");
      break;
    case "ready":
      path = "/readyz";
      break;
    default:
      throw new Error(
        "Usage: cli submit <json-file> <idempotency-key> | get/events/actions/cancel <task-id> | approve <action-id> | reconcile <action-id> <json-file> | ready",
      );
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(command === "submit" ? { "idempotency-key": extra ?? "" } : {}),
    },
    body,
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  process.stdout.write(`${response.status} ${await response.text()}\n`);
  if (!response.ok) process.exitCode = 1;
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "CLI_FAILED: check arguments, configuration and Core readiness\n",
  );
  process.exitCode = 1;
});
