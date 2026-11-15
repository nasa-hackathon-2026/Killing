import { afterEach, describe, expect, it } from "vitest";
import { registerMessages, setLocale } from "../../i18n";
import translatedCalm from "../../i18n/locales/zh-TW/calm.json";
import { calmText } from "./calmText";
import {
  DEFAULT_PARTICLE_STYLE,
  parseParticleStyle,
  resolveParticleStyle,
} from "./particleStyle";

afterEach(() => setLocale("en"));

describe("particle style", () => {
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
    expect(resolveParticleStyle(null, "nonsense")).toBe(DEFAULT_PARTICLE_STYLE);
  });
});

describe("calmText", () => {
  it("updates the style labels after a language change", () => {
    registerMessages("zh-TW", { calm: translatedCalm });
    setLocale("zh-TW");
    expect(calmText.styleCalm).toBe("平靜");
    setLocale("en");
    expect(calmText.styleCalm).toBe("Calm");
  });
});
