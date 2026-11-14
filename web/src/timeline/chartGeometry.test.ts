import { describe, expect, it } from "vitest";
import {
  formatTick,
  linearScale,
  linePath,
  nearestIndex,
  niceTicks,
  paddedExtent,
  yearTicks,
} from "./chartGeometry";

describe("linearScale", () => {
  it("maps the domain onto the range, also when the range is flipped", () => {
    const y = linearScale([0, 10], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(10)).toBe(0);
    expect(y(2.5)).toBe(150);
  });

  it("returns the middle of the range for an empty domain", () => {
    expect(linearScale([3, 3], [0, 100])(3)).toBe(50);
  });
});

describe("paddedExtent", () => {
  it("pads the smallest and largest non-null values by 6%", () => {
    expect(paddedExtent([[0, null, 10], [5]])).toEqual([-0.6, 10.6]);
  });

  it("gives a flat series some room and nothing for no values", () => {
    expect(paddedExtent([[5, 5]])).toEqual([4.5, 5.5]);
    expect(paddedExtent([[0]])).toEqual([-1, 1]);
    expect(paddedExtent([[null], []])).toBeNull();
  });
});

describe("niceTicks", () => {
  it("picks round values inside the domain", () => {
    expect(niceTicks([14.2, 30.6])).toEqual([15, 20, 25, 30]);
    expect(niceTicks([-2.4, 2.9])).toEqual([-2, 0, 2]);
    expect(niceTicks([0.02, 0.34])).toEqual([0.1, 0.2, 0.3]);
  });

  it("formats ticks with just enough digits", () => {
    expect(formatTick(0.1, [0.1, 0.2, 0.3])).toBe("0.1");
    expect(formatTick(20, [15, 20, 25])).toBe("20");
    expect(formatTick(0.5, [0, 0.5, 1])).toBe("0.5");
    expect(formatTick(2e15, [1e15, 2e15])).toBe("2.0e+15");
    expect(formatTick(0, [0, 1e15])).toBe("0");
  });
});

describe("yearTicks", () => {
  it("labels round years as month numbers of January", () => {
    // 2001-01 to 2026-11: every 5 years.
    expect(yearTicks(2001 * 12, 2026 * 12 + 10).map((at) => at / 12)).toEqual([
      2005, 2010, 2015, 2020, 2025,
    ]);
  });

  it("labels every year of a short span and skips a partial first year", () => {
    expect(yearTicks(2020 * 12 + 3, 2023 * 12).map((at) => at / 12)).toEqual([
      2021, 2022, 2023,
    ]);
    expect(yearTicks(2020 * 12 + 3, 2020 * 12 + 9)).toEqual([]);
  });
});

describe("linePath", () => {
  const x = (index: number) => index * 10;
  const y = (value: number) => 100 - value;

  it("draws one line through consecutive values", () => {
    expect(linePath([1, 2, 3], x, y)).toBe("M0.0 99.0L10.0 98.0L20.0 97.0");
  });

  it("breaks the line at a missing month instead of bridging it", () => {
    expect(linePath([1, 2, null, 4, 5], x, y)).toBe(
      "M0.0 99.0L10.0 98.0M30.0 96.0L40.0 95.0",
    );
  });

  it("draws an isolated value as a zero-length segment", () => {
    expect(linePath([null, 2, null, 4], x, y)).toBe(
      "M10.0 98.0L10.0 98.0M30.0 96.0L30.0 96.0",
    );
  });

  it("is empty without values", () => {
    expect(linePath([null, null], x, y)).toBe("");
  });
});

describe("nearestIndex", () => {
  it("rounds to the nearest month and clamps outside the plot", () => {
    expect(nearestIndex(50, 50, 550, 11)).toBe(0);
    expect(nearestIndex(550, 50, 550, 11)).toBe(10);
    expect(nearestIndex(120, 50, 550, 11)).toBe(1);
    expect(nearestIndex(130, 50, 550, 11)).toBe(2);
    expect(nearestIndex(-40, 50, 550, 11)).toBe(0);
    expect(nearestIndex(900, 50, 550, 11)).toBe(10);
    expect(nearestIndex(100, 50, 550, 1)).toBe(0);
  });
});
