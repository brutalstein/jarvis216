import type { State, UiEvent } from "../shared";
import { connect, type Link } from "./connection";
import { hud } from "./hud";
import { Presence } from "./presence";
import { settings } from "./settings";
import { captions, el, hydrateIcons, isState, STATES, setIcon, stage } from "./ui";

const NOTICES: Record<string, string> = {
  ENV_MISSING: "Ayar dosyası bulunamadı. JARVIS_ENV_FILE ile yeniden başlatın.",
  VOICE_UNAVAILABLE: "Ses servisi başlatılamadı. Yeniden deneyin.",
  VOICE_DISCONNECTED: "Ses bağlantısı koptu. Yeniden bağlanın.",
  VOICE_PIPELINE_FAILED: "Ses hattı durdu. Yeniden deneyin.",
  MICROPHONE_UNAVAILABLE: "Mikrofona erişilemiyor. Aygıtı ve izni kontrol edin.",
  PLAYBACK_FAILED: "Yanıt sesi çalınamadı. Ses çıkışını kontrol edin.",
};

hydrateIcons();
const body = document.body;
const presence = new Presence(el<HTMLCanvasElement>("[data-presence]"));
const caption = captions(el("[data-caption]"));
const show = stage(el("[data-stage]"), {
  limit: 3,
  onChange: (count) => {
    body.dataset.cards = String(count > 0);
  },
});
const notice = el("[role=alert]");
const showPlan = hud(el("[data-stage]"));
const toggle = el<HTMLButtonElement>("#listen-toggle");
let listening = true;
let link: Link | undefined;

/** Mirrors renderer-side events to the edge overlay through the main process. */
function relay(event: UiEvent) {
  window.dispatchEvent(new CustomEvent("jarvis:ui", { detail: event }));
}

function setState(value: State) {
  const state = value === "listening" && !listening ? "idle" : value;
  body.dataset.state = state;
  presence.setState(state);
  el("[data-status]").textContent = STATES[state];
}

function setListening(on: boolean) {
  listening = on;
  body.dataset.listening = String(on);
  toggle.setAttribute("aria-pressed", String(on));
  el("[data-listen-label]", toggle).textContent = on ? "Dinlemeyi durdur" : "Dinlemeyi başlat";
  setIcon(el("[data-listen-icon]", toggle), on ? "mic" : "micOff");
  link?.setMic(on);
}

function fail(code: string) {
  setState("error");
  relay({ type: "state", value: "error" });
  el("[data-notice]").textContent = NOTICES[code] ?? NOTICES.VOICE_UNAVAILABLE;
  el<HTMLButtonElement>("#retry").hidden = code === "ENV_MISSING";
  notice.hidden = false;
}

function receive(event: UiEvent) {
  if (!event || typeof event !== "object") return;
  if (event.type === "state" && isState(event.value)) setState(event.value);
  else if (event.type === "caption" && typeof event.text === "string" && event.text.trim()) {
    body.dataset.heard = "true";
    caption(event.role === "user" ? "user" : "jarvis", event.text);
  } else if (event.type === "display" && Array.isArray(event.blocks)) show(event.blocks);
  else if (event.type === "plan") showPlan(event.plan);
  else if (event.type === "announce" && event.kind === "outcome" && event.text.trim())
    caption("jarvis", event.text);
  else if (event.type === "listening") setListening(event.value === true);
  else if (event.type === "error") fail(typeof event.code === "string" ? event.code : "");
}

async function start() {
  notice.hidden = true;
  try {
    const voice = await window.jarvis.voice();
    if (voice.test) {
      setState("listening");
      return;
    }
    link = await connect(voice, {
      event: (event) => {
        receive(event);
        if (event.type !== "error") relay(event);
      },
      input: (level) => presence.setInput(level),
      output: (level) => presence.setOutput(level),
    });
    link.setMic(listening);
    setState("listening");
  } catch (error) {
    fail(String(error).includes("ENV_MISSING") ? "ENV_MISSING" : "VOICE_UNAVAILABLE");
  }
}

window.jarvis.onEvent(receive);
toggle.addEventListener("click", () => window.jarvis.setListening(!listening));
el("#retry").addEventListener("click", async () => {
  const previous = link;
  link = undefined;
  await previous?.disconnect().catch(() => {});
  await start();
});
settings({
  changeMic: async (id) => {
    if (!link) throw new Error("VOICE_UNAVAILABLE");
    await link.changeMic(id);
  },
  listen: () => {
    if (!listening) window.jarvis.setListening(true);
  },
});
void start();
