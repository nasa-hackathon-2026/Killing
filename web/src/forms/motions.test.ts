import { describe, expect, it } from "vitest";
import { createParticleState, particleState, type MotionKind } from "./motions";

const band: [number, number] = [1.1, 1.3];
const kinds: MotionKind[] = [
  "fall",
  "rise",
  "orbit",
  "jitter",
  "seep",
  "sway",
  "tumble",
];

function radiusOf(kind: MotionKind, time: number, phase = 0.3) {
  const state = particleState(
    kind,
    0.6,
    0,
    0.8,
    phase,
    time,
    band,
    createParticleState(),
  );
  return Math.hypot(state.x, state.y, state.z);
}

describe("particleState", () => {
  it("keeps every motion near its band", () => {
    for (const kind of kinds) {
      for (const time of [0, 0.7, 3.1, 40]) {
        const radius = radiusOf(kind, time);
        expect(radius).toBeGreaterThan(band[0] - 0.03);
        expect(radius).toBeLessThan(band[1] + 0.03);
      }
    }
  });

  it("moves rising particles outward and falling ones inward", () => {
    expect(radiusOf("rise", 1, 0)).toBeGreaterThan(radiusOf("rise", 0.5, 0));
    expect(radiusOf("fall", 1, 0)).toBeLessThan(radiusOf("fall", 0.5, 0));
  });

  it("holds surface forms in place and orients them to the ground", () => {
    for (const kind of ["seep", "sway"] as MotionKind[]) {
      const state = createParticleState();
      particleState(kind, 0.6, 0, 0.8, 0.3, 0, band, state);
      const first = [state.x, state.y, state.z];
      particleState(kind, 0.6, 0, 0.8, 0.3, 9, band, state);
      expect([state.x, state.y, state.z]).toEqual(first);
      expect(state.radial).toBe(true);
    }
  });

  it("gives the same answer for the same input", () => {
    const a = particleState(
      "tumble",
      0.6,
      0,
      0.8,
      0.42,
      5,
      band,
      createParticleState(),
    );
    const b = particleState(
      "tumble",
      0.6,
      0,
      0.8,
      0.42,
      5,
      band,
      createParticleState(),
    );
    expect(a).toEqual(b);
  });
});
