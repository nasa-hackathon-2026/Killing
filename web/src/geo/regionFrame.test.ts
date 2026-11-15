import { describe, expect, it } from "vitest";
import {
  bboxCenter,
  bboxFrameVertices,
  formatBbox,
  isBbox,
  REGION_MAX_DISTANCE,
  REGION_MIN_DISTANCE,
  regionFrameDistance,
  type Bbox,
} from "./regionFrame";

const taiwan: Bbox = [120.0, 21.8, 122.1, 25.4];
const north: Bbox = [121.0, 24.6, 122.1, 25.4];

describe("bboxCenter", () => {
  it("is the middle of the box", () => {
    const center = bboxCenter(taiwan);
    expect(center.lat).toBeCloseTo(23.6, 6);
    expect(center.lon).toBeCloseTo(121.05, 6);
  });

  it("handles a box over the antimeridian", () => {
    expect(bboxCenter([170, -10, -170, 10])).toEqual({ lat: 0, lon: 180 });
  });
});

describe("bboxFrameVertices", () => {
  it("goes around the box, every edge cut into steps", () => {
    const vertices = bboxFrameVertices(north, 4);
    expect(vertices).toHaveLength(16);
    expect(vertices[0]).toEqual({ lat: 24.6, lon: 121.0 });
    // Corners: south-east, north-east, north-west.
    expect(vertices[4]).toEqual({ lat: 24.6, lon: 122.1 });
    expect(vertices[8]).toEqual({ lat: 25.4, lon: 122.1 });
    expect(vertices[12]).toEqual({ lat: 25.4, lon: 121.0 });
  });

  it("stays inside the box", () => {
    for (const vertex of bboxFrameVertices(taiwan)) {
      expect(vertex.lat).toBeGreaterThanOrEqual(21.8 - 1e-9);
      expect(vertex.lat).toBeLessThanOrEqual(25.4 + 1e-9);
      expect(vertex.lon).toBeGreaterThanOrEqual(120.0 - 1e-9);
      expect(vertex.lon).toBeLessThanOrEqual(122.1 + 1e-9);
    }
  });
});

describe("regionFrameDistance", () => {
  it("is within the clamp and larger for a larger box", () => {
    const small = regionFrameDistance(north);
    const whole = regionFrameDistance(taiwan);
    expect(small).toBeGreaterThanOrEqual(REGION_MIN_DISTANCE);
    expect(whole).toBeLessThanOrEqual(REGION_MAX_DISTANCE);
    expect(whole).toBeGreaterThanOrEqual(small);
    expect(regionFrameDistance([0, -60, 90, 60])).toBe(REGION_MAX_DISTANCE);
  });

  it("is larger on a narrow window", () => {
    const wide = regionFrameDistance([100, -1, 106, 1], 1.8);
    const narrow = regionFrameDistance([100, -1, 106, 1], 0.5);
    expect(narrow).toBeGreaterThan(wide);
  });

  it("falls back for a bad aspect", () => {
    expect(regionFrameDistance(taiwan, Number.NaN)).toBe(
      regionFrameDistance(taiwan),
    );
  });
});

describe("formatBbox and isBbox", () => {
  it("writes degrees with hemispheres", () => {
    expect(formatBbox(taiwan)).toBe("120.0–122.1°E, 21.8–25.4°N");
    expect(formatBbox([-10, -5, 20, 5])).toBe("10.0°W–20.0°E, 5.0°S–5.0°N");
  });

  it("accepts only four finite numbers with south below north", () => {
    expect(isBbox(taiwan)).toBe(true);
    expect(isBbox([1, 2, 3])).toBe(false);
    expect(isBbox([1, 5, 3, 2])).toBe(false);
    expect(isBbox(null)).toBe(false);
    expect(isBbox([1, "2", 3, 4])).toBe(false);
  });
});
