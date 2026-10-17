import { trace } from "@opentelemetry/api";
import { expect, it } from "vitest";
import { initTracing } from "../src/telemetry.js";

it("exports correlated timing evidence while excluding arbitrary sensitive span attributes", async () => {
  const lines: string[] = [];
  const shutdown = initTracing((line) => lines.push(line));
  try {
    const span = trace.getTracer("test").startSpan("action.execute");
    span.setAttribute("task.id", "task-fixture");
    span.setAttribute("private.prompt", "do-not-export");
    span.end();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "trace.span",
      taskId: "task-fixture",
    });
    expect(lines.join()).not.toContain("do-not-export");
  } finally {
    await shutdown();
    trace.disable();
  }
});
