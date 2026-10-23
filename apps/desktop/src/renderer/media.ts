import type { PipecatClientOptions } from "@pipecat-ai/client-js";

/** Native microphone adapter: the SDK's WAV adapter needs blob worklets forbidden by our CSP. */
export class Microphone {
  readonly supportsScreenShare = false;
  readonly mediaSupport = { mic: true, cam: false, screenShare: false };
  readonly isCamEnabled = false;
  readonly isSharingScreen = false;
  readonly selectedCam = {};
  readonly selectedSpeaker = {};
  isMicEnabled = true;
  selectedMic: MediaDeviceInfo | Record<string, never> = {};
  private stream?: MediaStream;
  private audio?: AudioContext;
  private animation = 0;
  private options: PipecatClientOptions | undefined;
  private generation = 0;
  private replacing: Promise<void> = Promise.resolve();
  constructor(private replace: (track: MediaStreamTrack) => Promise<void>) {}
  setClientOptions(options: PipecatClientOptions) {
    this.options = options;
    this.isMicEnabled = options.enableMic ?? true;
  }
  async initialize() {
    if (!this.stream) await this.updateMic("");
  }
  async connect() {
    await this.initialize();
  }
  async disconnect() {
    this.generation++;
    cancelAnimationFrame(this.animation);
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = undefined;
    const audio = this.audio;
    this.audio = undefined;
    await audio?.close();
  }
  async getAllMics() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
  }
  async getAllCams() {
    return [];
  }
  async getAllSpeakers() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audiooutput",
    );
  }
  async updateMic(id: string) {
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(id ? { deviceId: { exact: id } } : {}),
      },
      video: false,
    });
    const track = stream.getAudioTracks()[0];
    const stop = () =>
      stream.getTracks().forEach((t) => {
        t.stop();
      });
    if (!track) {
      stop();
      throw new Error("MICROPHONE_UNAVAILABLE");
    }
    if (generation !== this.generation) {
      stop();
      return;
    }
    track.enabled = this.isMicEnabled;
    try {
      const replacing = this.replacing.then(async () => {
        if (generation === this.generation) await this.replace(track);
      });
      this.replacing = replacing.catch(() => {});
      await replacing;
    } catch (error) {
      stop();
      throw error;
    }
    if (generation !== this.generation) {
      stop();
      return;
    }
    this.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.stream = stream;
    this.selectedMic =
      (await this.getAllMics().catch(() => [])).find(
        (device) => device.deviceId === track.getSettings().deviceId,
      ) ?? {};
    if (generation !== this.generation) return;
    this.options?.callbacks?.onTrackStarted?.(track, {
      id: "operator",
      name: "Operator",
      local: true,
    });
    cancelAnimationFrame(this.animation);
    void this.audio?.close().catch(() => {});
    this.audio = new AudioContext();
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 256;
    this.audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const measure = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += ((value - 128) / 128) ** 2;
      this.options?.callbacks?.onLocalAudioLevel?.(
        Math.min(1, Math.sqrt(sum / samples.length) * 4),
      );
      this.animation = requestAnimationFrame(measure);
    };
    measure();
  }
  enableMic(on: boolean) {
    this.isMicEnabled = on;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = on;
    });
  }
  tracks() {
    return { local: { audio: this.stream?.getAudioTracks()[0] }, bot: {} };
  }
}
