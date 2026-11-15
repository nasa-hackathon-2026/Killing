import { describe, expect, it } from "vitest";
import { calmText, fillCalmText } from "./calmText";
import {
  DEFAULT_PARTICLE_STYLE,
  parseParticleStyle,
  resolveParticleStyle,
} from "./particleStyle";

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

describe("fillCalmText", () => {
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
