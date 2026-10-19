import type { UiEvent } from "../shared";
import { hud } from "./hud";
import { Presence } from "./presence";
import { captions, el, hydrateIcons, isState, stage } from "./ui";

hydrateIcons();
const presence = new Presence(el<HTMLCanvasElement>("[data-presence]"));
const caption = captions(el("[data-caption]"));
const show = stage(el("[data-stage]"), { limit: 2 });
const showPlan = hud(el("[data-stage]"), true);

window.jarvis.onEvent((event: UiEvent) => {
  if (!event || typeof event !== "object") return;
  if (event.type === "state" && isState(event.value)) {
    document.body.dataset.state = event.value;
    presence.setState(event.value);
  } else if (event.type === "caption" && typeof event.text === "string" && event.text.trim())
    caption(event.role === "user" ? "user" : "jarvis", event.text);
  else if (event.type === "display" && Array.isArray(event.blocks)) show(event.blocks);
  else if (event.type === "plan") showPlan(event.plan);
  else if (event.type === "announce" && event.kind === "outcome" && event.text.trim())
    caption("jarvis", event.text);
});
