import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type { State, UiEvent } from "../shared";
import { element } from "./dom";
import { Microphone } from "./media";
import { Presence } from "./presence";
import { settings } from "./settings";
import { captions, stage } from "./stage";

const presence = new Presence(element<HTMLCanvasElement>("[data-presence]"));
const display = stage(element("[data-stage]"));
const caption = captions(element("[data-caption]"));
const labels: Record<State, string> = {
  idle: "Beklemede",
  listening: "Dinliyorum",
  thinking: "Düşünüyorum",
  speaking: "Konuşuyorum",
  approval: "Onay bekliyor",
  error: "Bağlantı kesildi",
};
let client: PipecatClient | undefined;
let microphone: Microphone | undefined;
let listening = true;
function receive(event: UiEvent) {
  if (!event || typeof event !== "object") return;
  if (event.type === "state" && Object.hasOwn(labels, event.value)) {
    document.body.dataset.state = event.value;
    presence.setState(event.value);
    element("[data-status]").textContent = labels[event.value];
  } else if (event.type === "display" && Array.isArray(event.blocks)) display(event.blocks);
  else if (event.type === "caption" && typeof event.text === "string") caption(event.text);
  else if (event.type === "listening") {
    listening = event.value;
    document.body.dataset.listening = String(listening);
    client?.enableMic(listening);
    const button = element("#listen-toggle");
    button.textContent = listening ? "Dinlemeyi durdur" : "Dinlemeyi başlat";
    button.setAttribute("aria-pressed", String(listening));
  } else if (event.type === "error") {
    receive({ type: "state", value: "error" });
    const alert = element("[role=alert]");
    alert.hidden = false;
    alert.textContent =
      "Ses bağlantısı kurulamadı. Ayarlarınızı kontrol edip uygulamayı yeniden açın.";
  }
}
window.jarvis.onEvent(receive);
element("#listen-toggle").onclick = () => window.jarvis.setListening(!listening);
settings((id) => microphone?.updateMic(id));
async function connect() {
  try {
    const voice = await window.jarvis.voice();
    if (voice.test) {
      receive({ type: "state", value: "listening" });
      return;
    }
    microphone = new Microphone(async (track) => {
      // The pinned transport keeps its native peer on pc; device changes replace its audio sender.
      const peer = Reflect.get(transport, "pc") as RTCPeerConnection | undefined;
      await peer
        ?.getSenders()
        .find((sender) => sender.track?.kind === "audio")
        ?.replaceTrack(track);
    });
    const transport = new SmallWebRTCTransport({
      mediaManager: microphone,
      waitForICEGathering: true,
      iceServers: [],
    });
    client = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onServerMessage: (event: UiEvent) => {
          receive(event);
          window.dispatchEvent(new CustomEvent("jarvis:ui", { detail: event }));
        },
        onBotStartedSpeaking: () => receive({ type: "state", value: "speaking" }),
        onBotStoppedSpeaking: () =>
          receive({ type: "state", value: listening ? "listening" : "idle" }),
        onLocalAudioLevel: (level) => presence.setLevel(level),
        onRemoteAudioLevel: (level) => presence.setLevel(level),
        onTrackStarted: (track, participant) => {
          if (track.kind !== "audio") return;
          if (participant?.local)
            void track.applyConstraints({
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            });
          else {
            const audio = document.createElement("audio");
            audio.autoplay = true;
            audio.srcObject = new MediaStream([track]);
            document.body.append(audio);
            void audio.play().catch(() => receive({ type: "error", code: "PLAYBACK_FAILED" }));
          }
        },
        onDisconnected: () => receive({ type: "error", code: "VOICE_DISCONNECTED" }),
        onDeviceError: () => receive({ type: "error", code: "MICROPHONE_UNAVAILABLE" }),
      },
    });
    await client.connect({
      webrtcRequestParams: {
        endpoint: `${voice.url}/offer`,
        headers: new Headers({ authorization: `Bearer ${voice.token}` }),
      },
    });
    await client.tracks().local.audio?.applyConstraints({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    client.enableMic(listening);
    receive({ type: "state", value: listening ? "listening" : "idle" });
  } catch {
    receive({ type: "error", code: "VOICE_UNAVAILABLE" });
  }
}
void connect();
