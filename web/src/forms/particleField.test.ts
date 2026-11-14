import { describe, expect, it } from "vitest";
import { formMapping } from "./formMapping";
import {
  layerParticleCap,
  MAX_FORM_PARTICLES,
  MIN_COUNT_FRACTION,
  motionSpeed,
  particleCount,
  sharedShellOpacity,
  TOTAL_PARTICLE_BUDGET,
} from "./particleField";

describe("particle field", () => {
  it("is full at 1 and faster with a higher value", () => {
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

  it("keeps a few particles at the series minimum but none without data", () => {
    expect(particleCount(0, 300)).toBe(Math.ceil(300 * MIN_COUNT_FRACTION));
    expect(particleCount(0, 300)).toBeGreaterThan(0);
    expect(particleCount(0, 300, false)).toBe(0);
    expect(particleCount(1, 300, false)).toBe(0);
    expect(particleCount(Number.NaN, 300)).toBe(0);
    expect(particleCount(0.5, 300)).toBe(150);
    expect(particleCount(0.5, 0)).toBe(0);
  });
});

describe("layerParticleCap", () => {
  it("leaves a single layer at its own maximum", () => {
    for (const row of formMapping) {
      expect(layerParticleCap(row.encoding.maxCount, 1)).toBe(
        row.encoding.maxCount,
      );
    }
    expect(layerParticleCap(9999, 1)).toBe(MAX_FORM_PARTICLES);
    expect(layerParticleCap(300, 0)).toBe(300);
  });

  it("splits the budget between the open layers", () => {
    expect(layerParticleCap(480, 6)).toBe(240);
    expect(layerParticleCap(300, 6)).toBe(240);
    expect(layerParticleCap(480, 12)).toBe(120);
  });

  it("never lets the open layers exceed the total budget", () => {
    const counts = formMapping.map((row) => row.encoding.maxCount);
    for (let open = 1; open <= counts.length; open += 1) {
      const largest = [...counts].sort((a, b) => b - a).slice(0, open);
      const total = largest.reduce(
        (sum, maxCount) => sum + layerParticleCap(maxCount, open),
        0,
      );
      expect(total).toBeLessThanOrEqual(TOTAL_PARTICLE_BUDGET);
    }
  });
});

describe("sharedShellOpacity", () => {
  it("is unchanged for one layer and thinner for more", () => {
    expect(sharedShellOpacity(0.3, 1)).toBeCloseTo(0.3);
    expect(sharedShellOpacity(0.3, 6)).toBeLessThan(0.1);
  });

  it("stacks to about the opacity of a single shell", () => {
    const each = sharedShellOpacity(0.3, 6);
    expect(1 - Math.pow(1 - each, 6)).toBeCloseTo(0.3);
  });
});
