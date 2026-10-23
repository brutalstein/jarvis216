import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configuredProviders } from "../src/app/config.js";
import { type Executor, type Task, TaskSpecSchema } from "../src/core/contracts.js";
import type { Database } from "../src/core/database.js";
import { ActionGateway } from "../src/core/gateway.js";
import { EnvSecrets } from "../src/core/security.js";
import { TaskService } from "../src/core/tasks.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const spec = (privacy: string) =>
  TaskSpecSchema.parse({
    objective: "Summarise my day",
    capability: "text.generate",
    providers: ["remote"],
    privacy,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    verification: { kind: "non-empty" },
  });
const remote = (trustedForPrivate?: boolean): Executor => ({
  id: "remote",
  capability: "text.generate",
  external: true,
  retrySafe: true,
  ...(trustedForPrivate === undefined ? {} : { trustedForPrivate }),
  execute: async () => ({ text: "done", source: "remote" }),
});

describe("private data trust", () => {
  let db: Database;
  let tasks: TaskService;
  beforeEach(async () => {
    db = await memoryDatabase();
    tasks = new TaskService(db);
  });
  afterEach(async () => {
    await db.close();
  });
  const run = async (privacy: string, executor: Executor, key: string) => {
    await tasks.create(spec(privacy), key, "operator");
    const claim = await tasks.claim("w", 10_000);
    return new ActionGateway(tasks).run(claim!, executor, new AbortController().signal);
  };

  it("external private task needs exact approval unless the provider is trusted", async () => {
    expect(await run("private", remote(), "untrusted")).toBe("WAITING_FOR_APPROVAL");
    expect(await run("private", remote(true), "trusted")).toBe("COMPLETED");
  });

  it("personal privacy adds no floor", async () => {
    expect(await run("personal", remote(), "personal")).toBe("COMPLETED");
  });
});

describe("JARVIS_PRIVATE_PROVIDERS", () => {
  it("trust changes the configuration hash", async () => {
    const secrets = new EnvSecrets({ GEMINI_API_KEY: "gemini-test-key" });
    const env = { ENABLE_GEMINI: "true", GEMINI_MODEL: "m" };
    const task = {
      spec: TaskSpecSchema.parse({ ...spec("personal"), providers: ["gemini"] }),
    } as Task;
    const { registry: plain } = await configuredProviders(env, secrets);
    const { registry: trusted } = await configuredProviders(
      { ...env, JARVIS_PRIVATE_PROVIDERS: " gemini, ,other" },
      secrets,
    );
    expect(plain.list()).toMatchObject([
      { id: "gemini", trustedForPrivate: false },
      { id: "gemini-live", trustedForPrivate: false },
      { id: "guide", trustedForPrivate: false },
    ]);
    expect(trusted.list()).toMatchObject([
      { id: "gemini", trustedForPrivate: true },
      { id: "gemini-live", trustedForPrivate: false },
      { id: "guide", trustedForPrivate: false },
    ]);
    expect(plain.select(task, []).configuration).toBe("gemini-api:m:tools-none");
    expect(trusted.select(task, []).configuration).toBe("gemini-api:m:tools-none:trusted-private");
  });
});
