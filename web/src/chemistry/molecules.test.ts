import { describe, expect, it } from "vitest";
import {
  atomPositions,
  elements,
  molecules,
  rmsSpeed,
  type MoleculeId,
} from "./molecules";

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("molecules", () => {
  it("gives every molecule and element a source", () => {
    for (const molecule of Object.values(molecules)) {
      expect(molecule.source.length).toBeGreaterThan(10);
    }
    for (const element of Object.values(elements)) {
      expect(element.source.length).toBeGreaterThan(10);
    }
  });

  it("places atoms at the stated bond length and angle", () => {
    for (const id of ["H2O", "NO2", "O3", "CO2"] as MoleculeId[]) {
      const molecule = molecules[id];
      const [center, left, right] = atomPositions(id);
      if (!center || !left || !right) throw new Error("expected three atoms");
      expect(distance(center, left)).toBeCloseTo(molecule.bondLength ?? 0, 6);
      expect(distance(center, right)).toBeCloseTo(molecule.bondLength ?? 0, 6);
      const dot =
        (left.x - center.x) * (right.x - center.x) +
        (left.y - center.y) * (right.y - center.y);
      const angle =
        (Math.acos(dot / (molecule.bondLength ?? 1) ** 2) * 180) / Math.PI;
      expect(angle).toBeCloseTo(molecule.bondAngle ?? 0, 4);
    }
    const [a, b] = atomPositions("N2");
    if (!a || !b) throw new Error("expected two atoms");
    expect(distance(a, b)).toBeCloseTo(1.098, 6);
    expect(atomPositions("O")).toEqual([{ element: "O", x: 0, y: 0 }]);
  });

  it("computes the rms speed from sqrt(3RT/M)", () => {
    // N2 at 300 K: sqrt(3 * 8.314462618 * 300 / 0.028014) = 516.8 m/s.
    expect(rmsSpeed(300, 28.014)).toBeCloseTo(516.8, 0);
    expect(rmsSpeed(400, 28.014) / rmsSpeed(100, 28.014)).toBeCloseTo(2, 6);
    expect(rmsSpeed(0, 28.014)).toBe(0);
  });
});
