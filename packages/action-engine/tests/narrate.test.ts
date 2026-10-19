import { describe, expect, it } from "vitest";
import { type NarrationEvent, narrate } from "../src/narrate.js";

const events: NarrationEvent[] = [
  { type: "proposed", goal: "Spotify'ı aç", needsApproval: true },
  { type: "proposed", goal: "Spotify'ı aç", needsApproval: false },
  { type: "step-done", action: "app.open", args: { name: "Spotify" } },
  { type: "step-failed", action: "app.open", args: { name: "Spotify" }, detail: "pencere yok" },
  { type: "plan-done" },
  { type: "plan-failed" },
  { type: "plan-uncertain" },
  { type: "cancelled" },
  { type: "not-understood" },
  { type: "news-fallback", count: 5 },
  { type: "candidates", count: 3 },
  { type: "unavailable" },
  { type: "denied" },
];

describe("narrate", () => {
  it("asks for approval in Turkish when a plan needs it", () => {
    expect(narrate(events[0] as NarrationEvent, "tr")).toContain("onay");
    expect(narrate(events[0] as NarrationEvent, "en")).toContain("approval");
  });

  it.each(events)("speaks every event in both languages: %o", (event) => {
    expect(narrate(event, "tr").trim()).not.toBe("");
    expect(narrate(event, "en").trim()).not.toBe("");
  });

  it("names the application and the count", () => {
    expect(narrate(events[2] as NarrationEvent, "tr")).toContain("Spotify");
    expect(narrate(events[9] as NarrationEvent, "tr")).toContain("5");
    expect(narrate(events[10] as NarrationEvent, "tr")).toContain("3");
    expect(narrate(events[10] as NarrationEvent, "en")).toContain("3");
  });
});
