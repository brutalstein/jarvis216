import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Microphone } from "../apps/desktop/src/renderer/media.js";

const device = (id: string) => ({ deviceId: id, kind: "audioinput" });
function capture(id: string) {
  const track = { enabled: true, stop: vi.fn(), getSettings: () => ({ deviceId: id }) };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "AudioContext",
    class {
      close = vi.fn(async () => {});
      createAnalyser = () => ({
        fftSize: 256,
        getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
      });
      createMediaStreamSource = () => ({ connect: vi.fn() });
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("releases a capture that completes after disconnect instead of reviving the microphone", async () => {
  const stream = capture("late");
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((done) => {
          resolve = done;
        }),
      enumerateDevices: async () => [device("late")],
    },
  });
  const replace = vi.fn();
  const mic = new Microphone(replace);
  const changing = mic.updateMic("late");
  await mic.disconnect();
  resolve(stream);
  await changing;
  expect(stream.track.stop).toHaveBeenCalledOnce();
  expect(replace).not.toHaveBeenCalled();
  expect(mic.tracks().local.audio).toBeUndefined();
});

it("keeps the newest requested microphone when captures finish out of order", async () => {
  const first = capture("first");
  const latest = capture("latest");
  const waiting: ((value: unknown) => void)[] = [];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () => new Promise((done) => waiting.push(done)),
      enumerateDevices: async () => [device("first"), device("latest")],
    },
  });
  const replace = vi.fn(async () => {});
  const mic = new Microphone(replace);
  const firstChange = mic.updateMic("first");
  const lastChange = mic.updateMic("latest");
  waiting[1]?.(latest);
  await lastChange;
  waiting[0]?.(first);
  await firstChange;
  expect(mic.tracks().local.audio).toBe(latest.track);
  expect(first.track.stop).toHaveBeenCalledOnce();
  expect(latest.track.stop).not.toHaveBeenCalled();
  await mic.disconnect();
});

it("keeps the existing microphone when replacement fails", async () => {
  const original = capture("original");
  const bad = capture("bad");
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(bad),
      enumerateDevices: async () => [device("original"), device("bad")],
    },
  });
  const replace = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("replace failed"));
  const mic = new Microphone(replace);
  await mic.initialize();
  await expect(mic.updateMic("bad")).rejects.toThrow("replace failed");
  expect(mic.tracks().local.audio).toBe(original.track);
  expect(bad.track.stop).toHaveBeenCalledOnce();
  expect(original.track.stop).not.toHaveBeenCalled();
  await mic.disconnect();
});
