import { randomUUID } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Executor } from "../../src/core/contracts.js";
import { postgres } from "../../src/core/database.js";
import { boot, FakeModel, type Running, type Services, services } from "./harness.js";

// Core against PostgreSQL one network hop away (Supabase Frankfurt from Türkiye: ~45 ms round
// trip), through a proxy that delays every packet. Needs a real server (E2E_DATABASE_URL).
const url = process.env.E2E_DATABASE_URL;
const RTT = Number(process.env.RTT ?? 50);
// A fast hosted model; the database work should hide behind it.
const MODEL_MS = 1200;

type Link = { trips: number; bytes: number };
// Each burst from Core to the server is one request: the round trips a remote database charges.
function latencyProxy(target: URL, link: Link): Promise<Server> {
  const pipe = (from: Socket, to: Socket, request: boolean) => {
    let last = 0;
    from.on("data", (chunk) => {
      link.bytes += chunk.length;
      if (request) link.trips++;
      if (request && process.env.PROXY_LOG)
        console.log(
          Date.now() % 100000,
          chunk
            .toString("latin1")
            .replace(/[^ -~]+/g, " ")
            .slice(0, 110),
        );
      // In order, half a round trip later.
      const at = Math.max(Date.now() + RTT / 2, last);
      last = at;
      setTimeout(() => to.writable && to.write(chunk), at - Date.now());
    });
    from.on("close", () => setTimeout(() => to.destroy(), RTT));
    from.on("error", () => to.destroy());
  };
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    pipe(client, upstream, true);
    pipe(upstream, client, false);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let proxy: Server;
let fakes: Services;
let running: Running;
let link: Link;
let drop: () => Promise<void>;

describe.skipIf(!url)("Core over a remote database", () => {
  beforeEach(async () => {
    const target = new URL(url ?? "");
    const schema = `jarvis_remote_${randomUUID().replaceAll("-", "")}`;
    const admin = postgres(target.toString());
    await admin.query(`CREATE SCHEMA ${schema}`);
    link = { trips: 0, bytes: 0 };
    proxy = await latencyProxy(target, link);
    const far = new URL(target);
    // REMOTE_DIRECT=1: a real remote server (Supabase), measured as is; TLS needs its hostname.
    if (process.env.REMOTE_DIRECT !== "1") {
      far.hostname = "127.0.0.1";
      far.port = String((proxy.address() as { port: number }).port);
    }
    far.searchParams.set("options", `-c search_path=${schema}`);
    const db = postgres(far.toString());
    drop = async () => {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    };
    fakes = await services();
    const model = new FakeModel();
    const slow = (id: string): Executor => {
      const fast = model.executor(id);
      return {
        ...fast,
        async execute(task, signal, report) {
          await delay(MODEL_MS, undefined, { signal });
          return fast.execute(task, signal, report);
        },
      };
    };
    running = await boot(db, fakes.env, model, [slow("gemini-live"), slow("claude-code")]);
  }, 60_000);
  afterEach(async () => {
    await running.stop();
    await fakes.close();
    await drop();
    proxy.close();
  }, 60_000);

  it("stays quiet while idle", async () => {
    await delay(3000);
    const before = { ...link };
    await delay(15_000);
    const trips = link.trips - before.trips;
    // A day of an idle Core, extrapolated from 15 s.
    const mbPerDay = ((link.bytes - before.bytes) * 5760) / 1e6;
    console.log(JSON.stringify({ idleTripsPer15s: trips, idleMBPerDay: mbPerDay }));
    expect(trips).toBeLessThanOrEqual(12);
  }, 40_000);

  it("adds little to a spoken reply", async () => {
    // Past the workers' first claims at startup.
    await delay(3000);
    const before = link.trips;
    const started = Date.now();
    const response = await running.api<{ say: string }>("POST", "/v1/conversation/turns", {
      utterance: "Merhaba",
    });
    const ms = Date.now() - started;
    expect(response.status).toBe(200);
    console.log(
      JSON.stringify({ turnMs: ms, overMs: ms - MODEL_MS, turnTrips: link.trips - before }),
    );
    // Over the model's own time: what the remote database adds to the reply.
    expect(ms - MODEL_MS).toBeLessThan(700);
  }, 30_000);
});
