import { describe, expect, it } from "vitest";
import {
  alignAnomalies,
  alignCoverage,
  alignValues,
  breakMonths,
  calendarAnomalies,
  displayUnit,
  displayValue,
  formatAnomaly,
  formatP,
  runningMean,
  stripBars,
  trendLine,
} from "./seriesMath";
import { monthFromNumber, monthNumber } from "./timelineMath";

function monthsFrom(first: string, count: number): string[] {
  const start = monthNumber(first);
  return Array.from({ length: count }, (_, index) =>
    monthFromNumber(start + index),
  );
}

describe("display units", () => {
  it("shows kelvin as °C and leaves other units alone", () => {
    expect(displayValue(300, "K")).toBeCloseTo(26.85);
    expect(displayValue(0.3, "mm/hr")).toBe(0.3);
    expect(displayValue(null, "K")).toBeNull();
    expect(displayUnit("K")).toBe("°C");
    expect(displayUnit("1")).toBe("");
    expect(displayUnit("DU")).toBe("DU");
  });
});

describe("aligning a series to the timeline's months", () => {
  const months = monthsFrom("2001-01-01", 4);
  const points = [
    { month: "2001-02-01", value: 2, coverage: 0.5 },
    { month: "2001-04-01", value: null, coverage: 0 },
  ];

  it("puts null where the series has no month or no value", () => {
    expect(alignValues(points, months)).toEqual([null, 2, null, null]);
    expect(alignCoverage(points, months)).toEqual([null, 0.5, null, 0]);
  });

  it("reads anomalies.json by month offset from first_month", () => {
    const series = { first_month: "2001-02-01", values: [0.1, null, -0.2] };
    expect(alignAnomalies(series, months)).toEqual([null, 0.1, null, -0.2]);
  });
});

describe("calendarAnomalies", () => {
  it("subtracts the mean of the same calendar month", () => {
    const months = monthsFrom("2001-01-01", 24);
    // January 10 then 14 (mean 12); every other month constant 5.
    const values = months.map((_, index) =>
      index === 0 ? 10 : index === 12 ? 14 : 5,
    );
    const result = calendarAnomalies(values, months);
    expect(result[0]).toBe(-2);
    expect(result[12]).toBe(2);
    expect(result[1]).toBe(0);
    expect(result[23]).toBe(0);
  });

  it("removes a pure seasonal cycle and keeps missing months missing", () => {
    const months = monthsFrom("2003-03-01", 36);
    const values: (number | null)[] = months.map(
      (month) => 20 + 5 * Math.sin((monthNumber(month) % 12) * 0.5),
    );
    values[7] = null;
    const result = calendarAnomalies(values, months);
    expect(result[7]).toBeNull();
    for (const [index, value] of result.entries()) {
      if (index !== 7) expect(value).toBeCloseTo(0, 10);
    }
  });
});

describe("runningMean", () => {
  it("is centred: six before and five after for a window of 12", () => {
    const values = Array.from({ length: 14 }, (_, index) => index);
    const result = runningMean(values);
    expect(result.slice(0, 6)).toEqual(new Array(6).fill(null));
    expect(result[6]).toBeCloseTo(5.5);
    expect(result[7]).toBeCloseTo(6.5);
    expect(result[8]).toBeCloseTo(7.5);
    expect(result.slice(9)).toEqual(new Array(5).fill(null));
  });

  it("is null wherever the window touches a missing month", () => {
    const values: (number | null)[] = new Array(30).fill(1);
    values[15] = null;
    const result = runningMean(values);
    // Windows [i-6, i+5] containing index 15: i from 10 to 21.
    for (let index = 6; index <= 24; index += 1) {
      if (index >= 10 && index <= 21) expect(result[index]).toBeNull();
      else expect(result[index]).toBe(1);
    }
  });

  it("works with a small window", () => {
    expect(runningMean([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
});

describe("trendLine", () => {
  const months = monthsFrom("2001-01-01", 121);

  it("passes through the mean point with the given slope", () => {
    // Exactly linear anomalies: 1 unit per decade, mean zero.
    const anomalies = months.map((_, index) => (index - 60) / 120);
    const line = trendLine(1, [0.5, 1.5], months, anomalies, anomalies);
    expect(line).not.toBeNull();
    expect(line?.start).toBe(monthNumber("2001-01-01"));
    expect(line?.end).toBe(monthNumber("2011-01-01"));
    expect(line?.line[0]).toBeCloseTo(-0.5);
    expect(line?.line[1]).toBeCloseTo(0.5);
    // CI lines pivot on the same point.
    expect(line?.low[0]).toBeCloseTo(-0.25);
    expect(line?.low[1]).toBeCloseTo(0.25);
    expect(line?.high[0]).toBeCloseTo(-0.75);
    expect(line?.high[1]).toBeCloseTo(0.75);
  });

  it("sits at the mean level of the drawn values", () => {
    const anomalies = months.map(() => 0);
    const values = months.map(() => 25);
    const line = trendLine(2, [1, 3], months, anomalies, values);
    expect(((line?.line[0] ?? 0) + (line?.line[1] ?? 0)) / 2).toBeCloseTo(25);
    expect((line?.line[1] ?? 0) - (line?.line[0] ?? 0)).toBeCloseTo(2);
  });

  it("spans only the analysed months and uses their mean time", () => {
    const anomalies: (number | null)[] = months.map(() => 0);
    for (let index = 0; index < 24; index += 1) anomalies[index] = null;
    const line = trendLine(1.2, [1.2, 1.2], months, anomalies, anomalies);
    expect(line?.start).toBe(monthNumber("2003-01-01"));
    // 97 months from 2003-01; the centre is 48 months in, where y = 0.
    expect(line?.line[0]).toBeCloseTo(-0.48);
    expect(line?.line[1]).toBeCloseTo(0.48);
  });

  it("is null without analysed months", () => {
    const empty = months.map(() => null);
    expect(trendLine(1, [0, 2], months, empty, empty)).toBeNull();
  });
});

describe("stripBars", () => {
  it("skips missing months and scales to -1..1", () => {
    const bars = stripBars([1, null, -2, 0.5]);
    expect(bars.map((bar) => bar.index)).toEqual([0, 2, 3]);
    expect(bars.map((bar) => bar.level)).toEqual([0.5, -1, 0.25]);
  });

  it("clamps the few months beyond the 98th percentile", () => {
    const values = Array.from({ length: 100 }, (_, index) =>
      index === 99 ? 50 : index === 98 ? 2 : 1,
    );
    const bars = stripBars(values);
    expect(bars[99]?.level).toBe(1);
    expect(bars[98]?.level).toBe(1);
    expect(bars[0]?.level).toBe(0.5);
  });

  it("returns nothing for an empty series and flat bars for all zeros", () => {
    expect(stripBars([null, null])).toEqual([]);
    expect(stripBars([0, 0])).toEqual([
      { index: 0, level: 0 },
      { index: 1, level: 0 },
    ]);
  });
});

describe("breakMonths", () => {
  const issues = {
    a: { break_months: ["2017-07-01", "2011-05-01"] },
    b: { break_months: ["2011-05-01"] },
    c: {},
  };

  it("collects the break months of the listed issues, sorted, once each", () => {
    expect(breakMonths(["a", "b", "c", "missing"], issues)).toEqual([
      "2011-05-01",
      "2017-07-01",
    ]);
  });

  it("is empty without issues", () => {
    expect(breakMonths(undefined, issues)).toEqual([]);
    expect(breakMonths(["a"], undefined)).toEqual([]);
  });
});

describe("formatting", () => {
  it("prints p values", () => {
    expect(formatP(0.0004)).toBe("< 0.001");
    expect(formatP(0.0878)).toBe("0.088");
    expect(formatP(null)).toBe("not available");
  });

  it("prints anomalies with a sign and the difference unit", () => {
    expect(formatAnomaly(0.416, "K")).toBe("+0.42 °C");
    expect(formatAnomaly(-0.1, "mm/hr")).toBe("−0.10 mm/hr");
    expect(formatAnomaly(-0.0000012, "kg m-2 s-1")).toBe("−1.20e-6 kg m-2 s-1");
    expect(formatAnomaly(0.03, "1")).toBe("+0.03");
    expect(formatAnomaly(null, "K")).toBe("not available");
  });
});
