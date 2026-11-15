import { describe, expect, it } from "vitest";
import {
  MIN_CYCLE_SHARE,
  SEASON_FLOOR,
  paintSeason,
  seasonFactor,
  seasonalCycle,
  valueAt,
} from "./seasonal";

// One cell, 12 months: 0, 1, …, 11.
const ramp = Array.from({ length: 12 }, (_, month) => Float32Array.of(month));

describe("valueAt", () => {
  it("is the monthly value on a month and blends between two", () => {
    expect(valueAt(ramp, 0, 3)).toBe(3);
    expect(valueAt(ramp, 0, 3.5)).toBeCloseTo(3.5);
  });

  it("runs December into January", () => {
    expect(valueAt(ramp, 0, 11.5)).toBeCloseTo(5.5);
    expect(valueAt(ramp, 0, 12)).toBe(0);
    expect(valueAt(ramp, 0, -1)).toBe(11);
  });
});

describe("seasonalCycle and seasonFactor", () => {
  it("is 1 at the cell's highest month and SEASON_FLOOR at its lowest", () => {
    const cycle = seasonalCycle(ramp, 0);
    const at = (value: number) =>
      seasonFactor(value, cycle.mean[0] ?? 0, cycle.scale[0] ?? 1);
    expect(at(11)).toBeCloseTo(1);
    expect(at(0)).toBeCloseTo(SEASON_FLOOR);
    expect(at(5.5)).toBeCloseTo((1 + SEASON_FLOOR) / 2);
  });

  it("does not stretch noise in a cell with almost no cycle", () => {
    const flat = Array.from({ length: 12 }, (_, month) =>
      Float32Array.of(10 + (month % 2) * 0.01),
    );
    const cycle = seasonalCycle(flat, 100);
    expect(cycle.scale[0]).toBeCloseTo(100 * MIN_CYCLE_SHARE);
    const factor = seasonFactor(10.01, cycle.mean[0] ?? 0, cycle.scale[0] ?? 1);
    expect(factor).toBeGreaterThan(0.6);
    expect(factor).toBeLessThan(0.7);
  });

  it("leaves a cell with a missing month undimmed", () => {
    const gap = ramp.map((layer, month) =>
      month === 4 ? Float32Array.of(Number.NaN) : layer,
    );
    const cycle = seasonalCycle(gap, 1);
    expect(Number.isNaN(cycle.mean[0])).toBe(true);
    expect(seasonFactor(3, cycle.mean[0] ?? 0, cycle.scale[0] ?? 1)).toBe(1);
  });
});

describe("paintSeason", () => {
  it("keeps the colours, scales alpha and keeps empty cells empty", () => {
    const months = ramp.map((layer) =>
      Float32Array.of(layer[0] ?? 0, layer[0] ?? 0),
    );
    const cycle = seasonalCycle(months, 0);
    const base = Uint8Array.of(10, 20, 30, 200, 1, 2, 3, 0);
    const out = new Uint8Array(8);
    paintSeason(base, out, months, cycle, 11);
    expect(Array.from(out.subarray(0, 3))).toEqual([10, 20, 30]);
    expect(out[3]).toBe(200);
    expect(out[7]).toBe(0);
    paintSeason(base, out, months, cycle, 0);
    expect(out[3]).toBe(Math.round(200 * SEASON_FLOOR));
  });
});
