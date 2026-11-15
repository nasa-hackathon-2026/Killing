import { describe, expect, it } from "vitest";
import { intensityAt, type SeriesPoint } from "../../snapshot/reading";
import {
  approach,
  CALM_GROUP_SIZE,
  CALM_MAX_UNITS,
  calmDriftSpeed,
  calmExtent,
  calmGrid,
  calmLayout,
  calmRadius,
  calmSlot,
  calmSplit,
  calmUnits,
  calmUnitValue,
  calmUsualRadius,
  calmViewScale,
  usualIntensity,
} from "./calmMath";

describe("calmUnits", () => {
  it("maps the series' own range to 1..25 units", () => {
    expect(calmUnits(0)).toBe(1);
    expect(calmUnits(0.5)).toBe(13);
    expect(calmUnits(1)).toBe(CALM_MAX_UNITS);
    expect(calmUnits(7)).toBe(CALM_MAX_UNITS);
    expect(calmUnits(-1)).toBe(1);
  });

  it("draws nothing for a month without data", () => {
    expect(calmUnits(0.7, false)).toBe(0);
    expect(calmUnits(Number.NaN)).toBe(0);
    expect(calmUnitValue(0.7, false)).toBe(0);
  });

  it("never draws more than 30 shapes for one layer", () => {
    for (let step = 0; step <= 100; step += 1) {
      expect(calmUnits(step / 100)).toBeLessThanOrEqual(30);
    }
  });
});

describe("calmSplit", () => {
  it("combines every five units into one big shape", () => {
    expect(calmSplit(0)).toEqual({ big: 0, small: 0 });
    expect(calmSplit(4)).toEqual({ big: 0, small: 4 });
    expect(calmSplit(5)).toEqual({ big: 1, small: 0 });
    expect(calmSplit(13)).toEqual({ big: 2, small: 3 });
    expect(calmSplit(25)).toEqual({ big: 5, small: 0 });
  });

  it("always adds back up to the unit count", () => {
    for (let units = 0; units <= CALM_MAX_UNITS; units += 1) {
      const { big, small } = calmSplit(units);
      expect(big * CALM_GROUP_SIZE + small).toBe(units);
      expect(small).toBeLessThan(CALM_GROUP_SIZE);
    }
  });
});

describe("calmLayout", () => {
  it("has one place per unit and one center per big shape", () => {
    for (let units = 0; units <= CALM_MAX_UNITS; units += 1) {
      const layout = calmLayout(units);
      expect(layout.units).toHaveLength(units);
      expect(layout.bigs).toHaveLength(calmSplit(units).big);
    }
  });

  it("keeps single units from overlapping each other", () => {
    for (let units = 1; units <= CALM_MAX_UNITS; units += 1) {
      const layout = calmLayout(units);
      const singles = layout.units.slice(calmSplit(units).big * 5);
      for (let i = 0; i < singles.length; i += 1) {
        for (let j = i + 1; j < singles.length; j += 1) {
          const a = singles[i] as { x: number; y: number };
          const b = singles[j] as { x: number; y: number };
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("fits every cluster inside its own disc", () => {
    for (let units = 1; units <= CALM_MAX_UNITS; units += 1) {
      expect(calmExtent(units)).toBeLessThanOrEqual(calmRadius(units) + 1e-6);
    }
  });

  it("is the same every time", () => {
    expect(calmLayout(17)).toEqual(calmLayout(17));
  });
});

describe("calmRadius", () => {
  it("grows with the value and its area follows the unit count", () => {
    expect(calmRadius(0)).toBe(0);
    expect(calmRadius(20) / calmRadius(5)).toBeCloseTo(2);
    expect(calmRadius(12)).toBeGreaterThan(calmRadius(11.5));
  });

  it("puts the usual ring on the same scale as the disc", () => {
    expect(calmUsualRadius(0.4)).toBeCloseTo(calmRadius(calmUnitValue(0.4)));
    expect(calmUsualRadius(null)).toBe(0);
    // A value above the usual one gives a disc larger than the ring.
    expect(calmRadius(calmUnitValue(0.6))).toBeGreaterThan(
      calmUsualRadius(0.4),
    );
    expect(calmRadius(calmUnitValue(0.2))).toBeLessThan(calmUsualRadius(0.4));
  });
});

function record(): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (let year = 2010; year < 2020; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      points.push({
        month: `${year}-${String(month).padStart(2, "0")}-01`,
        // A seasonal cycle plus a step from year to year.
        value: month * 10 + (year - 2010),
      });
    }
  }
  return points;
}

describe("usualIntensity", () => {
  it("is the calendar month's mean on the scale of intensityAt", () => {
    const points = record();
    // June: mean of 60..69 = 64.5; the record spans 10..129.
    expect(usualIntensity(points, "2015-06-01")).toBeCloseTo(
      (64.5 - 10) / (129 - 10),
    );
    // 2019 is the highest June, so its value sits above the usual one.
    expect(intensityAt(points, "2019-06-01")).toBeGreaterThan(
      usualIntensity(points, "2019-06-01") ?? 1,
    );
  });

  it("is still known for a month without a value", () => {
    const points = record().map((point) =>
      point.month === "2015-06-01" ? { ...point, value: null } : point,
    );
    const usual = usualIntensity(points, "2015-06-01");
    expect(usual).not.toBeNull();
    expect(usual).toBeCloseTo(usualIntensity(points, "2016-06-01") ?? 0);
  });

  it("is unknown with too few years or no values", () => {
    expect(usualIntensity(record().slice(0, 36), "2010-06-01")).toBeNull();
    expect(usualIntensity([], "2010-06-01")).toBeNull();
  });
});

describe("approach", () => {
  it("moves part of the way and never overshoots", () => {
    const next = approach(0, 10, 0.1, 5);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
    expect(approach(0, 10, 100, 5)).toBeCloseTo(10);
  });

  it("covers the same ground in one long step as in two short ones", () => {
    const once = approach(0, 10, 0.2, 5);
    const twice = approach(approach(0, 10, 0.1, 5), 10, 0.1, 5);
    expect(once).toBeCloseTo(twice);
  });

  it("jumps when the rate is zero (reduce motion)", () => {
    expect(approach(0, 10, 0.016, 0)).toBe(10);
  });
});

describe("calmGrid and calmSlot", () => {
  it("uses smaller clusters in rows when many layers are open", () => {
    expect(calmGrid(1, 1.7)).toMatchObject({ columns: 1, scale: 1 });
    expect(calmGrid(12, 1.7).columns).toBe(6);
    expect(calmGrid(12, 0.46).columns).toBe(4);
    expect(calmGrid(12, 1.7).scale).toBeLessThan(calmGrid(3, 1.7).scale);
  });

  it("gives every layer its own place", () => {
    for (const [count, aspect] of [
      [1, 1.7],
      [3, 1.7],
      [6, 1.7],
      [12, 1.7],
      [3, 0.46],
      [12, 0.46],
    ] as const) {
      const grid = calmGrid(count, aspect);
      const reach = calmRadius(CALM_MAX_UNITS) * grid.scale;
      const slots = Array.from({ length: count }, (_, index) =>
        calmSlot(index, count, grid),
      );
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const a = slots[i] as { x: number; y: number };
          const b = slots[j] as { x: number; y: number };
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
            2 * reach,
          );
        }
      }
    }
  });

  it("grows long rows to the left on a wide window", () => {
    const grid = calmGrid(12, 1.7);
    const reach = calmRadius(CALM_MAX_UNITS) * grid.scale;
    for (let index = 0; index < 12; index += 1) {
      expect(calmSlot(index, 12, grid).x + reach).toBeLessThanOrEqual(
        grid.maxRight + 1e-9,
      );
    }
  });

  it("centers a single layer above the place", () => {
    const slot = calmSlot(0, 1, calmGrid(1, 1.7));
    expect(slot.x).toBeCloseTo(0);
    expect(slot.y).toBeGreaterThan(calmRadius(CALM_MAX_UNITS));
  });
});

describe("calmViewScale and calmDriftSpeed", () => {
  it("is 1 at the starting distance and smaller nearer the ground", () => {
    expect(calmViewScale(3.2)).toBeCloseTo(1);
    expect(calmViewScale(1.6)).toBeLessThan(1);
  });

  it("gets smaller on screen the closer the camera comes (#197)", () => {
    // Apparent size ~ world size / distance from the camera to the surface.
    const onScreen = (distance: number) =>
      calmViewScale(distance) / (distance - 1);
    expect(onScreen(1.6)).toBeLessThan(onScreen(3.2));
    expect(onScreen(1.2)).toBeLessThan(onScreen(1.6));
    expect(calmViewScale(1.01)).toBeGreaterThan(0);
  });

  it("keeps every layer slow", () => {
    expect(calmDriftSpeed(0.04)).toBeCloseTo(0.25);
    expect(calmDriftSpeed(3)).toBeCloseTo(0.45);
    expect(calmDriftSpeed(100)).toBeCloseTo(0.45);
  });
});
