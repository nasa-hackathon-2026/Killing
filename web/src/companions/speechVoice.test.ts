import { describe, expect, it } from "vitest";
import {
  chooseVoice,
  voiceForLocale,
  type VoiceCandidate,
} from "./speechVoice";

const VOICES: VoiceCandidate[] = [
  { name: "Chinese (Mandarin)", lang: "zh-TW" },
  { name: "eSpeak English", lang: "en-US" },
  { name: "Google US English", lang: "en-US" },
  { name: "Google UK English Female", lang: "en-GB" },
  { name: "Samantha", lang: "en-US" },
  { name: "Whisper", lang: "en-US" },
  { name: "Google 國語（台灣）", lang: "zh-TW" },
  { name: "Google 普通话（中国大陆）", lang: "zh-CN" },
  { name: "Google 日本語", lang: "ja-JP" },
  { name: "Google Deutsch", lang: "de-DE" },
  { name: "Google français", lang: "fr-FR" },
  { name: "Microsoft Aria Online (Natural)", lang: "en-US" },
];

describe("chooseVoice", () => {
  it("reads English with an English voice, and prefers a natural one", () => {
    expect(chooseVoice(VOICES, "en")?.name).toBe(
      "Microsoft Aria Online (Natural)",
    );
  });

  it("prefers voice quality over a regional match within the same language", () => {
    expect(
      chooseVoice(
        [
          { name: "Standard English", lang: "en-US" },
          { name: "Neural English", lang: "en-GB" },
        ],
        "en",
      )?.name,
    ).toBe("Neural English");
  });

  it("does not use a Chinese voice when the only human English voice is British", () => {
    const voices = VOICES.filter(
      (voice) => voice.name !== "Microsoft Aria Online (Natural)",
    );
    expect(chooseVoice(voices, "en")?.name).toBe("Google US English");
  });

  it("stays silent rather than using a robotic English voice", () => {
    expect(
      chooseVoice(
        [
          { name: "Google 國語（台灣）", lang: "zh-TW" },
          { name: "eSpeak English", lang: "en-US" },
        ],
        "en",
      ),
    ).toBeNull();
  });

  it("prefers Google English over eSpeak and a pitched novelty voice", () => {
    expect(
      chooseVoice(
        [
          { name: "Whisper", lang: "en-US" },
          { name: "eSpeak NG", lang: "en-US" },
          { name: "Google US English", lang: "en-US" },
        ],
        "en",
      )?.name,
    ).toBe("Google US English");
  });

  it("uses a Taiwan voice for Traditional Chinese, ahead of mainland Mandarin", () => {
    expect(chooseVoice(VOICES, "zh-TW")?.name).toBe("Google 國語（台灣）");
    expect(
      chooseVoice(
        [{ name: "Google 普通话（中国大陆）", lang: "zh-CN" }],
        "zh-TW",
      )?.lang,
    ).toBe("zh-CN");
  });

  it("picks Japanese, German and French voices for those languages", () => {
    expect(chooseVoice(VOICES, "ja")?.lang).toBe("ja-JP");
    expect(chooseVoice(VOICES, "de")?.lang).toBe("de-DE");
    expect(chooseVoice(VOICES, "fr")?.lang).toBe("fr-FR");
  });

  it("returns null when the browser has no voice for that language", () => {
    expect(
      chooseVoice([{ name: "Google US English", lang: "en-US" }], "ja"),
    ).toBe(null);
    expect(chooseVoice([], "en")).toBeNull();
  });
});

describe("voiceForLocale", () => {
  it("stays silent when the requested language is not installed", () => {
    expect(
      voiceForLocale([{ name: "Google US English", lang: "en-US" }], "ja"),
    ).toBeNull();
  });

  it("does not replace a voice that matches the language", () => {
    expect(
      voiceForLocale(
        [
          { name: "Google US English", lang: "en-US" },
          { name: "Google 國語（台灣）", lang: "zh-TW" },
        ],
        "zh-TW",
      )?.voice.name,
    ).toBe("Google 國語（台灣）");
  });

  it("uses the selected voice's own regional language tag", () => {
    expect(
      voiceForLocale([{ name: "Neural English", lang: "en-GB" }], "en"),
    ).toEqual({
      voice: { name: "Neural English", lang: "en-GB" },
      lang: "en-GB",
    });
  });
});
