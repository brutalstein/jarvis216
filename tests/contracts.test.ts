import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { EnvelopeSchema, ResultSchema, TaskSpecSchema } from "../src/core/contracts.js";

it("published JSON Schemas match the runtime contracts (run npm run contracts)", async () => {
  for (const [name, schema] of Object.entries({
    task: TaskSpecSchema,
    result: ResultSchema,
    envelope: EnvelopeSchema,
  })) {
    const published = JSON.parse(await readFile(`schemas/${name}.schema.json`, "utf8"));
    expect(published, name).toEqual(z.toJSONSchema(schema));
  }
});

it("rejects envelope event types outside the declared event families", () => {
  const envelope = {
    protocolVersion: 1,
    messageId: "7f0c0b3e-5a8e-4d4b-9d0e-3b1f2a6c9d10",
    correlationId: "0b8f9e4c-2f6d-4a7e-8c1b-5d3e9f0a1b2c",
    causationId: null,
    taskId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    sender: "jarvis-core",
    recipient: "task-events",
    type: "task.transition",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    capabilities: ["text.generate"],
    idempotencyKey: "7f0c0b3e-5a8e-4d4b-9d0e-3b1f2a6c9d10",
    payload: {},
  };
  expect(EnvelopeSchema.safeParse(envelope).success).toBe(true);
  expect(EnvelopeSchema.safeParse({ ...envelope, type: "permissions.granted" }).success).toBe(
    false,
  );
});
