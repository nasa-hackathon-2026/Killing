import { describe, expect, it } from "vitest";
import { encodeForm } from "../forms/encoding";
import { formMapping, formSpec } from "../forms/formMapping";
import type { MotionKind } from "../forms/motions";
import {
  layerParticleCap,
  TOTAL_PARTICLE_BUDGET,
} from "../forms/particleField";
import { layoutStrata, particleRange } from "./strataLayout";
import {
  createSlabParticle,
  slabParticleState,
  slabSamples,
  type SlabBox,
} from "./strataMotion";
import { strataAssignments } from "./strataSpec";

const motions: MotionKind[] = [
  "fall",
  "rise",
  "orbit",
  "jitter",
  "seep",
  "sway",
  "tumble",
];

describe("slabSamples", () => {
  it("is repeatable and stays in range", () => {
    const a = slabSamples(7, 100);
    const b = slabSamples(7, 100);
    expect(a.u).toEqual(b.u);
    expect(slabSamples(8, 100).u).not.toEqual(a.u);
    for (let index = 0; index < 100; index += 1) {
      expect(Math.abs(a.u[index])).toBeLessThanOrEqual(1);
      expect(Math.abs(a.v[index])).toBeLessThanOrEqual(1);
      expect(a.phases[index]).toBeGreaterThanOrEqual(0);
      expect(a.phases[index]).toBeLessThan(1);
    }
  });
});

describe("slabParticleState", () => {
  const box: SlabBox = { halfWidth: 1.3, halfDepth: 0.65, from: 2, to: 2.55 };
  const samples = slabSamples(42, 60);
  const state = createSlabParticle();

  it("keeps every motion inside the box at all times", () => {
    for (const motion of motions) {
      for (let index = 0; index < 60; index += 1) {
        for (const time of [0, 0.37, 5.1, 123.4]) {
          slabParticleState(
            motion,
            samples.u[index],
            samples.v[index],
            samples.phases[index],
            time,
            box,
            0,
            state,
          );
          expect(Math.abs(state.x), motion).toBeLessThanOrEqual(box.halfWidth);
          expect(Math.abs(state.z), motion).toBeLessThanOrEqual(box.halfDepth);
          expect(state.y, motion).toBeGreaterThanOrEqual(2 - 1e-9);
          expect(state.y, motion).toBeLessThanOrEqual(2.55 + 1e-9);
          expect(state.scale).toBeGreaterThan(0);
        }
      }
    }
  });

  it("moves a falling particle down and a rising one up", () => {
    const down: SlabBox = { ...box, from: 3, to: -1 };
    const up: SlabBox = { ...box, from: -1, to: 3 };
    // Phase 0: the particle is at the start of its path at time 0.
    const y = (motion: MotionKind, range: SlabBox, time: number) =>
      slabParticleState(motion, 0, 0, 0, time, range, 0, state).y;
    expect(y("fall", down, 0)).toBeCloseTo(3);
    expect(y("fall", down, 1)).toBeLessThan(y("fall", down, 0.5));
    expect(y("rise", up, 0)).toBeCloseTo(-1);
    expect(y("rise", up, 1)).toBeGreaterThan(y("rise", up, 0.5));
  });

  it("lays soil water and leaves flat near the platform", () => {
    for (const motion of ["seep", "sway"] as const) {
      slabParticleState(motion, 0.3, -0.2, 0.4, 2, box, 0, state);
      expect(state.flat).toBe(true);
      expect(state.y).toBeLessThan(2 + 0.2 * 0.55);
    }
  });

  it("does not move in time when time does not advance (reduced motion)", () => {
    const first = {
      ...slabParticleState("orbit", 0.1, 0.2, 0.3, 4, box, 0, state),
    };
    const second = slabParticleState("orbit", 0.1, 0.2, 0.3, 4, box, 0, state);
    expect(second).toEqual(first);
  });
});

describe("particle budget in the layer view", () => {
  it("never draws more than the shared budget, whatever is switched on", () => {
    for (let open = 1; open <= formMapping.length; open += 1) {
      const rows = formMapping.slice(0, open);
      const total = rows.reduce((sum, row) => {
        const cap = layerParticleCap(row.encoding.maxCount, open);
        return sum + encodeForm(1, row.encoding, { cap }).count;
      }, 0);
      expect(total, `${open} layers`).toBeLessThanOrEqual(
        TOTAL_PARTICLE_BUDGET,
      );
    }
  });

  it("gives every assigned variable a form row and a range in the stack", () => {
    const boxes = layoutStrata(1);
    for (const row of strataAssignments) {
      expect(formSpec(row.variableId), row.variableId).toBeDefined();
      expect(particleRange(row, boxes), row.variableId).not.toBeNull();
    }
  });
});
