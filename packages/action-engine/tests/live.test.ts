import { describe, expect, it } from "vitest";
import { hostsOf, mainStep, narrateLive, spokenDuration, spokenElapsed } from "../src/live.js";

const pages = {
  action: "browser.read_many",
  args: {
    pages: [
      { url: "https://www.reuters.com/world/", expectedText: "World" },
      { url: "https://bbc.com/news", expectedText: "News" },
      { url: "https://www.reuters.com/markets/", expectedText: "Markets" },
    ],
  },
};
const agent = { action: "agent.delegate", args: { instruction: "Fiyatları karşılaştır" } };

describe("live narration", () => {
  it("acknowledges slow work with where it looks and roughly how long", () => {
    expect(
      narrateLive({ type: "working", steps: [pages], etaMs: 21_000, invite: true }, "tr"),
    ).toBe(
      "Reuters.com ve bbc.com sayfalarına bakıyorum, efendim; yaklaşık 20 saniye sürer. Bu arada başka bir şey isterseniz buradayım.",
    );
    expect(narrateLive({ type: "working", steps: [agent], etaMs: 4000 }, "en")).toBe(
      "I've handed it to the specialist agent; it's working on it, sir; it'll take a few seconds.",
    );
    // The longest-running step names a multi-step plan.
    expect(mainStep([{ action: "app.open", args: { name: "Chrome" } }, agent])).toBe(agent);
  });

  it("says which page it moved on to and how many are left", () => {
    const at = (index: number) =>
      narrateLive({ type: "progress", step: pages, detail: "bbc.com", index, total: 3 }, "tr");
    expect(at(2)).toBe("Şimdi bbc.com sayfasını okuyorum; 1 sayfa daha var.");
    expect(at(3)).toBe("Son sayfa, bbc.com.");
    expect(narrateLive({ type: "progress", step: { action: "news.brief", args: {} } }, "en")).toBe(
      "I'm gathering the news.",
    );
  });

  it("keeps the operator posted while it takes long, and admits overruns", () => {
    expect(
      narrateLive({ type: "still", step: agent, elapsedMs: 31_000, remainingMs: 14_000 }, "tr"),
    ).toBe("Hâlâ ajan çalışıyor, efendim; 30 saniye oldu, yaklaşık 15 saniye kaldı.");
    expect(
      narrateLive({ type: "still", step: pages, elapsedMs: 75_000, remainingMs: -5000 }, "en"),
    ).toBe("Still reading the pages, sir; a minute so far, taking longer than usual.");
    expect(narrateLive({ type: "composing" }, "tr")).toBe("Topladıklarımı derliyorum, efendim.");
  });

  it("answers a status question with the step, the page and the time left", () => {
    expect(
      narrateLive(
        {
          type: "status",
          goal: "Haber araştırması",
          step: pages,
          detail: "bbc.com",
          remainingMs: 9000,
        },
        "tr",
      ),
    ).toBe(
      "Haber araştırması: şu an bbc.com sayfasını okuyorum; yaklaşık 10 saniye kaldı, efendim.",
    );
  });

  it("rounds durations the way people say them", () => {
    expect(spokenDuration(3000, "tr")).toBe("birkaç saniye");
    expect(spokenDuration(12_400, "en")).toBe("about 10 seconds");
    expect(spokenDuration(70_000, "tr")).toBe("bir dakika kadar");
    expect(spokenDuration(260_000, "en")).toBe("about 4 minutes");
    expect(spokenElapsed(2000, "tr")).toBe("5 saniye");
    expect(spokenElapsed(130_000, "en")).toBe("2 minutes");
    expect(hostsOf(pages)).toEqual(["reuters.com", "bbc.com"]);
  });
});
