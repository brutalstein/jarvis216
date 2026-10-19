import type { Lang } from "./types.js";

export type NarrationEvent =
  | { type: "proposed"; goal: string; needsApproval: boolean }
  | { type: "confirm" | "status-running" | "status-waiting"; goal: string }
  | {
      type: "step-done" | "step-failed";
      action: string;
      args: Record<string, unknown>;
      detail?: string;
    }
  | {
      type:
        | "plan-done"
        | "plan-failed"
        | "plan-uncertain"
        | "cancelled"
        | "not-understood"
        | "news-fallback"
        | "candidates"
        | "denied"
        | "unavailable"
        | "status-idle";
      count?: number;
    };

type Pair = [tr: string, en: string];
const done: Record<string, (name: string) => Pair> = {
  "app.open": (name) => [`${name} açıldı, efendim.`, `${name} is open, sir.`],
  "app.focus": (name) => [`${name} önde, efendim.`, `${name} is in front, sir.`],
  "app.close": (name) => [`${name} kapatıldı, efendim.`, `${name} is closed, sir.`],
  "ui.type": () => ["Yazdım, efendim.", "Typed, sir."],
  "ui.click": () => ["Tıkladım, efendim.", "Clicked, sir."],
  "web.open": () => ["Sayfa açıldı, efendim.", "The page is open, sir."],
  "memory.save": () => ["Aklımda tutacağım, efendim.", "I'll remember that, sir."],
  "memory.forget": () => ["Unuttum, efendim.", "Forgotten, sir."],
};

// Spoken outcomes come from these templates over Core records, never from model claims.
export function narrate(event: NarrationEvent, lang: Lang): string {
  const pick = ([tr, en]: Pair) => (lang === "tr" ? tr : en);
  switch (event.type) {
    case "proposed":
      return pick(
        event.needsApproval
          ? [
              `${event.goal}: onayınızı bekliyorum, efendim.`,
              `${event.goal}: awaiting your approval, sir.`,
            ]
          : ["Hemen, efendim.", "Right away, sir."],
      );
    case "step-done": {
      const name = typeof event.args.name === "string" ? event.args.name : "";
      return pick(done[event.action]?.(name) ?? ["Tamam, efendim.", "Done, sir."]);
    }
    case "step-failed": {
      const detail = event.detail ? `: ${event.detail}` : "";
      return pick([`Bunu yapamadım${detail}.`, `I couldn't do that${detail}.`]);
    }
    case "plan-done":
      return pick(["Tamamdır, efendim.", "All done, sir."]);
    case "plan-failed":
      return pick(["Bunu tamamlayamadım, efendim.", "I couldn't finish that, sir."]);
    case "plan-uncertain":
      return pick([
        "Sonuçtan emin değilim efendim, kontrol eder misiniz?",
        "I'm not certain it worked, sir. Could you check?",
      ]);
    case "cancelled":
      return pick(["İptal ettim, efendim.", "Cancelled, sir."]);
    case "not-understood":
      return pick([
        "Tam anlayamadım efendim, biraz daha açar mısınız?",
        "I didn't quite get that, sir. Could you rephrase?",
      ]);
    case "news-fallback":
      return pick([
        `${event.count ?? 0} başlık ekranda, efendim.`,
        `${event.count ?? 0} headlines are on screen, sir.`,
      ]);
    case "confirm":
      return pick([
        `${event.goal}: bunu mu istiyorsunuz, efendim?`,
        `${event.goal}: is that what you want, sir?`,
      ]);
    case "status-running":
      return pick([
        `${event.goal}: üzerinde çalışıyorum, efendim.`,
        `${event.goal}: I'm working on it, sir.`,
      ]);
    case "status-waiting":
      return pick([
        `${event.goal}: onayınızı bekliyorum, efendim.`,
        `${event.goal}: waiting for your approval, sir.`,
      ]);
    case "status-idle":
      return pick([
        "Şu an üzerinde çalıştığım bir iş yok, efendim.",
        "I'm not working on anything right now, sir.",
      ]);
    case "denied":
      return pick([
        "Bu işlem ayarlarda kapalı, efendim.",
        "That action is turned off in Settings, sir.",
      ]);
    case "unavailable":
      return pick([
        "Bunu bu kurulumda yapamıyorum, efendim.",
        "I can't do that with this setup, sir.",
      ]);
    case "candidates":
      return pick([
        `${event.count ?? 0} eşleşme var efendim, hangisi?`,
        `I found ${event.count ?? 0} matches, sir. Which one?`,
      ]);
  }
}
