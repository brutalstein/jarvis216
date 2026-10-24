import { describe, expect, it } from "vitest";
import { vocabulary } from "../src/services/vocabulary.js";

describe("vocabulary", () => {
  it("keeps names said twice, not sentence starts, suffixes, one-offs or JARVIS", () => {
    const words = vocabulary([
      "Jarvis, Spotify'ı aç.",
      "Jarvis, Spotify'da Tarkan çal.",
      "Bugün Ece ile Kadıköy'e gidiyoruz.",
      "Jarvis, Ece'yi ara.",
      "Merhaba Jarvis. Jarvis, Netflix aç.",
      "Jarvis, Tarkan çal.",
      "Jarvis, Kadıköy hava durumu?",
    ]);
    expect(words).toEqual(["Ece", "Kadıköy", "Spotify", "Tarkan"]);
  });
});
