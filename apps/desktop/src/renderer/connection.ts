import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type { UiEvent, Voice } from "../shared";
import { Microphone } from "./media";

export type Link = {
  setMic(on: boolean): void;
  changeMic(id: string): Promise<void>;
  disconnect(): Promise<void>;
};

const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** One authenticated loopback WebRTC session with the local voice service. */
export async function connect(
  voice: Voice,
  on: { event(event: UiEvent): void; input(level: number): void; output(level: number): void },
): Promise<Link> {
  let closed = false;
  const emit = (event: UiEvent) => {
    if (!closed) on.event(event);
  };
  const microphone = new Microphone(async (track) => {
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
  let audio: HTMLAudioElement | undefined;
  const client = new PipecatClient({
    transport,
    enableMic: true,
    enableCam: false,
    callbacks: {
      onServerMessage: (data: UiEvent) => emit(data),
      onBotStartedSpeaking: () => emit({ type: "state", value: "speaking" }),
      onBotStoppedSpeaking: () => emit({ type: "state", value: "listening" }),
      onLocalAudioLevel: (level) => on.input(level),
      onRemoteAudioLevel: (level) => on.output(level),
      onTrackStarted: (track, participant) => {
        if (track.kind !== "audio") return;
        if (participant?.local) {
          void track.applyConstraints(CONSTRAINTS);
          return;
        }
        audio ??= document.body.appendChild(document.createElement("audio"));
        audio.autoplay = true;
        audio.srcObject = new MediaStream([track]);
        void audio.play().catch(() => emit({ type: "error", code: "PLAYBACK_FAILED" }));
      },
      onDisconnected: () => emit({ type: "error", code: "VOICE_DISCONNECTED" }),
      onDeviceError: () => emit({ type: "error", code: "MICROPHONE_UNAVAILABLE" }),
    },
  });
  await client.connect({
    webrtcRequestParams: {
      endpoint: `${voice.url}/offer`,
      headers: new Headers({ authorization: `Bearer ${voice.token}` }),
    },
  });
  await client.tracks().local.audio?.applyConstraints(CONSTRAINTS);
  return {
    setMic: (enabled) => client.enableMic(enabled),
    changeMic: (id) => microphone.updateMic(id),
    async disconnect() {
      closed = true;
      audio?.remove();
      await client.disconnect();
    },
  };
}
