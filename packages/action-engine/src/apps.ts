import { normalize } from "./ground.js";

// Equivalent Start-menu names. The Start menu is localized (Turkish Windows knows "Not Defteri",
// English Windows "Notepad"), so every name of the group is tried in order.
const groups = [
  ["Not Defteri", "Notepad"],
  ["Hesap Makinesi", "Calculator"],
  ["Dosya Gezgini", "File Explorer"],
  ["Ayarlar", "Settings"],
  ["Kamera", "Camera"],
  ["Takvim", "Calendar"],
  ["Saat", "Clock"],
  ["Fotoğraflar", "Photos"],
];

// Spoken (often STT-mangled) forms of names Windows search knows.
const spoken = new Map([
  ["spotifay", "Spotify"],
  ["spotify", "Spotify"],
  ["krom", "Google Chrome"],
  ["chrome", "Google Chrome"],
  ["google chrome", "Google Chrome"],
  ["edge", "Microsoft Edge"],
  ["vs code", "Visual Studio Code"],
  ["vscode", "Visual Studio Code"],
  ["teams", "Microsoft Teams"],
  ["whatsapp", "WhatsApp"],
  ["vatsap", "WhatsApp"],
  ["gezgin", "Dosya Gezgini"],
  ["explorer", "File Explorer"],
]);

export function appNames(name: string): string[] {
  // "Spotify'ı", "Not Defteri'ni": the apostrophe starts a Turkish case suffix.
  const bare = name.replace(/['’]\p{L}*$/u, "").trim();
  const known = spoken.get(normalize(bare)) ?? bare;
  const group = groups.find((names) =>
    names.some((other) => normalize(other) === normalize(known)),
  );
  if (!group) return [known];
  const first = group.find((other) => normalize(other) === normalize(known)) ?? known;
  return [first, ...group.filter((other) => other !== first)];
}
