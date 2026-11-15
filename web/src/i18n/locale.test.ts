import { describe, expect, it } from "vitest";
import {
  resolveSpeechLocale,
  speechLangTag,
  type SpeechLocale,
} from "./locale";

describe("resolveSpeechLocale", () => {
  it("uses the address, then the saved choice, then English", () => {
    expect(resolveSpeechLocale("?lang=ja", "de")).toBe("ja");
    expect(resolveSpeechLocale("", "fr")).toBe("fr");
    expect(resolveSpeechLocale("?layers=imerg_precip", null)).toBe("en");
  });

  it("accepts the five languages and their regional tags", () => {
    const cases: [string, SpeechLocale][] = [
      ["?lang=en", "en"],
      ["?lang=en-GB", "en"],
      ["?lang=zh-TW", "zh-TW"],
      ["?lang=zh_TW", "zh-TW"],
      ["?lang=zh-Hant", "zh-TW"],
      ["?lang=ja-JP", "ja"],
      ["?lang=de-DE", "de"],
      ["?lang=fr-CA", "fr"],
    ];
    for (const [search, locale] of cases) {
      expect(resolveSpeechLocale(search, "en")).toBe(locale);
    }
  });

  it("does not treat Simplified Chinese as Traditional Chinese", () => {
    expect(resolveSpeechLocale("?lang=zh-CN", "ja")).toBe("ja");
    expect(resolveSpeechLocale("?lang=zh-Hans", null)).toBe("en");
  });

  it("ignores an unknown language code", () => {
    expect(resolveSpeechLocale("?lang=es", "de")).toBe("de");
    expect(resolveSpeechLocale("?lang=", "en")).toBe("en");
  });
});

describe("speechLangTag", () => {
  it("names the preferred voice language of each interface language", () => {
    expect(speechLangTag("en")).toBe("en-US");
    expect(speechLangTag("zh-TW")).toBe("zh-TW");
    expect(speechLangTag("ja")).toBe("ja-JP");
    expect(speechLangTag("de")).toBe("de-DE");
    expect(speechLangTag("fr")).toBe("fr-FR");
  });
});
