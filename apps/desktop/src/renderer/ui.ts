import caret from "@phosphor-icons/core/assets/light/caret-down-light.svg";
import expand from "@phosphor-icons/core/assets/light/corners-out-light.svg";
import exportIcon from "@phosphor-icons/core/assets/light/export-light.svg";
import gear from "@phosphor-icons/core/assets/light/gear-light.svg";
import mic from "@phosphor-icons/core/assets/light/microphone-light.svg";
import micOff from "@phosphor-icons/core/assets/light/microphone-slash-light.svg";
import news from "@phosphor-icons/core/assets/light/newspaper-light.svg";
import mini from "@phosphor-icons/core/assets/light/picture-in-picture-light.svg";
import pulse from "@phosphor-icons/core/assets/light/pulse-light.svg";
import pin from "@phosphor-icons/core/assets/light/push-pin-light.svg";
import unpin from "@phosphor-icons/core/assets/light/push-pin-slash-light.svg";
import wide from "@phosphor-icons/core/assets/light/sidebar-simple-light.svg";
import auto from "@phosphor-icons/core/assets/light/sparkle-light.svg";
import focus from "@phosphor-icons/core/assets/light/target-light.svg";
import trash from "@phosphor-icons/core/assets/light/trash-light.svg";
import warning from "@phosphor-icons/core/assets/light/warning-light.svg";
import close from "@phosphor-icons/core/assets/light/x-light.svg";
import type { Block, State } from "../shared";

const ICONS = {
  auto,
  caret,
  close,
  expand,
  export: exportIcon,
  focus,
  gear,
  mic,
  micOff,
  mini,
  news,
  pin,
  pulse,
  unpin,
  trash,
  warning,
  wide,
};
export type IconName = keyof typeof ICONS;

export const STATES: Record<State, string> = {
  idle: "Beklemede",
  listening: "Dinliyorum",
  thinking: "Düşünüyorum",
  speaking: "Konuşuyorum",
  approval: "Onayınızı bekliyorum",
  error: "Bağlantı yok",
};

export function isState(value: unknown): value is State {
  return typeof value === "string" && Object.hasOwn(STATES, value);
}

/** Required elements belong to the bundled templates, never to model output. */
export function el<T extends Element = HTMLElement>(selector: string, root: ParentNode = document) {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error("TEMPLATE_ELEMENT_MISSING");
  return found;
}

/** Fills an icon slot with a bundled Phosphor SVG. */
export function setIcon(slot: HTMLElement, name: IconName) {
  const svg = new DOMParser().parseFromString(ICONS[name], "image/svg+xml").documentElement;
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  slot.dataset.icon = name;
  slot.replaceChildren(document.importNode(svg, true));
}

export function hydrateIcons(root: ParentNode = document) {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const name = slot.dataset.icon ?? "";
    if (Object.hasOwn(ICONS, name)) setIcon(slot, name as IconName);
  }
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ease = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Shows only the latest sentence and lets it fade after a reading pause. */
export function captions(node: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = 0;
  return (role: "user" | "jarvis", text: string) => {
    const id = ++shown;
    clearTimeout(timer);
    node.getAnimations().forEach((animation) => {
      animation.cancel();
    });
    node.dataset.role = role;
    node.textContent = text.slice(0, 600);
    node.hidden = false;
    if (!reducedMotion.matches)
      node.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 420, easing: ease },
      );
    const words = text.split(/\s+/).length;
    timer = setTimeout(
      () => {
        const hide = () => {
          if (id === shown) node.hidden = true;
        };
        if (reducedMotion.matches) return hide();
        node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: ease }).onfinish =
          hide;
      },
      Math.min(14000, Math.max(7000, words * 450)),
    );
  };
}

const LIFE = 20000;

function render(block: Block): HTMLElement | undefined {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.card = "";
  card.dataset.kind = block.type;
  const title = block.type === "code" ? block.language || "Kod" : block.title;
  if (typeof title === "string" && title.trim()) {
    const heading = document.createElement("h2");
    heading.textContent = title.slice(0, 120);
    card.append(heading);
  }
  // Model output is rendered as text only; nothing is parsed as markup.
  if (block.type === "text" && typeof block.body === "string") {
    const body = document.createElement("p");
    body.textContent = block.body.slice(0, 1200);
    card.append(body);
  } else if (block.type === "list" && Array.isArray(block.items)) {
    const list = document.createElement("ul");
    for (const item of block.items.slice(0, 8)) {
      const row = document.createElement("li");
      row.textContent = String(item).slice(0, 200);
      list.append(row);
    }
    card.append(list);
  } else if (block.type === "code" && typeof block.code === "string") {
    const code = document.createElement("pre");
    code.textContent = block.code.slice(0, 4000);
    card.append(code);
  } else return undefined;
  return card;
}

/** Display cards: newest last, at most `limit`, each fading after 20 s unless pinned. */
export function stage(
  root: HTMLElement,
  options: { limit: number; onChange?(count: number): void },
) {
  const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
  const live = () => [...root.querySelectorAll<HTMLElement>("[data-card]")];
  const changed = () => options.onChange?.(live().length);

  function remove(card: HTMLElement) {
    clearTimeout(timers.get(card));
    card.removeAttribute("data-card");
    card.setAttribute("aria-hidden", "true");
    card.classList.add("leaving");
    setTimeout(() => card.remove(), reducedMotion.matches ? 0 : 320);
  }

  function expire(card: HTMLElement) {
    const line = document.createElement("span");
    line.className = "lifetime";
    card.querySelector(".lifetime")?.remove();
    card.append(line);
    timers.set(
      card,
      setTimeout(() => {
        remove(card);
        changed();
      }, LIFE),
    );
  }

  function pinButton(card: HTMLElement) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button pin";
    const icon = document.createElement("span");
    button.append(icon);
    const show = (pinned: boolean) => {
      button.setAttribute("aria-pressed", String(pinned));
      button.setAttribute("aria-label", pinned ? "Sabitlemeyi kaldır" : "Sabitle");
      setIcon(icon, pinned ? "unpin" : "pin");
    };
    button.addEventListener("click", () => {
      const pinned = card.dataset.pinned !== "true";
      card.dataset.pinned = String(pinned);
      show(pinned);
      if (pinned) clearTimeout(timers.get(card));
      else expire(card);
    });
    show(false);
    return button;
  }

  return (blocks: Block[]) => {
    for (const block of blocks.slice(0, 3)) {
      if (!block || typeof block !== "object") continue;
      const card = render(block);
      if (!card) continue;
      card.append(pinButton(card));
      root.append(card);
      expire(card);
      const cards = live();
      while (cards.length > options.limit) {
        const oldest = cards.find((c) => c.dataset.pinned !== "true") ?? cards[0];
        cards.splice(cards.indexOf(oldest), 1);
        remove(oldest);
      }
    }
    changed();
  };
}
