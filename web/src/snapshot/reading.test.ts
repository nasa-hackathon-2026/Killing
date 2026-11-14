import { describe, expect, it } from "vitest";
import {
  bestDefaultMonth,
  formatMeasurement,
  intensityAt,
  sortedMonths,
  valueAt,
  type SeriesPoint,
} from "./reading";

const points: SeriesPoint[] = [
  { month: "2025-08-01", value: 0.33 },
  { month: "2025-09-01", value: null },
  { month: "2025-10-01", value: 0.87 },
];

describe("valueAt", () => {
  it("returns the stored value and does not fill a gap from another month", () => {
    expect(valueAt(points, "2025-08-01")).toBe(0.33);
    expect(valueAt(points, "2025-09-01")).toBeNull();
    expect(valueAt(points, "2024-01-01")).toBeNull();
  });
});

describe("intensityAt", () => {
  it("maps the series minimum to empty and the maximum to full", () => {
    expect(intensityAt(points, "2025-08-01")).toBe(0);
    expect(intensityAt(points, "2025-10-01")).toBe(1);
  });

  it("stays empty when that month has no value", () => {
    expect(intensityAt(points, "2025-09-01")).toBe(0);
  });

  it("treats a series of one repeated value as a real measurement", () => {
    const flat = [
      { month: "2025-01-01", value: 4 },
      { month: "2025-02-01", value: 4 },
    ];
    expect(intensityAt(flat, "2025-02-01")).toBe(1);
  });
});

describe("formatMeasurement", () => {
  it("converts kelvin for display and keeps other units", () => {
    expect(formatMeasurement(300.55, "K")).toBe("27.4 °C");
    expect(formatMeasurement(0.229, "mm/hr")).toBe("0.23 mm/hr");
    expect(formatMeasurement(2.8947963125e15, "molecules/cm^2")).toBe(
      "2.89e+15 molecules/cm^2",
    );
    expect(formatMeasurement(7.6e-6, "kg m-2 s-1")).toBe("7.60e-6 kg m-2 s-1");
    expect(formatMeasurement(null, "mm/hr")).toBe("No data");
  });
});

describe("sortedMonths", () => {
  it("returns each month once, in order", () => {
    expect(
      sortedMonths([
        points,
        [{ month: "2025-08-01", value: 1 }],
        [{ month: "2025-07-01", value: 2 }],
      ]),
    ).toEqual(["2025-07-01", "2025-08-01", "2025-09-01", "2025-10-01"]);
  });
});

describe("bestDefaultMonth", () => {
  it("picks the latest month with the most series that have a value", () => {
    const long: SeriesPoint[] = [
      { month: "2025-08-01", value: 1 },
      { month: "2025-09-01", value: 2 },
      { month: "2025-10-01", value: 3 },
      { month: "2025-11-01", value: 4 },
    ];
    const short: SeriesPoint[] = [
      { month: "2025-08-01", value: 1 },
      { month: "2025-09-01", value: 2 },
      { month: "2025-10-01", value: null },
    ];
    expect(bestDefaultMonth([long, short])).toBe("2025-09-01");
    expect(bestDefaultMonth([long])).toBe("2025-11-01");
  });

  it("returns null when nothing has a value", () => {
    expect(bestDefaultMonth([])).toBeNull();
    expect(
      bestDefaultMonth([[{ month: "2025-08-01", value: null }]]),
    ).toBeNull();
  });
});
