import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appAlias } from "../src/apps.js";
import { ground, normalize, type UiElement } from "../src/ground.js";

const element = (name: string, role = "Button", window = "Outlook", x = 10): UiElement => ({
  name,
  role,
  window,
  x,
  y: 20,
});

describe("normalize", () => {
  it("folds Turkish casing and diacritics", () => {
    expect(normalize("GÖNDER")).toBe("gonder");
    expect(normalize("İPTAL")).toBe("iptal");
    expect(normalize("Işık")).toBe("isik");
    expect(normalize("  Not   Defteri'ni ")).toBe("not defterini");
  });

  it("is idempotent", () => {
    fc.assert(fc.property(fc.string(), (text) => normalize(normalize(text)) === normalize(text)));
  });
});

describe("ground", () => {
  it("finds one element by its Turkish name regardless of case and accents", () => {
    const result = ground("gonder", [element("Gönder"), element("İptal")]);
    expect(result).toEqual({ kind: "one", element: element("Gönder") });
  });

  it("returns all candidates when the name is ambiguous", () => {
    const result = ground("Kaydet", [
      element("Kaydet", "Button", "Word", 1),
      element("Kaydet", "MenuItem", "Word", 2),
    ]);
    expect(result.kind).toBe("many");
    expect(result.kind === "many" && result.candidates).toHaveLength(2);
  });

  it("prefers exact matches over prefixes and token matches", () => {
    const result = ground("Kaydet", [element("Kaydet"), element("Kaydetme seçenekleri")]);
    expect(result).toEqual({ kind: "one", element: element("Kaydet") });
  });

  it("falls back to prefix and token containment", () => {
    expect(ground("yeni", [element("Yeni e-posta")]).kind).toBe("one");
    expect(ground("e-posta yeni", [element("Yeni e-posta")]).kind).toBe("one");
  });

  it("scopes by window and reports none when nothing matches", () => {
    const elements = [element("Gönder", "Button", "Outlook"), element("Gönder", "Button", "Teams")];
    expect(ground("gönder", elements, "teams")).toEqual({ kind: "one", element: elements[1] });
    expect(ground("sil", elements).kind).toBe("none");
  });
});

describe("appAlias", () => {
  it.each([
    ["not defteri", "Notepad"],
    ["Not Defteri'ni", "Notepad"],
    ["hesap makinesi", "Calculator"],
    ["dosya gezgini", "File Explorer"],
    ["ayarlar", "Settings"],
    ["spotifay", "Spotify"],
    ["Spotify", "Spotify"],
    ["krom", "Google Chrome"],
  ])("maps %s to %s", (spoken, name) => {
    expect(appAlias(spoken)).toBe(name);
  });

  it("keeps unknown names, without a Turkish suffix", () => {
    expect(appAlias("Obsidian'ı")).toBe("Obsidian");
  });
});
