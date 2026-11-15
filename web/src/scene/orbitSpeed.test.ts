import { describe, expect, it } from "vitest";
import {
  BASE_ROTATE_SPEED,
  DEFAULT_ORBIT_DISTANCE,
  orbitRotateSpeed,
} from "./orbitSpeed";

describe("orbitRotateSpeed", () => {
  it("keeps the current speed at the default distance and farther", () => {
    expect(orbitRotateSpeed(DEFAULT_ORBIT_DISTANCE)).toBe(BASE_ROTATE_SPEED);
    expect(orbitRotateSpeed(6)).toBe(BASE_ROTATE_SPEED);
  });

  it("slows with the square of distance when closer than the default", () => {
    const nearRatio = 1.18 / DEFAULT_ORBIT_DISTANCE;
    const midRatio = 1.6 / DEFAULT_ORBIT_DISTANCE;
    expect(orbitRotateSpeed(1.18)).toBeCloseTo(nearRatio * nearRatio);
    expect(orbitRotateSpeed(1.6)).toBeCloseTo(midRatio * midRatio);
  });

  it("is slower than a linear scale at the same near distance", () => {
    const distance = 1.18;
    const linear = distance / DEFAULT_ORBIT_DISTANCE;
    expect(orbitRotateSpeed(distance)).toBeLessThan(linear);
  });

  it("changes continuously between the closest and default distances", () => {
    const near = orbitRotateSpeed(1.18);
    const mid = orbitRotateSpeed((1.18 + DEFAULT_ORBIT_DISTANCE) / 2);
    const far = orbitRotateSpeed(DEFAULT_ORBIT_DISTANCE);
    expect(mid).toBeGreaterThan(near);
    expect(mid).toBeLessThan(far);
  });

  it("stays at the base speed when the distance is unusable", () => {
    expect(orbitRotateSpeed(Number.NaN)).toBe(BASE_ROTATE_SPEED);
    expect(orbitRotateSpeed(Number.POSITIVE_INFINITY)).toBe(BASE_ROTATE_SPEED);
    expect(orbitRotateSpeed(-1)).toBe(BASE_ROTATE_SPEED);
  });
});
