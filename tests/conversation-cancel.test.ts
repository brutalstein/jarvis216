import { afterEach, expect, it } from "vitest";
import { ConfigSchema } from "../src/app/config.js";
import { type Core, createCore } from "../src/app/core.js";
import type { Database } from "../src/core/database.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let core: Core | undefined;
let db: Database | undefined;
afterEach(async () => {
  await core?.stop();
  await db?.close();
});

it.each([true, false])(
  "aborts a conversational provider on HTTP disconnect (retrySafe=%s)",
  async (retrySafe) => {
    db = await memoryDatabase();
    const env = {
      DATABASE_URL: "postgresql://fixture@127.0.0.1/test",
      JARVIS_TOKEN: "operator-".repeat(8),
      N8N_INGRESS_TOKEN: "webhook-".repeat(8),
    };
    let executing = () => {};
    const started = new Promise<void>((resolve) => {
      executing = resolve;
    });
    let cancelled = false;
    core = await createCore(ConfigSchema.parse(env), {
      db,
      env,
      executors: [
        {
          id: "codex-live",
          capability: "text.generate",
          external: false,
          retrySafe,
          execute: async (_task, signal) => {
            executing();
            return new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  cancelled = true;
                  reject(new Error("cancelled fixture"));
                },
                { once: true },
              );
            });
          },
        },
      ],
    });
    const address = await core.start({ host: "127.0.0.1", port: 0 });
    const abort = new AbortController();
    const request = fetch(`http://127.0.0.1:${address.port}/v1/conversation/turns`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.JARVIS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ utterance: "Jarvis, hello", followUp: false }),
      signal: abort.signal,
    }).catch(() => undefined);
    await started;
    abort.abort();
    await request;
    await expect.poll(() => cancelled, { timeout: 2000 }).toBe(true);
    const rows = (await db.query<{ status: string }>("SELECT status FROM tasks")).rows;
    expect(rows).toEqual([{ status: retrySafe ? "CANCELLED" : "RECOVERY_REQUIRED" }]);
  },
);
