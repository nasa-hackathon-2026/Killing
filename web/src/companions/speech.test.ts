import { afterEach, describe, expect, it, vi } from "vitest";
import { speak, stopSpeaking } from "./speech";

type Heard = {
  text: string;
  lang: string;
  pitch: number;
  rate: number;
  voiceName: string | null;
};

function install(
  voices: { name: string; lang: string }[],
  options: { speaking?: boolean; defer?: boolean } = {},
) {
  const heard: Heard[] = [];
  const queued: (() => void)[] = [];
  class Utterance {
    text: string;
    lang = "";
    pitch = 1;
    rate = 1;
    voice: { name: string; lang: string } | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    speaking: options.speaking ?? false,
    pending: false,
    cancel: vi.fn(() => {
      synth.speaking = false;
    }),
    speak(utterance: Utterance) {
      heard.push({
        text: utterance.text,
        lang: utterance.lang,
        pitch: utterance.pitch,
        rate: utterance.rate,
        voiceName: utterance.voice?.name ?? null,
      });
    },
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: Utterance,
    setTimeout: (fn: () => void) => {
      if (options.defer) queued.push(fn);
      else fn();
      return 0;
    },
  });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  return {
    heard,
    synth,
    flush() {
      for (const fn of queued.splice(0)) fn();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speak", () => {
  const voices = [
    { name: "Chinese (Mandarin)", lang: "zh-TW" },
    { name: "eSpeak English", lang: "en-US" },
    { name: "Google US English", lang: "en-US" },
  ];

  it("reads English at a natural pitch with an English voice", () => {
    const { heard } = install(voices);
    speak("  June was 28.0 degrees Celsius.  ", "en");
    expect(heard).toEqual([
      {
        text: "June was 28.0 degrees Celsius.",
        lang: "en-US",
        pitch: 1,
        rate: 1,
        voiceName: "Google US English",
      },
    ]);
  });

  it("uses the voice of the requested language", () => {
    const { heard } = install([
      ...voices,
      { name: "Google 日本語", lang: "ja-JP" },
      { name: "Google Deutsch", lang: "de-DE" },
    ]);
    speak("気温", "ja");
    speak("Temperatur", "de");
    expect(heard.map((item) => [item.lang, item.voiceName])).toEqual([
      ["ja-JP", "Google 日本語"],
      ["de-DE", "Google Deutsch"],
    ]);
  });

  it("stays silent instead of reading a different language", () => {
    const { heard } = install(voices);
    speak("Bonjour", "fr");
    expect(heard).toEqual([]);
  });

  it("stays silent when only another language's voice is installed", () => {
    const { heard } = install([{ name: "Google 國語（台灣）", lang: "zh-TW" }]);
    speak("Bonjour", "fr");
    expect(heard).toEqual([]);
  });

  it("says nothing for a blank line", () => {
    const { heard } = install(voices);
    speak("   ", "en");
    expect(heard).toEqual([]);
  });

  it("does not start a voice that was cancelled while waiting", () => {
    const browser = install(voices, { speaking: true, defer: true });
    speak("first", "en");
    stopSpeaking();
    browser.flush();
    expect(browser.heard).toEqual([]);
    expect(browser.synth.cancel).toHaveBeenCalled();
  });
});
