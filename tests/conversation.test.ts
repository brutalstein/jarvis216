import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Executor } from "../src/contracts.js";
import { ConversationService, conversationProviders, parseReply } from "../src/conversation.js";
import type { Database } from "../src/database.js";
import { conversationPrompt } from "../src/persona.js";
import { ProviderFailure, ProviderRegistry } from "../src/routing.js";
import { buildServer } from "../src/server.js";
import { TaskService } from "../src/tasks.js";
import { Worker } from "../src/worker.js";
import { memoryDatabase } from "./fixtures/pglite.js";

const operatorToken = "operator-fixture-32-characters-minimum";
const auth = { authorization: `Bearer ${operatorToken}` };

describe("reply parsing", () => {
  it("parses plain JSON", () => {
    expect(
      parseReply(
        '{"addressed":true,"say":"Hazır efendim.","lang":"tr","display":[{"type":"list","items":["a"]}]}',
      ),
    ).toEqual({
      addressed: true,
      say: "Hazır efendim.",
      lang: "tr",
      display: [{ type: "list", items: ["a"] }],
    });
  });
  it("parses JSON inside a fence with leading prose", () => {
    const text = 'Here you go:\n```json\n{"say":"Of course, sir.","lang":"en"}\n```';
    expect(parseReply(text)).toEqual({
      addressed: true,
      say: "Of course, sir.",
      lang: "en",
      display: [],
    });
  });
  it("keeps prose whose braces are not a reply object", () => {
    expect(parseReply("Kullanım: f() {} efendim").say).toBe("Kullanım: f() {} efendim");
  });
  it("keeps silence when not addressed", () => {
    expect(parseReply('{"addressed":false}')).toMatchObject({ addressed: false, say: "" });
  });
  it("drops invalid display blocks and keeps at most three", () => {
    const blocks = [
      { type: "text", body: "one" },
      { type: "image", url: "https://example.com/x.png" },
      { type: "code", code: "x = 1" },
      { type: "list", items: [] },
      { type: "text", body: "four" },
      { type: "text", body: "five" },
    ];
    expect(parseReply(JSON.stringify({ say: "ok", display: blocks })).display).toEqual([
      { type: "text", body: "one" },
      { type: "code", code: "x = 1" },
      { type: "text", body: "four" },
    ]);
  });
  it("turns prose into a spoken reply", () => {
    expect(parseReply("Tabii efendim.")).toEqual({
      addressed: true,
      say: "Tabii efendim.",
      lang: "tr",
      display: [],
    });
    expect(parseReply("Certainly, sir.").lang).toBe("en");
  });
});

describe("conversation prompt and providers", () => {
  it("conversationPrompt carries the turn, history and rules", () => {
    const input = {
      utterance: "Jarvis, saat kaç?",
      followUp: false,
      history: [{ utterance: "Merhaba Jarvis", say: "Merhaba efendim." }],
      now: new Date("2026-10-17T19:00:00Z"),
    };
    const prompt = conversationPrompt(input);
    expect(prompt).toContain("Jarvis, saat kaç?");
    expect(prompt).toContain("Merhaba Jarvis");
    expect(prompt).toContain("Merhaba efendim.");
    expect(prompt).toMatch(/never claim/i);
    expect(prompt).not.toMatch(/follow-up window/i);
    expect(conversationPrompt({ ...input, followUp: true })).toMatch(/follow-up window/i);
  });
  it("conversationProviders orders the realtime providers", () => {
    expect(
      conversationProviders(["claude-code", "nv-a", "gemini-live", "or-b", "codex", "claude-live"]),
    ).toEqual(["gemini-live", "claude-live", "or-b", "nv-a", "claude-code"]);
    expect(conversationProviders(["claude", "gemini"])).toEqual([]);
  });
});

describe("conversation turns", () => {
  let db: Database;
  let tasks: TaskService;
  let stop: AbortController;
  let running: Promise<void>;
  beforeEach(async () => {
    db = await memoryDatabase();
    tasks = new TaskService(db);
    stop = new AbortController();
  });
  afterEach(async () => {
    stop.abort();
    await running;
    await db.close();
  });
  const provider = (id: string, execute: Executor["execute"]) => ({
    id,
    execute,
    capability: "text.generate" as const,
    external: true,
    retrySafe: true,
    enabled: true,
    authenticated: true,
    priority: 1,
    maxInputChars: 20_000,
  });
  const start = (providers: ReturnType<typeof provider>[], deadlineMs?: number) => {
    const worker = new Worker(tasks, new ProviderRegistry(providers));
    running = worker.run(stop.signal);
    return new ConversationService(tasks, {
      providers: conversationProviders(providers.map((p) => p.id)),
      wake: () => worker.wake(),
      ...(deadlineMs ? { deadlineMs } : {}),
    });
  };
  const answer = (say: string) => async () => ({
    text: JSON.stringify({ say, lang: "tr" }),
    source: "fixture",
  });
  const server = (conversation: ConversationService) =>
    buildServer(tasks, new ProviderRegistry([]), {
      operatorToken,
      webhookToken: "webhook-fixture-32-characters-minimum",
      onCancel: () => {},
      conversation,
    });

  it("turn falls back and records the reply", async () => {
    const service = start([
      provider("gemini-live", async () => {
        throw new ProviderFailure("rate-limited", true);
      }),
      provider("or-b", answer("Merhaba efendim")),
    ]);
    const result = await service.turn({ utterance: "Jarvis, merhaba", followUp: false });
    expect(result).toMatchObject({ provider: "or-b", say: "Merhaba efendim", addressed: true });
    expect((await service.list(10)).map((t) => t.reply.say)).toEqual(["Merhaba efendim"]);
    const { spec } = await tasks.get(result.taskId);
    expect(spec).toMatchObject({
      privacy: "personal",
      providerOrder: "listed",
      providers: ["gemini-live", "or-b"],
      verification: { kind: "non-empty" },
    });
  });

  it("turn times out", async () => {
    const service = start(
      [
        provider(
          "gemini-live",
          (_task, signal) =>
            new Promise((_, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason)),
            ),
        ),
      ],
      300,
    );
    const response = await server(service).inject({
      method: "POST",
      url: "/v1/conversation/turns",
      headers: auth,
      payload: { utterance: "Jarvis?" },
    });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ error: "TURN_TIMEOUT" });
    const statuses = (await db.query<{ status: string }>("SELECT status FROM tasks")).rows;
    expect(statuses.map((row) => row.status)).toEqual(["FAILED"]);
  });

  it("a turn longer than the socket idle limit still answers", { timeout: 20_000 }, async () => {
    const service = start([
      provider("gemini-live", async () => {
        await delay(10_500);
        return answer("Geç de olsa buradayım.")();
      }),
    ]);
    const app = server(service);
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const { port } = app.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/v1/conversation/turns`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ utterance: "Jarvis, bekle" }),
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { say: string }).say).toBe("Geç de olsa buradayım.");
    } finally {
      await app.close();
    }
  });

  it("endpoints require the operator token, export and delete", async () => {
    const service = start([provider("gemini-live", answer("Buradayım."))]);
    const app = server(service);
    for (const method of ["POST", "GET", "DELETE"] as const)
      expect(
        (await app.inject({ method, url: "/v1/conversation/turns", payload: {} })).statusCode,
      ).toBe(401);
    const turn = await app.inject({
      method: "POST",
      url: "/v1/conversation/turns",
      headers: auth,
      payload: { utterance: "  Jarvis, orada mısın?  ", followUp: false },
    });
    expect(turn.statusCode).toBe(200);
    const exported = await app.inject({ url: "/v1/conversation/turns?limit=5", headers: auth });
    expect(exported.json().turns).toMatchObject([
      { utterance: "Jarvis, orada mısın?", reply: { say: "Buradayım." } },
    ]);
    expect(
      (await app.inject({ method: "DELETE", url: "/v1/conversation/turns", headers: auth }))
        .statusCode,
    ).toBe(204);
    expect(await service.list(10)).toEqual([]);
    const { spec } = await tasks.get(turn.json().taskId);
    expect(spec.objective).toBe("[deleted]");
  });

  it("purge deletes only older turns and scrubs their tasks", async () => {
    const service = start([provider("gemini-live", answer("Tamam."))]);
    const old = await service.turn({ utterance: "Jarvis, eski", followUp: false });
    const recent = await service.turn({ utterance: "Jarvis, yeni", followUp: false });
    const aged = Date.now() - 31 * 86_400_000;
    await db.query("UPDATE conversation_turns SET created_at=$2 WHERE id=$1", [old.id, aged]);
    await db.query("UPDATE tasks SET created_at=$2 WHERE id=$1", [old.taskId, aged]);
    expect(await service.purge(30 * 86_400_000)).toBe(1);
    expect((await service.list(10)).map((t) => t.id)).toEqual([recent.id]);
    expect((await tasks.get(old.taskId)).spec.objective).toBe("[deleted]");
    expect((await tasks.get(recent.taskId)).spec.objective).toContain("Jarvis, yeni");
    const [action] = await tasks.actions(old.taskId);
    expect(JSON.stringify(action)).not.toContain("Jarvis, eski");
  });

  it("speech not meant for JARVIS leaves no prompt behind", async () => {
    const service = start([
      provider("gemini-live", async () => ({
        text: '{"addressed":false,"say":""}',
        source: "fixture",
      })),
    ]);
    const result = await service.turn({ utterance: "televizyon sesi", followUp: true });
    expect(result.addressed).toBe(false);
    expect((await tasks.get(result.taskId)).spec.objective).toBe("[deleted]");
    expect(JSON.stringify(await tasks.actions(result.taskId))).not.toContain("televizyon");
  });

  it("an empty spoken reply fails the turn unless cards carry it", async () => {
    let text = '{"say":""}';
    const service = start([provider("gemini-live", async () => ({ text, source: "fixture" }))]);
    await expect(service.turn({ utterance: "Jarvis?", followUp: false })).rejects.toThrow(
      "TURN_FAILED",
    );
    text = JSON.stringify({ say: "", lang: "tr", display: [{ type: "text", body: "Liste" }] });
    expect(await service.turn({ utterance: "Jarvis, göster", followUp: false })).toMatchObject({
      say: "Ekranda, efendim.",
      display: [{ type: "text", body: "Liste" }],
    });
  });

  it("delete-all also scrubs turns stuck outside the finished states", async () => {
    const service = start([provider("gemini-live", answer("Tamam."))]);
    const turn = await service.turn({ utterance: "Jarvis, takıldı", followUp: false });
    await db.query("UPDATE tasks SET status='RECOVERY_REQUIRED' WHERE id=$1", [turn.taskId]);
    await service.deleteAll();
    expect((await tasks.get(turn.taskId)).spec.objective).toBe("[deleted]");
  });
});
