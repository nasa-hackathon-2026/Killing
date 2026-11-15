import { describe, expect, it } from "vitest";
import { TAIWAN_DETAIL } from "./detailCoverage";
import { detailEdgeAlpha, detailFadeMask } from "./detailFade";

const { south, north, west, east } = TAIWAN_DETAIL;

describe("the fade at the edge of the Taiwan close-up", () => {
  it("is fully transparent on the patch's border", () => {
    expect(detailEdgeAlpha(south, 120)).toBe(0);
    expect(detailEdgeAlpha(north, 120)).toBe(0);
    expect(detailEdgeAlpha(23.5, west)).toBe(0);
    expect(detailEdgeAlpha(23.5, east)).toBe(0);
  });

  it("is fully opaque over the main island of Taiwan", () => {
    // Corners of a box around the island: 21.9–25.3° N, 120.0–122.0° E.
    for (const lat of [21.9, 23.5, 25.3]) {
      for (const lon of [120.0, 121.0, 122.0]) {
        expect(detailEdgeAlpha(lat, lon)).toBe(1);
      }
    }
  });

  it("rises from the border inward", () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) =>
      detailEdgeAlpha(23.5, west + t),
    );
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1] ?? 1);
    }
  });

  it("is written as an RGBA mask with the opaque middle and transparent rim", () => {
    const size = 64;
    const mask = detailFadeMask(size);
    expect(mask.length).toBe(size * size * 4);
    const green = (row: number, column: number) =>
      mask[(row * size + column) * 4 + 1];
    expect(green(0, 0)).toBeLessThan(5);
    expect(green(size / 2, size / 2)).toBe(255);
  });
});
