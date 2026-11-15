import { describe, expect, it } from "vitest";
import {
  blendLevels,
  calendarMonth,
  dotBrightness,
  fieldLevel,
  followMonth,
  monthBlend,
  nearFarBlend,
  robustRange,
} from "./fieldMapping";

describe("monthly climatology display", () => {
  it("accepts the full first-of-month dates supplied by the timeline", () => {
    expect(calendarMonth("2025-07-01")).toBe(6);
    expect(calendarMonth("2025-12-01")).toBe(11);
  });
  it("keeps a valid exact month even when the adjacent month is missing", () => {
    expect(blendLevels(0.4, Number.NaN, 0)).toBe(0.4);
    expect(blendLevels(Number.NaN, 0.8, 1)).toBe(0.8);
    expect(blendLevels(0.4, Number.NaN, 0.5)).toBeNaN();
  });

  it("interpolates December into January across the year boundary", () => {
    expect(monthBlend(11.5)).toEqual({ from: 11, to: 0, share: 0.5 });
    expect(followMonth(11, 0, 0.25)).toBe(11.25);
    expect(followMonth(0, 11, 0.25)).toBe(11.75);
    expect(blendLevels(0.2, 0.8, 0.5)).toBeCloseTo(0.5);
  });

  it("distinguishes low measured values from missing values", () => {
    expect(fieldLevel(0, { low: 0, high: 100 })).toBeGreaterThan(0);
    expect(fieldLevel(100, { low: 0, high: 100 })).toBe(1);
    expect(dotBrightness(Number.NaN, 0)).toBe(0);
    expect(dotBrightness(1, 0.5)).toBe(1);
    expect(dotBrightness(0.2, 0.5)).toBe(0);
  });

  it("uses a shared finite range without allowing missing values to skew it", () => {
    expect(robustRange([0, 25, 50, 75, 100, Number.NaN], 0, 1)).toEqual({
      low: 0,
      high: 100,
    });
    expect(robustRange([Number.NaN])).toBeNull();
    const constant = robustRange([5, 5, 5]);
    expect(constant).toEqual({ low: 4.5, high: 5.5 });
  });

  it("cross-fades continuously from local details to the global distribution", () => {
    expect(nearFarBlend(1)).toEqual({ field: 0.1, local: 1 });
    expect(nearFarBlend(3).field).toBe(1);
    expect(nearFarBlend(3).local).toBeCloseTo(0.3);
    expect(nearFarBlend(2.1).field).toBeCloseTo(0.55);
    expect(nearFarBlend(2.1).local).toBeCloseTo(0.65);
  });

  it("rejects a malformed date instead of displaying an invented month", () => {
    expect(calendarMonth("2025-12")).toBe(11);
    expect(calendarMonth("xxxxx12")).toBeNull();
    expect(calendarMonth("2025-13")).toBeNull();
    expect(calendarMonth(null)).toBeNull();
  });
});
