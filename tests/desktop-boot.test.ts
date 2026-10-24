import { createServer } from "node:net";
import { expect, it } from "vitest";
import { type BootStep, portOpen, runBoot, waitFor } from "../apps/desktop/src/main/boot.js";
import type { BootStatus } from "../apps/desktop/src/shared.js";

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

it("starts independent steps together and each step only after its dependencies", async () => {
  const order: string[] = [];
  const step = (id: string, ms: number, after?: string[]): BootStep => ({
    id,
    label: id,
    ...(after && { after }),
    run: async () => {
      order.push(`${id}:start`);
      await pause(ms);
      order.push(`${id}:end`);
      return { detail: `${id} ok` };
    },
  });
  const reports: BootStatus[] = [];
  const ready = await runBoot(
    [
      step("config", 5),
      step("core", 30, ["config"]),
      step("database", 5, ["core"]),
      step("voice", 10, ["config"]),
    ],
    (status) => reports.push(status),
  );
  expect(ready).toBe(true);
  // Voice runs while Core starts; the database waits for Core.
  expect(order.indexOf("voice:start")).toBeLessThan(order.indexOf("core:end"));
  expect(order.indexOf("database:start")).toBeGreaterThan(order.indexOf("core:end"));
  expect(reports.at(-1)).toEqual({
    phase: "ready",
    steps: ["config", "core", "database", "voice"].map((id) => ({
      id,
      label: id,
      state: "ready",
      detail: `${id} ok`,
    })),
  });
  // Every report is a snapshot, never the live object.
  expect(reports[0]?.steps.every((item) => item.state === "waiting")).toBe(true);
});

it("fails with the error code, keeps dependents waiting and finishes the other steps", async () => {
  const reports: BootStatus[] = [];
  const ready = await runBoot(
    [
      { id: "core", label: "Core", run: async () => Promise.reject(new Error("CORE_TIMEOUT")) },
      { id: "database", label: "DB", after: ["core"], run: async () => ({}) },
      { id: "openclaw", label: "OpenClaw", run: async () => ({ skipped: true, detail: "Kapalı" }) },
    ],
    (status) => reports.push(status),
  );
  expect(ready).toBe(false);
  expect(reports.at(-1)).toEqual({
    phase: "failed",
    steps: [
      { id: "core", label: "Core", state: "failed", detail: "CORE_TIMEOUT" },
      { id: "database", label: "DB", state: "waiting" },
      { id: "openclaw", label: "OpenClaw", state: "skipped", detail: "Kapalı" },
    ],
  });
});

it("waits for a port, and stops waiting when the process exits or time runs out", async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  const { port } = server.address() as { port: number };
  expect(await portOpen(port)).toBe(true);
  server.close();
  await new Promise((done) => server.once("close", done));
  expect(await portOpen(port)).toBe(false);

  let calls = 0;
  await waitFor(async () => ++calls === 2, { timeoutMs: 5000, code: "CORE" });
  expect(calls).toBe(2);
  await expect(
    waitFor(async () => false, { timeoutMs: 5000, code: "CORE", exited: Promise.resolve() }),
  ).rejects.toThrow("CORE_EXITED");
  await expect(waitFor(async () => false, { timeoutMs: 50, code: "DATABASE" })).rejects.toThrow(
    "DATABASE_TIMEOUT",
  );
});
