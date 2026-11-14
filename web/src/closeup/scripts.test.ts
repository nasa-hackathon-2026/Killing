import { describe, expect, it } from "vitest";
import type { MoleculeId } from "../chemistry/molecules";
import { closeUps } from "./closeUps";
import {
  amountFor,
  MAX_CLOSEUP_ATOMS,
  MAX_CLOSEUP_BLOBS,
  MAX_CLOSEUP_SOLIDS,
  relativeThermalSpeed,
  scripts,
  SOIL_PORES,
  type Painter,
  type ScriptInput,
} from "./scripts";
import { atomPositions } from "../chemistry/molecules";

function record(id: keyof typeof scripts, input: ScriptInput) {
  const drawn: MoleculeId[] = [];
  let atoms = 0;
  let solids = 0;
  let blobs = 0;
  let finite = true;
  const painter: Painter = {
    molecule(molecule, x, y, z, rotation, scale = 1) {
      if (![x, y, z, rotation, scale].every(Number.isFinite)) finite = false;
      if (scale <= 0.001) return;
      drawn.push(molecule);
      atoms += atomPositions(molecule).length;
    },
    solid(x, y, z, radius) {
      if (![x, y, z, radius].every(Number.isFinite)) finite = false;
      solids += 1;
    },
    blob(x, y, z, radius) {
      if (![x, y, z, radius].every(Number.isFinite)) finite = false;
      if (radius > 0.001) blobs += 1;
    },
  };
  scripts[id](input, painter);
  return { drawn, atoms, solids, blobs, finite };
}

describe("close-up scripts", () => {
  it("stay finite and within the instance limits at any time and value", () => {
    for (const view of closeUps) {
      for (const time of [0, 1.3, 7.7, 123.4]) {
        for (const value of [0, 0.5, 1, Number.NaN]) {
          const frame = record(view.id, { time, value, kelvin: 300 });
          expect(frame.finite).toBe(true);
          expect(frame.atoms).toBeLessThanOrEqual(MAX_CLOSEUP_ATOMS);
          expect(frame.solids).toBeLessThanOrEqual(MAX_CLOSEUP_SOLIDS);
          expect(frame.blobs).toBeLessThanOrEqual(MAX_CLOSEUP_BLOBS);
        }
      }
    }
  });

  it("only draws molecules the view lists, plus N2 as the third body M", () => {
    for (const view of closeUps) {
      const allowed = new Set<MoleculeId>([...view.molecules, "N2", "O2"]);
      for (const time of [0, 2, 4, 6, 8]) {
        for (const molecule of record(view.id, { time, value: 1, kelvin: 300 })
          .drawn) {
          expect(allowed.has(molecule)).toBe(true);
        }
      }
    }
  });

  it("conserves atoms across NO2 photolysis and ozone formation", () => {
    // One lane: NO2 + O2 (+ N2 as M) before, NO + O3 (+ N2) after.
    const oxygenAndNitrogen = (time: number) => {
      const frame = record("no2-photolysis", { time, value: 0, kelvin: null });
      return frame.atoms;
    };
    // 3 + 2 + 2 atoms at every stage of the cycle (period 9 s).
    for (const time of [1, 2.6, 4, 6, 7.5]) {
      expect(oxygenAndNitrogen(time)).toBe(7);
    }
  });

  it("shows more with a larger value", () => {
    expect(amountFor(0, 1, 4)).toBe(1);
    expect(amountFor(1, 1, 4)).toBe(4);
    expect(amountFor(Number.NaN, 2, 18)).toBe(2);
    const dry = record("soil-pores", { time: 0, value: 0, kelvin: null });
    const wet = record("soil-pores", { time: 0, value: 1, kelvin: null });
    expect(dry.blobs).toBe(0);
    expect(wet.blobs).toBe(SOIL_PORES);
    const few = record("water-evaporation", {
      time: 3,
      value: 0,
      kelvin: null,
    });
    const many = record("water-evaporation", {
      time: 3,
      value: 1,
      kelvin: null,
    });
    expect(many.drawn.length).toBeGreaterThan(few.drawn.length);
  });

  it("scales thermal speed with the square root of temperature and mass", () => {
    expect(relativeThermalSpeed(273.15, 28.014)).toBeCloseTo(1, 9);
    expect(relativeThermalSpeed(4 * 273.15, 28.014)).toBeCloseTo(2, 9);
    expect(relativeThermalSpeed(273.15, 31.998)).toBeCloseTo(
      Math.sqrt(28.014 / 31.998),
      9,
    );
    expect(relativeThermalSpeed(null, 28.014)).toBe(0);
  });
});
