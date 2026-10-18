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
    cancelAnimationFrame(this.animation);
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = undefined;
    await this.audio?.close();
    this.audio = undefined;
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
    track.enabled = this.isMicEnabled;
    try {
      await this.replace(track);
    } catch (error) {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      throw error;
    }
    this.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.stream = stream;
    this.selectedMic =
      (await this.getAllMics()).find(
        (device) => device.deviceId === track.getSettings().deviceId,
      ) ?? {};
    this.options?.callbacks?.onTrackStarted?.(track, {
      id: "operator",
      name: "Operator",
      local: true,
    });
    cancelAnimationFrame(this.animation);
    await this.audio?.close();
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
