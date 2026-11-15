import { describe, expect, it } from "vitest";
import { greatCircleArcPoints } from "./greatCircleArc";

function radius(point: { x: number; y: number; z: number }): number {
  return Math.hypot(point.x, point.y, point.z);
}

describe("great-circle globe arcs", () => {
  it("preserves endpoints, stays above the globe, and follows one great-circle plane", () => {
    const points = greatCircleArcPoints(12, -20, -8, 105, 24, 1.05);
    const first = points[0];
    const last = points.at(-1);

    expect(points).toHaveLength(25);
    expect(first?.x).toBeCloseTo(
      1.05 * Math.cos((12 * Math.PI) / 180) * Math.cos((20 * Math.PI) / 180),
    );
    expect(first?.y).toBeCloseTo(1.05 * Math.sin((12 * Math.PI) / 180));
    expect(last?.x).toBeCloseTo(
      1.05 * Math.cos((8 * Math.PI) / 180) * Math.cos((105 * Math.PI) / 180),
    );
    expect(last?.y).toBeCloseTo(-1.05 * Math.sin((8 * Math.PI) / 180));
    expect(points.every((point) => radius(point) >= 1)).toBe(true);

    const normal = {
      x: first!.y * last!.z - first!.z * last!.y,
      y: first!.z * last!.x - first!.x * last!.z,
      z: first!.x * last!.y - first!.y * last!.x,
    };
    expect(
      points.every(
        (point) =>
          Math.abs(
            point.x * normal.x + point.y * normal.y + point.z * normal.z,
          ) < 1e-8,
      ),
    ).toBe(true);
  });

  it("handles exactly antipodal endpoints with finite elevated points", () => {
    const points = greatCircleArcPoints(10, 20, -10, -160, 32, 1.06);

    expect(points).toHaveLength(33);
    expect(points[0]?.x).toBeCloseTo(
      1.06 * Math.cos((10 * Math.PI) / 180) * Math.cos((20 * Math.PI) / 180),
    );
    expect(points.at(-1)?.y).toBeCloseTo(
      -1.06 * Math.sin((10 * Math.PI) / 180),
    );
    expect(
      points.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          Number.isFinite(point.z) &&
          radius(point) >= 1,
      ),
    ).toBe(true);
  });
});
