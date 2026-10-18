import type { UiEvent } from "../shared";
import { element } from "./dom";
import { Presence } from "./presence";
import { captions, stage } from "./stage";

const presence = new Presence(element<HTMLCanvasElement>("[data-presence]"));
const display = stage(element("[data-stage]"));
const caption = captions(element("[data-caption]"));
window.jarvis.onEvent((event: UiEvent) => {
  if (event.type === "state") {
    document.body.dataset.state = event.value;
    presence.setState(event.value);
  } else if (event.type === "display") display(event.blocks);
  else if (event.type === "caption") caption(event.text);
});
