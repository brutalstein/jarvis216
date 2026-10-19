import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/core/database.js";
import { Durations, durationKey, finisherOf } from "../src/services/eta.js";
import { memoryDatabase } from "./fixtures/pglite.js";

let db: Database;
beforeEach(async () => {
  db = await memoryDatabase();
});
afterEach(async () => {
  await db.close();
});

const read = (count: number) => ({
  action: "browser.read_many",
  args: {
    pages: Array.from({ length: count }, (_, i) => ({
      url: `https://e${i}.com/`,
      expectedText: "x",
    })),
  },
});

describe("measured durations", () => {
  it("starts from catalog defaults, blends early runs, then follows the median", () => {
    const durations = new Durations();
    expect(durations.estimate("agent.delegate")).toBe(45_000);
    durations.record("agent.delegate", 15_000);
    expect(durations.estimate("agent.delegate")).toBe(35_000);
    durations.record("agent.delegate", 18_000);
    durations.record("agent.delegate", 200_000);
    // The median ignores the one outlier.
    expect(durations.estimate("agent.delegate")).toBe(18_000);
  });

  it("learns page reads per page and adds the spoken result", () => {
    const durations = new Durations();
    for (const ms of [4000, 4200, 3800]) durations.record("browser.page", ms);
    expect(durationKey(read(3))).toEqual({ key: "browser.page", units: 3 });
    expect(durations.step(read(3))).toBe(12_000);
    expect(finisherOf([read(3)])).toBe("result");
    expect(finisherOf([{ action: "news.brief" }])).toBe("news");
    expect(finisherOf([{ action: "app.open" }])).toBeUndefined();
    expect(durations.plan([read(2)])).toBe(8000 + 6000);
    expect(durations.plan([{ action: "app.close", args: {} }])).toBe(1500);
  });

  it("survives a restart and keeps only recent runs per action", async () => {
    const first = new Durations(db, 3);
    for (const ms of [1000, 1100, 1200, 9000, 9100, 9200]) first.record("app.open", ms);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = new Durations(db, 3);
    await second.load();
    expect(second.estimate("app.open")).toBe(9100);
    second.record("app.open", -5);
    second.record("app.open", Number.NaN);
    expect(second.estimate("app.open")).toBe(9100);
  });
});
