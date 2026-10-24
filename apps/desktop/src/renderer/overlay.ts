import type { UiEvent } from "../shared";
import { hud } from "./hud";
import { Presence } from "./presence";
import { captions, el, hydrateIcons, isState, setIcon, stage } from "./ui";

hydrateIcons();
const presence = new Presence(el<HTMLCanvasElement>("[data-presence]"));
const caption = captions(el("[data-caption]"));
const show = stage(el("[data-stage]"), { limit: 2 });
const showPlan = hud(el("[data-stage]"), true);
for (const button of document.querySelectorAll("[data-restore]"))
  button.addEventListener("click", () => window.jarvis.restore());
el("[data-quit]").addEventListener("click", () => window.jarvis.quit());

// The mini bar always says whether JARVIS hears you; a click flips it like Ctrl+Alt+J.
const bar = el("[data-window-bar]");
const listen = el("[data-listen]");
let listening = true;
function setListening(on: boolean) {
  listening = on;
  bar.dataset.listening = String(on);
  listen.setAttribute("aria-pressed", String(on));
  el("[data-listen-label]", listen).textContent = on ? "Dinliyor" : "Dinlemiyor";
  setIcon(el("[data-listen-icon]", listen), on ? "mic" : "micOff");
}
listen.addEventListener("click", () => window.jarvis.setListening(!listening));

window.jarvis.onEvent((event: UiEvent) => {
  if (!event || typeof event !== "object") return;
  if (event.type === "listening") setListening(event.value === true);
  else if (event.type === "state" && isState(event.value)) {
    document.body.dataset.state = event.value;
    presence.setState(event.value);
  } else if (event.type === "caption" && typeof event.text === "string" && event.text.trim())
    caption(event.role === "user" ? "user" : "jarvis", event.text);
  else if (event.type === "display" && Array.isArray(event.blocks)) show(event.blocks);
  else if (event.type === "plan") showPlan(event.plan);
  else if (event.type === "announce" && event.kind === "outcome" && event.text.trim())
    caption("jarvis", event.text);
});
