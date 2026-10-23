export type FeedKind = "user" | "jarvis" | "work" | "done" | "wait" | "fail" | "card";

const TAGS: Record<FeedKind, string> = {
  user: "Siz",
  jarvis: "JARVIS",
  work: "İşlem",
  done: "Bitti",
  wait: "Onay",
  fail: "Sorun",
  card: "Kart",
};
const LIMIT = 40;
const clock = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

/** Activity log: newest first, text only, capped so a long session stays light. */
export function feed(list: HTMLElement) {
  return (kind: FeedKind, text: string) => {
    const words = text.trim().slice(0, 240);
    const latest = list.firstElementChild as HTMLElement | null;
    if (!words || (latest?.dataset.feedItem === kind && latest.dataset.text === words)) return;
    const item = document.createElement("li");
    item.dataset.feedItem = kind;
    item.dataset.text = words;
    const tag = document.createElement("span");
    tag.className = "feed-tag";
    tag.textContent = TAGS[kind];
    const when = document.createElement("time");
    when.textContent = clock.format(Date.now());
    const what = document.createElement("p");
    what.textContent = words;
    item.append(tag, when, what);
    list.prepend(item);
    for (const old of [...list.children].slice(LIMIT)) old.remove();
  };
}
