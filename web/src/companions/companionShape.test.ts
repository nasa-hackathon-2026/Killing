import { describe, expect, it } from "vitest";
import {
  anomalyTint,
  bodyOutline,
  closedSmoothPath,
  detailCount,
  GROUND_Y,
  HOVER_GAP,
  mixHex,
  OUTLINE_POINTS,
  scatter,
} from "./companionShape";
import { COMPANIONS } from "./companionSpec";

describe("body outline", () => {
  it("keeps the same number of points so outlines can be morphed", () => {
    for (const spec of COMPANIONS) {
      for (const mood of ["above", "near", "below"] as const) {
        const a = closedSmoothPath(bodyOutline(spec, mood, 0).points);
        const b = closedSmoothPath(bodyOutline(spec, mood, 1).points);
        expect(a.match(/C/g)?.length).toBe(OUTLINE_POINTS);
        expect(b.match(/C/g)?.length).toBe(OUTLINE_POINTS);
        expect(a).not.toContain("NaN");
      }
    }
  });

  it("is taller above usual and flatter below usual", () => {
    for (const spec of COMPANIONS) {
      const height = (mood: "above" | "near" | "below") => {
        const box = bodyOutline(spec, mood);
        return box.bottom - box.top;
      };
      expect(height("above")).toBeGreaterThan(height("near"));
      expect(height("below")).toBeLessThan(height("near"));
    }
  });

  it("stands on the ground or hovers above it", () => {
    const soil = COMPANIONS.find((item) => item.kind === "soil");
    const gas = COMPANIONS.find((item) => item.kind === "gas");
    expect(soil && bodyOutline(soil, "near").bottom).toBe(GROUND_Y);
    expect(gas && bodyOutline(gas, "near").bottom).toBe(GROUND_Y - HOVER_GAP);
  });
});

describe("colors and details", () => {
  it("mixes two colors", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("tints temperature from blue (colder) to red (warmer)", () => {
    expect(anomalyTint(-2, "#123456")).toBe("#2166ac");
    expect(anomalyTint(-9, "#123456")).toBe("#2166ac");
    expect(anomalyTint(0, "#123456")).toBe("#f7f7f7");
    expect(anomalyTint(2, "#123456")).toBe("#b2182b");
    expect(anomalyTint(null, "#123456")).toBe("#123456");
  });

  it("counts details across the range", () => {
    expect(detailCount(0, [1, 5])).toBe(1);
    expect(detailCount(1, [1, 5])).toBe(5);
    expect(detailCount(0.5, [1, 5])).toBe(3);
    expect(detailCount(Number.NaN, [1, 5])).toBe(1);
  });

  it("scatters repeatably inside 0..1", () => {
    const first = scatter(42, 30);
    expect(scatter(42, 30)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(first).size).toBeGreaterThan(20);
  });
});
