import { describe, expect, it } from "vitest";
import {
  MAX_FORM_PARTICLES,
  motionSpeed,
  particleCount,
} from "./particleField";

describe("particle field", () => {
  it("is empty at 0 and full at 1", () => {
    expect(particleCount(0)).toBe(0);
    expect(particleCount(1)).toBe(MAX_FORM_PARTICLES);
    expect(motionSpeed(0)).toBeLessThan(motionSpeed(1));
  });

  it("increases as the value increases", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1];
    const counts = samples.map((value) => particleCount(value));
    const speeds = samples.map((value) => motionSpeed(value));
    for (let index = 1; index < samples.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
      expect(speeds[index]).toBeGreaterThan(speeds[index - 1]);
    }
  });
});
