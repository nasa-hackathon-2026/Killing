import { describe, expect, it } from "vitest";
import { TAIWAN_DETAIL } from "../geo/detailCoverage";
import { PLATFORM_DEPTH, PLATFORM_WIDTH } from "./strataLayout";
import { cropAround, surfaceImage } from "./surfaceCrop";

describe("cropAround", () => {
  const world = { south: -90, north: 90, west: -180, east: 180 };

  it("centers the window on the place", () => {
    const crop = cropAround(0, 0, 36, 18, world);
    expect(crop.repeat).toEqual([0.1, 0.1]);
    expect(crop.offset[0]).toBeCloseTo(0.45);
    expect(crop.offset[1]).toBeCloseTo(0.45);
  });

  it("moves the window inward at the edge of the image", () => {
    const crop = cropAround(89, 179, 36, 18, world);
    expect(crop.offset[0] + crop.repeat[0]).toBeCloseTo(1);
    expect(crop.offset[1] + crop.repeat[1]).toBeCloseTo(1);
    const other = cropAround(-89, -179, 36, 18, world);
    expect(other.offset).toEqual([0, 0]);
  });
});

describe("surfaceImage", () => {
  it("uses the closer Taiwan image for Taichung, with the place inside the window", () => {
    const image = surfaceImage(24.15, 120.68);
    expect(image.file).toBe("textures/taiwan-detail.png");
    const u =
      (120.68 - TAIWAN_DETAIL.west) / (TAIWAN_DETAIL.east - TAIWAN_DETAIL.west);
    const v =
      (24.15 - TAIWAN_DETAIL.south) /
      (TAIWAN_DETAIL.north - TAIWAN_DETAIL.south);
    expect(u).toBeGreaterThan(image.offset[0]);
    expect(u).toBeLessThan(image.offset[0] + image.repeat[0]);
    expect(v).toBeGreaterThan(image.offset[1]);
    expect(v).toBeLessThan(image.offset[1] + image.repeat[1]);
  });

  it("uses one city tile for London and Blue Marble away from every city", () => {
    const london = surfaceImage(51.51, -0.13);
    expect(london.tiles?.length).toBeGreaterThan(1);
    expect((london.frame?.west ?? 0) + (london.frame?.east ?? 0)).toBeCloseTo(
      -0.13 * 2,
    );
    expect(surfaceImage(48.85, 2.35).file).toBe("textures/blue-marble.jpg");
  });

  it("keeps the window's shape equal to the platform's", () => {
    for (const image of [
      surfaceImage(24.15, 120.68),
      surfaceImage(51.51, -0.13),
      surfaceImage(0, 0),
    ]) {
      expect(image.lonSpan / image.latSpan).toBeCloseTo(
        PLATFORM_WIDTH / PLATFORM_DEPTH,
      );
    }
  });
});
