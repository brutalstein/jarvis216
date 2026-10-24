// The operator's own words for speech recognition to expect: the names, apps and places they
// say. Whisper writes what it hears with this list as its prompt, so "Ece" stays "Ece" instead of
// becoming "Eje" on their microphone. Proper nouns are the words a recognizer cannot guess.

const JARVIS = /^[jcç][ae]rv[iı]s/iu;

export function vocabulary(texts: string[], limit = 40): string[] {
  const counts = new Map<string, number>();
  for (const text of texts)
    for (const sentence of text.split(/[.!?]+/u)) {
      // The first word of a sentence is capitalized anyway; later capitals mark names.
      for (const raw of sentence
        .trim()
        .split(/[\s,;:"()]+/u)
        .slice(1)) {
        // Turkish suffixes after an apostrophe ("Spotify'ı") belong to the same name.
        const word = raw.replace(/['’].*$/u, "").replace(/[-]+$/u, "");
        if (!/^\p{Lu}[\p{L}\p{N}+-]+$/u.test(word) || JARVIS.test(word)) continue;
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
  // Said twice or more: once may be a misrecognition.
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}
