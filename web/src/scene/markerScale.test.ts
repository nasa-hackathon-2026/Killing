import { describe, expect, it } from "vitest";
import { markerScale } from "./markerScale";

describe("markerScale", () => {
  it("is 1 at the starting distance", () => {
    expect(markerScale(3.2)).toBeCloseTo(1);
  });

  it("gets smaller on screen as the camera comes closer, never to zero", () => {
    const onScreen = (distance: number) =>
      markerScale(distance) / (distance - 1);
    expect(onScreen(1.6)).toBeLessThan(onScreen(3.2));
    expect(onScreen(1.2)).toBeLessThan(onScreen(1.6));
    // The camera cannot come closer than 1.18 (EarthCanvas minDistance).
    expect(onScreen(1.18)).toBeLessThan(onScreen(1.3));
    expect(markerScale(1.001)).toBeGreaterThan(0.01);
  });
});
