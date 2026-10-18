// Turkish-aware matching form: "SPOTİFAYI", "Spotifayı" and "spotifayi" are the same.
export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const wake = /\b[jc][ae]rvis\w*\b/g;
const filler = new Set(["hey", "ya", "lutfen", "please", "efendim", "sir", "hemen", "now", "bir"]);

// What a request means without the name and politeness around it: the recall and reflex key.
export function utteranceKey(utterance: string): string {
  return normalize(utterance)
    .replace(wake, " ")
    .split(" ")
    .filter((word) => word && !filler.has(word))
    .join(" ");
}

// Words whose meaning depends on the conversation ("close it", "aynısını yap"). An utterance
// with them can be an example, never a learned reflex: the same words may mean something else.
const deictic = new Set([
  "o",
  "onu",
  "ona",
  "bu",
  "bunu",
  "buna",
  "su",
  "sunu",
  "suna",
  "onlari",
  "bunlari",
  "tekrar",
  "yine",
  "aynisini",
  "ayni",
  "oraya",
  "buraya",
  "orada",
  "burada",
  "oncekini",
  "sonrakini",
  "it",
  "this",
  "that",
  "them",
  "these",
  "those",
  "again",
  "same",
  "there",
  "here",
  "previous",
]);
export function contextDependent(key: string): boolean {
  return key.split(" ").some((word) => deictic.has(word));
}
