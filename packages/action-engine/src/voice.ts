import { normalize } from "./ground.js";
import type { Lang } from "./types.js";

// Spoken commands that need no model: stopping must be instant, and picking one of the
// candidates on screen is a clarification the operator already gave. Anything with extra words
// goes to the model as usual, so "ikinci sayfayı aç" is never mistaken for a choice.
export type VoiceCommand =
  | { kind: "cancel"; lang: Lang }
  | { kind: "choose"; index: number | "last"; lang: Lang | null };

const wake = /\b[jc][ae]rvis\w*\b/g;
const politeness = new Set(["hey", "ya", "lutfen", "please", "efendim", "sir", "hemen", "now"]);
const cancelPhrases = new Map<string, Lang>([
  ["dur", "tr"],
  ["dur dur", "tr"],
  ["durdur", "tr"],
  ["iptal", "tr"],
  ["iptal et", "tr"],
  ["vazgec", "tr"],
  ["vazgectim", "tr"],
  ["birak", "tr"],
  ["yeter", "tr"],
  ["kes", "tr"],
  ["stop", "en"],
  ["stop it", "en"],
  ["cancel", "en"],
  ["cancel it", "en"],
  ["abort", "en"],
  ["halt", "en"],
  ["never mind", "en"],
  ["nevermind", "en"],
]);
const ordinals: [string, number | "last", Lang][] = [
  ["birinci", 1, "tr"],
  ["ilk", 1, "tr"],
  ["ikinci", 2, "tr"],
  ["ucuncu", 3, "tr"],
  ["dorduncu", 4, "tr"],
  ["besinci", 5, "tr"],
  ["altinci", 6, "tr"],
  ["yedinci", 7, "tr"],
  ["sekizinci", 8, "tr"],
  ["sonuncu", "last", "tr"],
  ["son", "last", "tr"],
  ["first", 1, "en"],
  ["second", 2, "en"],
  ["third", 3, "en"],
  ["fourth", 4, "en"],
  ["fifth", 5, "en"],
  ["sixth", 6, "en"],
  ["seventh", 7, "en"],
  ["eighth", 8, "en"],
  ["last", "last", "en"],
];
const cardinals = new Map<string, [number, Lang]>([
  ["bir", [1, "tr"]],
  ["iki", [2, "tr"]],
  ["uc", [3, "tr"]],
  ["dort", [4, "tr"]],
  ["bes", [5, "tr"]],
  ["alti", [6, "tr"]],
  ["yedi", [7, "tr"]],
  ["sekiz", [8, "tr"]],
  ["two", [2, "en"]],
  ["three", [3, "en"]],
  ["four", [4, "en"]],
  ["five", [5, "en"]],
  ["six", [6, "en"]],
  ["seven", [7, "en"]],
  ["eight", [8, "en"]],
]);
// Turkish case suffixes on an ordinal: "ikincisi", "ikincisini", "ilkine", "ucuncusunu".
const caseSuffixes = new Set(
  "|i|u|si|su|sini|sunu|sine|suna|ye|ya|yi|yu|ini|unu|ine|una".split("|"),
);
// Words that may surround a choice without changing it ("the second one", "ikincisini seç").
const fillers = new Set(
  "the one option number no pick choose take click on it that olan numara numarali secenek sec secin al tikla tiklayin".split(
    " ",
  ),
);

type Choice = { index: number | "last"; lang: Lang | null };
function choice(word: string): Choice | null {
  const digits = /^#?(\d{1,2})(st|nd|rd|th|n?ci|n?cu|inci|uncu)?$/.exec(word);
  if (digits) return { index: Number(digits[1]), lang: null };
  for (const [stem, index, lang] of ordinals) {
    if (word === stem) return { index, lang };
    if (lang === "tr" && word.startsWith(stem) && caseSuffixes.has(word.slice(stem.length)))
      return { index, lang };
  }
  const cardinal = cardinals.get(word);
  return cardinal ? { index: cardinal[0], lang: cardinal[1] } : null;
}

export function readVoiceCommand(utterance: string): VoiceCommand | null {
  const said = normalize(utterance)
    .replace(wake, " ")
    .replace(/[^\p{L}\p{N}#\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !politeness.has(word));
  if (!said.length || said.length > 5) return null;
  const cancel = cancelPhrases.get(said.join(" "));
  if (cancel) return { kind: "cancel", lang: cancel };
  const core = said.filter((word) => !fillers.has(word));
  // "one" / "number one": only fillers were said, and "one" is the choice.
  if (!core.length)
    return said.filter((word) => word === "one").length === 1
      ? { kind: "choose", index: 1, lang: "en" }
      : null;
  const found = core.map(choice);
  // Exactly one choice word and nothing else that could change the meaning.
  if (found.length !== 1 || !found[0]) return null;
  return { kind: "choose", ...found[0] };
}
