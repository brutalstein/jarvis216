import { normalize } from "./ground.js";

// Spoken (often STT-mangled) Turkish names to the names Windows search knows.
const aliases = new Map([
  ["not defteri", "Notepad"],
  ["notepad", "Notepad"],
  ["hesap makinesi", "Calculator"],
  ["dosya gezgini", "File Explorer"],
  ["gezgin", "File Explorer"],
  ["explorer", "File Explorer"],
  ["ayarlar", "Settings"],
  ["spotify", "Spotify"],
  ["spotifay", "Spotify"],
  ["krom", "Google Chrome"],
  ["chrome", "Google Chrome"],
  ["google chrome", "Google Chrome"],
  ["edge", "Microsoft Edge"],
  ["vs code", "Visual Studio Code"],
  ["vscode", "Visual Studio Code"],
  ["teams", "Microsoft Teams"],
  ["whatsapp", "WhatsApp"],
  ["vatsap", "WhatsApp"],
  ["discord", "Discord"],
  ["kamera", "Camera"],
  ["takvim", "Calendar"],
  ["saat", "Clock"],
  ["fotograflar", "Photos"],
]);

export function appAlias(name: string): string {
  // "Spotify'ı", "Not Defteri'ni": the apostrophe starts a Turkish case suffix.
  const bare = name.replace(/['’]\p{L}*$/u, "").trim();
  return aliases.get(normalize(bare)) ?? bare;
}
