import { afterEach, describe, expect, it } from "vitest";
import { registerMessages, setLocale } from "../../i18n";
import translatedCalm from "../../i18n/locales/zh-TW/calm.json";
import { calmText, fillCalmText } from "./calmText";
import {
  DEFAULT_PARTICLE_STYLE,
  parseParticleStyle,
  resolveParticleStyle,
} from "./particleStyle";

afterEach(() => setLocale("en"));

describe("particle style", () => {
  it("defaults to calm", () => {
    expect(DEFAULT_PARTICLE_STYLE).toBe("calm");
    expect(resolveParticleStyle(null, null)).toBe("calm");
  });

  it("reads calm and lively only", () => {
    expect(parseParticleStyle("calm")).toBe("calm");
    expect(parseParticleStyle("lively")).toBe("lively");
    expect(parseParticleStyle("Calm")).toBeNull();
    expect(parseParticleStyle(null)).toBeNull();
  });

  it("prefers the link, then the stored choice, then the default", () => {
    expect(resolveParticleStyle("calm", "lively")).toBe("calm");
    expect(resolveParticleStyle(null, "calm")).toBe("calm");
    expect(resolveParticleStyle("nonsense", "calm")).toBe("calm");
    expect(resolveParticleStyle(null, null)).toBe(DEFAULT_PARTICLE_STYLE);
    // A reader who picked Lively before keeps it.
    expect(resolveParticleStyle(null, "lively")).toBe("lively");
    expect(resolveParticleStyle("lively", null)).toBe("lively");
    expect(resolveParticleStyle(null, "nonsense")).toBe(DEFAULT_PARTICLE_STYLE);
  });
});

describe("fillCalmText", () => {
  it("updates the style labels and notes after a language change", () => {
    registerMessages("zh-TW", { calm: translatedCalm });
    setLocale("zh-TW");
    expect(calmText.styleCalm).toBe("平靜");
    expect(
      fillCalmText(calmText.noteOneLayer, {
        place: "臺中",
        layer: "降水",
        when: "，2025 年 6 月",
      }),
    ).toContain("臺中 上方這群粒子代表一個數值：降水，2025 年 6 月");
    setLocale("en");
    expect(calmText.styleCalm).toBe("Calm");
  });
  it("fills the named slots", () => {
    expect(
      fillCalmText(calmText.noteOneLayer, {
        place: "Taichung",
        layer: "Precipitation",
        when: ", Jun 2025",
      }),
    ).toBe(
      "The cluster above Taichung is one value: Precipitation, Jun 2025. The thin ring is what is usual for this calendar month. It is not a map.",
    );
  });
});
