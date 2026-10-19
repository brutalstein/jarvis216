import type { Lang } from "./types.js";

// What JARVIS says while work runs: what it is doing, where it looks, how long it has been and
// roughly how long is left. Every sentence is built from Core's records (the plan's steps,
// what an executor reported, measured durations), never from a model's claims.

export type LiveStep = { action: string; args: Record<string, unknown> };
export type LiveEvent =
  // The reply to a request that will take a while: what it is doing and roughly how long.
  | { type: "working"; steps: LiveStep[]; etaMs?: number; invite?: boolean }
  // A new step started, or a page read moved on to the next page.
  | { type: "progress"; step: LiveStep; detail?: string; index?: number; total?: number }
  // Still at it: how long it has been and how long is left (negative: overdue).
  | { type: "still"; step: LiveStep; elapsedMs: number; remainingMs?: number }
  // Every step is done; the spoken result is being composed.
  | { type: "composing" }
  // "Durum ne?" while a plan runs.
  | { type: "status"; goal: string; step?: LiveStep; detail?: string; remainingMs?: number };

type Pair = [tr: string, en: string];

const hostOf = (url: unknown) => {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};
export function hostsOf(step: LiveStep): string[] {
  const pages = Array.isArray(step.args.pages) ? step.args.pages : [step.args];
  return [
    ...new Set(
      pages.flatMap((page) => {
        const host = hostOf((page as { url?: unknown } | null)?.url);
        return host ? [host] : [];
      }),
    ),
  ];
}
function list(items: string[], lang: Lang): string {
  if (items.length <= 1) return items[0] ?? "";
  const and = lang === "tr" ? "ve" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
}
const capitalize = (text: string, lang: Lang) =>
  text.charAt(0).toLocaleUpperCase(lang === "tr" ? "tr" : "en") + text.slice(1);

export function spokenDuration(ms: number, lang: Lang): string {
  const seconds = ms / 1000;
  if (seconds < 8) return lang === "tr" ? "birkaç saniye" : "a few seconds";
  if (seconds < 50) {
    const rounded = Math.max(10, Math.round(seconds / 5) * 5);
    return lang === "tr" ? `yaklaşık ${rounded} saniye` : `about ${rounded} seconds`;
  }
  if (seconds < 100) return lang === "tr" ? "bir dakika kadar" : "about a minute";
  const minutes = Math.round(seconds / 60);
  return lang === "tr" ? `yaklaşık ${minutes} dakika` : `about ${minutes} minutes`;
}
export function spokenElapsed(ms: number, lang: Lang): string {
  const seconds = ms / 1000;
  if (seconds < 50) {
    const rounded = Math.max(5, Math.round(seconds / 5) * 5);
    return lang === "tr" ? `${rounded} saniye` : `${rounded} seconds`;
  }
  if (seconds < 100) return lang === "tr" ? "bir dakika" : "a minute";
  const minutes = Math.round(seconds / 60);
  return lang === "tr" ? `${minutes} dakika` : `${minutes} minutes`;
}

// What the step does, said as it starts, and said again while it is still going.
function doing(step: LiveStep, lang: Lang): { now: string; still: string } {
  const pick = ([tr, en]: Pair) => (lang === "tr" ? tr : en);
  switch (step.action) {
    case "browser.read":
    case "browser.read_many": {
      const hosts = hostsOf(step);
      const many = hosts.length > 1;
      return {
        now: hosts.length
          ? pick([
              `${list(hosts, "tr")} ${many ? "sayfalarına" : "sayfasına"} bakıyorum`,
              `I'm reading ${list(hosts, "en")}`,
            ])
          : pick(["sayfalara bakıyorum", "I'm reading the pages"]),
        still: pick([
          many ? "sayfaları okuyorum" : "sayfayı okuyorum",
          many ? "reading the pages" : "reading the page",
        ]),
      };
    }
    case "agent.delegate":
      return {
        now: pick([
          "uzman ajana devrettim, araştırıyor",
          "I've handed it to the specialist agent; it's working on it",
        ]),
        still: pick(["ajan çalışıyor", "with the agent"]),
      };
    case "automation.invoke": {
      const name = typeof step.args.workflow === "string" ? step.args.workflow : "";
      return {
        now: pick([
          `"${name}" otomasyonunu çalıştırıyorum`,
          `I'm running the "${name}" automation`,
        ]),
        still: pick(["otomasyon çalışıyor", "running the automation"]),
      };
    }
    case "news.brief":
      return {
        now: pick(["haberleri topluyorum", "I'm gathering the news"]),
        still: pick(["haberleri topluyorum", "gathering the news"]),
      };
    case "screen.describe":
      return {
        now: pick(["ekrana bakıyorum", "I'm looking at the screen"]),
        still: pick(["ekrana bakıyorum", "looking at the screen"]),
      };
    default:
      return {
        now: pick(["üzerinde çalışıyorum", "I'm on it"]),
        still: pick(["üzerinde çalışıyorum", "on it"]),
      };
  }
}

// The longest-running step decides what a multi-step plan "is doing" in one sentence.
const weight: Record<string, number> = {
  "agent.delegate": 5,
  "browser.read_many": 4,
  "browser.read": 4,
  "automation.invoke": 3,
  "news.brief": 2,
  "screen.describe": 1,
};
export function mainStep(steps: LiveStep[]): LiveStep | undefined {
  return [...steps].sort((a, b) => (weight[b.action] ?? 0) - (weight[a.action] ?? 0))[0];
}

export function narrateLive(event: LiveEvent, lang: Lang): string {
  const tr = lang === "tr";
  const sir = tr ? "efendim" : "sir";
  switch (event.type) {
    case "working": {
      const step = mainStep(event.steps);
      const now = capitalize(
        step ? doing(step, lang).now : doing({ action: "", args: {} }, lang).now,
        lang,
      );
      const eta =
        event.etaMs === undefined
          ? `, ${sir}.`
          : tr
            ? `, efendim; ${spokenDuration(event.etaMs, lang)} sürer.`
            : `, sir; it'll take ${spokenDuration(event.etaMs, lang)}.`;
      const invite = event.invite
        ? tr
          ? " Bu arada başka bir şey isterseniz buradayım."
          : " I'm here if you need anything in the meantime."
        : "";
      return `${now}${eta}${invite}`;
    }
    case "progress": {
      const host = event.detail;
      const reading =
        host && (event.step.action === "browser.read" || event.step.action === "browser.read_many");
      if (reading && event.index !== undefined && event.total !== undefined && event.total > 1) {
        const left = event.total - event.index;
        if (left <= 0) return tr ? `Son sayfa, ${host}.` : `Last page now: ${host}.`;
        return tr
          ? `Şimdi ${host} sayfasını okuyorum; ${left} sayfa daha var.`
          : `Now reading ${host}; ${left} more to go.`;
      }
      if (reading) return tr ? `Şimdi ${host} sayfasını okuyorum.` : `Now reading ${host}.`;
      return `${capitalize(doing(event.step, lang).now, lang)}.`;
    }
    case "still": {
      const still = doing(event.step, lang).still;
      const elapsed = spokenElapsed(event.elapsedMs, lang);
      const left =
        event.remainingMs === undefined
          ? ""
          : event.remainingMs <= 0
            ? tr
              ? ", beklediğimden uzun sürüyor"
              : ", taking longer than usual"
            : tr
              ? `, ${spokenDuration(event.remainingMs, lang)} kaldı`
              : `, ${spokenDuration(event.remainingMs, lang)} left`;
      return tr
        ? `Hâlâ ${still}, efendim; ${elapsed} oldu${left}.`
        : `Still ${still}, sir; ${elapsed} so far${left}.`;
    }
    case "composing":
      return tr ? "Topladıklarımı derliyorum, efendim." : "Putting it together now, sir.";
    case "status": {
      const reading =
        event.detail &&
        (event.step?.action === "browser.read" || event.step?.action === "browser.read_many");
      const what = reading
        ? tr
          ? `şu an ${event.detail} sayfasını okuyorum`
          : `I'm reading ${event.detail} right now`
        : event.step
          ? doing(event.step, lang).now
          : tr
            ? "üzerinde çalışıyorum"
            : "I'm working on it";
      const left =
        event.remainingMs === undefined
          ? ""
          : event.remainingMs <= 0
            ? tr
              ? "; beklediğimden uzun sürüyor"
              : "; it's taking longer than usual"
            : tr
              ? `; ${spokenDuration(event.remainingMs, lang)} kaldı`
              : `; ${spokenDuration(event.remainingMs, lang)} left`;
      return `${event.goal}: ${what}${left}, ${sir}.`;
    }
  }
}
