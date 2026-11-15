import { describe, expect, it } from "vitest";
import { latLonToVector3, vectorToLatLon } from "./latLon";

function closeTo(actual: number, expected: number) {
  expect(actual).toBeCloseTo(expected, 6);
}

describe("latLonToVector3", () => {
  it("puts the north pole on +Y", () => {
    const point = latLonToVector3(90, 0);
    closeTo(point.x, 0);
    closeTo(point.y, 1);
    closeTo(point.z, 0);
  });

  it("puts the south pole on -Y", () => {
    const point = latLonToVector3(-90, 45);
    closeTo(point.x, 0);
    closeTo(point.y, -1);
    closeTo(point.z, 0);
  });

  it("puts the equator at longitude 0 on +X", () => {
    const point = latLonToVector3(0, 0, 2);
    closeTo(point.x, 2);
    closeTo(point.y, 0);
    closeTo(point.z, 0);
  });

  it("puts the equator at longitude 90 on -Z", () => {
    const point = latLonToVector3(0, 90);
    closeTo(point.x, 0);
    closeTo(point.y, 0);
    closeTo(point.z, -1);
  });

  it("round-trips a city through the camera direction", () => {
    for (const [lat, lon] of [
      [51.51, -0.13],
      [-33.87, 151.21],
      [35.68, 139.69],
    ] as const) {
      const point = latLonToVector3(lat, lon, 1.4);
      const back = vectorToLatLon(point.x, point.y, point.z);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it("places Taichung in the northern, eastern quadrant", () => {
    const point = latLonToVector3(24.15, 120.68);
    expect(point.y).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(0);
    expect(point.z).toBeLessThan(0);
    const length = Math.hypot(point.x, point.y, point.z);
    closeTo(length, 1);
  });
});
