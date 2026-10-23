import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Options = {
  callbacks: { onTrackStarted(track: { kind: string }, participant: { local: boolean }): void };
};

const sdk = vi.hoisted(() => ({
  options: {} as Options,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../apps/desktop/node_modules/@pipecat-ai/client-js/dist/index.module.js", () => ({
  PipecatClient: class {
    constructor(options: Options) {
      sdk.options = options;
    }
    connect = sdk.connect;
    disconnect = sdk.disconnect;
    tracks = () => ({ local: {} });
    enableMic = vi.fn();
  },
}));
vi.mock(
  "../apps/desktop/node_modules/@pipecat-ai/small-webrtc-transport/dist/index.module.js",
  () => ({
    SmallWebRTCTransport: class {},
  }),
);

import { connect } from "../apps/desktop/src/renderer/connection.js";

const fakeAudio = () => ({
  autoplay: false,
  srcObject: null as unknown,
  setSinkId: vi.fn(async (_id: string) => {}),
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  remove: vi.fn(),
  addEventListener: vi.fn(),
});
let audio: ReturnType<typeof fakeAudio>;
beforeEach(() => {
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  sdk.connect.mockReset().mockResolvedValue(undefined);
  sdk.disconnect.mockReset().mockResolvedValue(undefined);
  audio = fakeAudio();
  vi.stubGlobal("document", {
    body: { appendChild: (element: unknown) => element },
    createElement: () => audio,
  });
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(public tracks: unknown[]) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const callbacks = () => ({ event: vi.fn(), input: vi.fn(), output: vi.fn() });

it("cleans up a failed connection before allowing a retry", async () => {
  sdk.connect.mockRejectedValue(new Error("signalling failed"));
  await expect(connect({ url: "http://127.0.0.1:1", token: "test" }, callbacks())).rejects.toThrow(
    "signalling failed",
  );
  expect(sdk.disconnect).toHaveBeenCalledOnce();
});

it("selects an explicit speaker and applies it before playing a later remote track", async () => {
  const link = await connect({ url: "http://127.0.0.1:1", token: "test" }, callbacks());
  await link.changeSpeaker("headset");
  sdk.options.callbacks.onTrackStarted({ kind: "audio" }, { local: false });
  await vi.waitFor(() => expect(audio.play).toHaveBeenCalledOnce());
  expect(audio.setSinkId).toHaveBeenCalledWith("headset");
  expect(audio.setSinkId.mock.invocationCallOrder[0]).toBeLessThan(
    audio.play.mock.invocationCallOrder[0] ?? 0,
  );
  await link.disconnect();
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(audio.srcObject).toBeNull();
});

it("reports an unavailable speaker without silently switching outputs", async () => {
  const on = callbacks();
  const link = await connect({ url: "http://127.0.0.1:1", token: "test" }, on);
  sdk.options.callbacks.onTrackStarted({ kind: "audio" }, { local: false });
  await vi.waitFor(() => expect(audio.play).toHaveBeenCalledOnce());
  audio.setSinkId.mockRejectedValue(new Error("device gone"));
  await expect(link.changeSpeaker("missing")).rejects.toThrow("device gone");
  await link.disconnect();
});
