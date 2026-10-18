export type UiElement = { name: string; role: string; window: string; x: number; y: number };

// Turkish-aware matching form: "GÖNDER", "Gönder" and "gonder" are the same; İ/I/ı/i converge.
export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Grounding =
  | { kind: "one"; element: UiElement }
  | { kind: "many"; candidates: UiElement[] }
  | { kind: "none" };

// Deterministic, strongest tier first: exact name, then prefix, then all target words present.
export function ground(target: string, elements: UiElement[], window?: string): Grounding {
  const wanted = normalize(target);
  if (!wanted) return { kind: "none" };
  const scope = window ? normalize(window) : "";
  const scoped = elements.filter(
    (element) => normalize(element.name) && (!scope || normalize(element.window).includes(scope)),
  );
  const words = wanted.split(" ");
  const tiers = [
    (name: string) => name === wanted,
    (name: string) => name.startsWith(wanted),
    (name: string) => words.every((word) => name.split(" ").includes(word)),
  ];
  for (const tier of tiers) {
    const hits = scoped.filter((element) => tier(normalize(element.name)));
    if (hits.length === 1 && hits[0]) return { kind: "one", element: hits[0] };
    if (hits.length > 1) return { kind: "many", candidates: hits };
  }
  return { kind: "none" };
}
