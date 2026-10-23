import type { PlanView, State, UiEvent } from "../shared";
import { connect, type Link } from "./connection";
import { type FeedKind, feed } from "./feed";
import { hud, states as planStates } from "./hud";
import { Presence } from "./presence";
import { settings } from "./settings";
import { captions, el, hydrateIcons, isState, STATES, setIcon, stage } from "./ui";
import { updates } from "./updates";

const NOTICES: Record<string, string> = {
  ENV_MISSING: "Ayar dosyası bulunamadı. Uygulamayı yeniden açıp JARVIS .env dosyasını seçin.",
  VOICE_UNAVAILABLE: "Ses servisi başlatılamadı. Yeniden deneyin.",
  VOICE_DISCONNECTED: "Ses bağlantısı koptu. Yeniden bağlanın.",
  VOICE_PIPELINE_FAILED: "Ses hattı durdu. Yeniden deneyin.",
  MICROPHONE_UNAVAILABLE: "Mikrofona erişilemiyor. Aygıtı ve izni kontrol edin.",
  PLAYBACK_FAILED: "Yanıt sesi çalınamadı. Ses çıkışını kontrol edin.",
};

hydrateIcons();
updates();
const body = document.body;
const presence = new Presence(el<HTMLCanvasElement>("[data-presence]"));
const caption = captions(el("[data-caption]"));
const show = stage(el("[data-stage]"), {
  limit: 3,
  onChange: (count) => {
    body.dataset.cards = String(count > 0);
    cards = count;
    layout();
  },
});
const notice = el("[role=alert]");
const showPlan = hud(el("[data-stage]"));
const toggle = el<HTMLButtonElement>("#listen-toggle");
const log = feed(el("[data-feed-list]"));
const LAYOUTS: Record<string, string> = { focus: "Odak", standard: "Standart", wide: "Geniş" };
const plans = new Map<string, PlanView>();
let cards = 0;
let view = "auto";
try {
  const saved = localStorage.getItem("jarvis.view");
  if (saved === "focus" || saved === "wide") view = saved;
} catch {}

/** Auto mode: JARVIS widens for work and news, steps back to focus when nothing is on screen. */
function layout() {
  const shown = [...plans.values()];
  const next =
    view !== "auto"
      ? view
      : shown.some(
            (plan) =>
              ["RUNNING", "AWAITING_APPROVAL"].includes(plan.status) ||
              plan.panels.some((panel) => panel.type === "news"),
          )
        ? "wide"
        : cards > 0 || shown.length
          ? "standard"
          : "focus";
  body.dataset.view = view;
  el("[data-layout-label]").textContent = view === "auto" ? `JARVIS seçti: ${LAYOUTS[next]}` : "";
  for (const choice of document.querySelectorAll("[data-view-choice]"))
    choice.setAttribute(
      "aria-pressed",
      String((choice as HTMLElement).dataset.viewChoice === view),
    );
  if (body.dataset.layout === next) return;
  const apply = () => {
    body.dataset.layout = next;
  };
  if ("startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(apply);
  else apply();
}

const kindOf = (status: string): FeedKind =>
  status === "AWAITING_APPROVAL"
    ? "wait"
    : ["COMPLETED", "SUCCEEDED", "VERIFIED", "SKIPPED"].includes(status)
      ? "done"
      : ["FAILED", "RECOVERY_REQUIRED", "BLOCKED", "CANCELLED"].includes(status)
        ? "fail"
        : "work";

function track(plan: PlanView) {
  if (plans.get(plan.id)?.status !== plan.status)
    log(kindOf(plan.status), `${plan.goal} · ${planStates[plan.status] ?? plan.status}`);
  plans.delete(plan.id);
  plans.set(plan.id, plan);
  // Mirrors the HUD's five-plan window closely enough to choose a layout.
  const oldest = plans.size > 5 ? plans.keys().next().value : undefined;
  if (oldest) plans.delete(oldest);
  layout();
}
let listening = true;
let link: Link | undefined;
let micId = "";
let speakerId = "";
let reconnects = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let starting: Promise<void> | undefined;

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
  log("fail", el("[data-notice]").textContent ?? "");
  el<HTMLButtonElement>("#retry").hidden = code === "ENV_MISSING";
  notice.hidden = false;
  if (
    ["VOICE_DISCONNECTED", "VOICE_PIPELINE_FAILED"].includes(code) &&
    reconnects < 3 &&
    !retryTimer
  ) {
    retryTimer = setTimeout(
      () => {
        retryTimer = undefined;
        void restart();
      },
      500 * 2 ** reconnects++,
    );
  }
}

function receive(event: UiEvent) {
  if (!event || typeof event !== "object") return;
  if (event.type === "state" && isState(event.value)) setState(event.value);
  else if (event.type === "caption" && typeof event.text === "string" && event.text.trim()) {
    body.dataset.heard = "true";
    const role = event.role === "user" ? "user" : "jarvis";
    caption(role, event.text);
    log(role, event.text);
  } else if (event.type === "display" && Array.isArray(event.blocks)) {
    show(event.blocks);
    const titles = event.blocks.map((block) =>
      block?.type === "code" ? block.language || "Kod" : block?.title,
    );
    log("card", titles.filter(Boolean).join(" · ") || "Yeni kart");
  } else if (event.type === "plan") {
    showPlan(event.plan);
    track(event.plan);
  } else if (event.type === "announce" && event.kind === "outcome" && event.text.trim()) {
    caption("jarvis", event.text);
    log("done", event.text);
  } else if (event.type === "announce" && typeof event.text === "string") log("work", event.text);
  else if (event.type === "listening") setListening(event.value === true);
  else if (event.type === "error") fail(typeof event.code === "string" ? event.code : "");
}

async function startSession() {
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
    if (micId) await link.changeMic(micId);
    if (speakerId) await link.changeSpeaker(speakerId);
    link.setMic(listening);
    notice.hidden = true;
    setState("listening");
  } catch (error) {
    fail(String(error).includes("ENV_MISSING") ? "ENV_MISSING" : "VOICE_UNAVAILABLE");
  }
}
function start(): Promise<void> {
  starting ??= startSession().finally(() => {
    starting = undefined;
  });
  return starting;
}
async function restart() {
  const previous = link;
  link = undefined;
  await previous?.disconnect().catch(() => {});
  await start();
}

for (const choice of document.querySelectorAll<HTMLElement>("[data-view-choice]"))
  choice.addEventListener("click", () => {
    view = choice.dataset.viewChoice ?? "auto";
    try {
      localStorage.setItem("jarvis.view", view);
    } catch {}
    layout();
  });
el("#mini").addEventListener("click", () => window.jarvis.mini());
layout();
window.jarvis.onEvent(receive);
toggle.addEventListener("click", () => window.jarvis.setListening(!listening));
el("#retry").addEventListener("click", async () => {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  reconnects = 0;
  await restart();
});
settings({
  changeMic: async (id) => {
    if (!link) throw new Error("VOICE_UNAVAILABLE");
    await link.changeMic(id);
    micId = id;
  },
  changeSpeaker: async (id) => {
    if (!link) throw new Error("VOICE_UNAVAILABLE");
    await link.changeSpeaker(id);
    speakerId = id;
  },
  listen: () => {
    if (!listening) window.jarvis.setListening(true);
  },
});
void start();
