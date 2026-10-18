import { describe, expect, it } from "vitest";
import { readVoiceCommand } from "../src/voice.js";

describe("readVoiceCommand", () => {
  it.each([
    ["Dur", "tr"],
    ["Jarvis, dur!", "tr"],
    ["JARVİS iptal et", "tr"],
    ["vazgeç", "tr"],
    ["Jarvis'e söylüyorum: dur", null],
    ["stop", "en"],
    ["Jarvis, cancel it please", "en"],
    ["never mind", "en"],
  ])("reads a stop command in %j", (utterance, lang) => {
    const command = readVoiceCommand(utterance);
    if (lang === null) expect(command).toBeNull();
    else expect(command).toEqual({ kind: "cancel", lang });
  });

  it.each([
    ["ikincisi", 2, "tr"],
    ["Jarvis, ikincisini seç", 2, "tr"],
    ["ilkine tıkla lütfen", 1, "tr"],
    ["üçüncüsü", 3, "tr"],
    ["sonuncusu", "last", "tr"],
    ["iki", 2, "tr"],
    ["the second one", 2, "en"],
    ["number one", 1, "en"],
    ["option 3", 3, null],
    ["3rd", 3, null],
    ["#2", 2, null],
    ["last one", "last", "en"],
  ])("reads the choice in %j", (utterance, index, lang) => {
    expect(readVoiceCommand(utterance)).toEqual({ kind: "choose", index, lang });
  });

  it.each([
    "ikinci sayfayı aç",
    "bir dakika",
    "son haberleri göster",
    "Spotify'ı aç",
    "durdur şu müziği",
    "stop the music and open notepad",
    "",
    "Jarvis",
    "the second and the third",
  ])("leaves %j to the model", (utterance) => {
    expect(readVoiceCommand(utterance)).toBeNull();
  });
});
