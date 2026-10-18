import type { Block } from "../shared";

export function stage(root: HTMLElement) {
  return (blocks: Block[]) => {
    for (const block of blocks.slice(0, 3)) {
      if (!block || !["text", "list", "code"].includes(block.type)) continue;
      const card = document.createElement("article");
      card.dataset.card = "";
      const header = document.createElement("div");
      header.className = "card-heading";
      const title = document.createElement("h2");
      title.textContent = block.type === "code" ? (block.language ?? "Kod") : (block.title ?? "");
      const pin = document.createElement("button");
      pin.textContent = "Sabitle";
      pin.setAttribute("aria-pressed", "false");
      pin.onclick = () => {
        const on = pin.getAttribute("aria-pressed") !== "true";
        pin.setAttribute("aria-pressed", String(on));
        card.dataset.pinned = String(on);
        pin.textContent = on ? "Bırak" : "Sabitle";
      };
      header.append(title, pin);
      card.append(header);
      if (block.type === "text" && typeof block.body === "string") {
        const p = document.createElement("p");
        p.textContent = block.body.slice(0, 1200);
        card.append(p);
      } else if (block.type === "list" && Array.isArray(block.items)) {
        const list = document.createElement("ul");
        for (const item of block.items.slice(0, 8)) {
          const li = document.createElement("li");
          li.textContent = String(item).slice(0, 200);
          list.append(li);
        }
        card.append(list);
      } else if (block.type === "code" && typeof block.code === "string") {
        const pre = document.createElement("pre");
        pre.textContent = block.code.slice(0, 4000);
        card.append(pre);
      } else continue;
      root.append(card);
      if (root.children.length > 3) root.firstElementChild?.remove();
      setTimeout(() => {
        if (card.dataset.pinned !== "true") card.remove();
      }, 20000);
    }
  };
}

export function captions(element: HTMLElement) {
  let timer: ReturnType<typeof setTimeout>;
  return (text: string) => {
    clearTimeout(timer);
    element.textContent = text.slice(0, 4000);
    element.hidden = false;
    timer = setTimeout(() => {
      element.hidden = true;
      element.textContent = "";
    }, 6000);
  };
}
