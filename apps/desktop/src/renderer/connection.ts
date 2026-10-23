import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import type { UiEvent, Voice } from "../shared";
import { Microphone } from "./media";

export type Link = {
  setMic(on: boolean): void;
  changeMic(id: string): Promise<void>;
  changeSpeaker(id: string): Promise<void>;
  disconnect(): Promise<void>;
};

const CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

async function within<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("VOICE_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  let speakerId = "";
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
        if (closed || track.kind !== "audio") return;
        if (participant?.local) {
          void track
            .applyConstraints(CONSTRAINTS)
            .catch(() => emit({ type: "error", code: "MICROPHONE_UNAVAILABLE" }));
          return;
        }
        audio ??= document.body.appendChild(document.createElement("audio"));
        audio.autoplay = true;
        audio.srcObject = new MediaStream([track]);
        const output = audio;
        const requested = performance.now();
        output.addEventListener(
          "playing",
          () => {
            if (!closed)
              console.info(
                JSON.stringify({
                  event: "voice.playback",
                  playbackStartMs: Math.round(performance.now() - requested),
                }),
              );
          },
          { once: true },
        );
        void output
          .setSinkId(speakerId)
          .then(() => {
            if (!closed) return output.play();
          })
          .catch(() => emit({ type: "error", code: "PLAYBACK_FAILED" }));
      },
      onDisconnected: () => emit({ type: "error", code: "VOICE_DISCONNECTED" }),
      onDeviceError: () => emit({ type: "error", code: "MICROPHONE_UNAVAILABLE" }),
    },
  });
  const connecting = client.connect({
    webrtcRequestParams: {
      endpoint: `${voice.url}/offer`,
      headers: new Headers({ authorization: `Bearer ${voice.token}` }),
    },
  });
  const disconnect = async () => {
    closed = true;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    try {
      await within(client.disconnect(), 5000);
    } finally {
      await microphone.disconnect();
    }
  };
  try {
    await within(connecting, 30000);
    await client.tracks().local.audio?.applyConstraints(CONSTRAINTS);
  } catch (error) {
    await disconnect().catch(() => {});
    // A timed-out SDK operation can still finish; release any resources it creates late.
    void connecting.then(
      () => disconnect().catch(() => {}),
      () => {},
    );
    throw error;
  }
  return {
    setMic: (enabled) => client.enableMic(enabled),
    changeMic: (id) => microphone.updateMic(id),
    async changeSpeaker(id) {
      if (closed) throw new Error("VOICE_DISCONNECTED");
      audio ??= document.body.appendChild(document.createElement("audio"));
      await audio.setSinkId(id);
      speakerId = id;
    },
    disconnect,
  };
}
