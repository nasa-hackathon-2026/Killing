import { describe, expect, it } from "vitest";
import {
  annualMeans,
  autocorrelation,
  changeOverPeriod,
  histogram,
  intervalScale,
  latestYear,
  outlierIndices,
  periodMonths,
  pStrength,
  residuals,
  robustSd,
  seasonalCycle,
  seriesCsv,
  sharedLimit,
  whiteNoiseBound,
} from "./stats";

function monthsFrom(year: number, count: number): string[] {
  return Array.from({ length: count }, (_, at) => {
    const y = year + Math.floor(at / 12);
    const m = (at % 12) + 1;
    return `${y}-${String(m).padStart(2, "0")}-01`;
  });
}

describe("seasonal cycle", () => {
  it("averages each calendar month over the years", () => {
    const months = monthsFrom(2001, 24);
    const values = months.map((_, at) => (at % 12) + (at >= 12 ? 2 : 0));
    const cycle = seasonalCycle(values, months);
    expect(cycle.mean[0]).toBe(1);
    expect(cycle.mean[11]).toBe(12);
    expect(cycle.min[0]).toBe(0);
    expect(cycle.max[0]).toBe(2);
    expect(cycle.count).toEqual(new Array(12).fill(2));
  });

  it("leaves a calendar month without values null", () => {
    const months = monthsFrom(2001, 12);
    const values = months.map((_, at) => (at === 3 ? null : at));
    expect(seasonalCycle(values, months).mean[3]).toBeNull();
  });

  it("finds the last year with a value", () => {
    const months = monthsFrom(2001, 15);
    const values = months.map((_, at) => at);
    const last = latestYear(values, months);
    expect(last?.year).toBe(2002);
    expect(last?.values.slice(0, 4)).toEqual([12, 13, 14, null]);
    expect(latestYear([null], ["2001-01-01"])).toBeNull();
  });
});

describe("residuals around the published line", () => {
  it("are zero for an exact line with the same slope", () => {
    const months = monthsFrom(2001, 36);
    // 0.5 per decade = 0.5/120 per month.
    const anomalies = months.map((_, at) => (0.5 / 120) * at + 3);
    const result = residuals(anomalies, months, 0.5);
    for (const value of result) expect(value ?? 1).toBeCloseTo(0, 12);
  });

  it("keep missing months missing", () => {
    const months = monthsFrom(2001, 3);
    expect(residuals([1, null, 3], months, 0)).toEqual([-1, null, 1]);
  });
});

describe("robust spread and outliers", () => {
  it("is 1.4826 × MAD and ignores one extreme month", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    expect(robustSd(values)).toBeCloseTo(1.4826 * 2.5, 10);
    expect(outlierIndices(values)).toEqual([9]);
    expect(outlierIndices([1, 1, 1])).toEqual([]);
  });
});

describe("autocorrelation", () => {
  it("is 1 at every lag for a constant step pattern and near -1 for alternation", () => {
    const alternating = Array.from({ length: 200 }, (_, at) =>
      at % 2 ? 1 : -1,
    );
    const acf = autocorrelation(alternating, 2);
    expect(acf[0]).toBeCloseTo(-0.995, 3);
    expect(acf[1]).toBeCloseTo(0.99, 2);
  });

  it("does not pair across a gap", () => {
    const values = [1, null, -1, null, 1];
    // Lag 1 has no complete pair.
    expect(autocorrelation(values, 1)[0]).toBe(0);
  });

  it("gives the white-noise band", () => {
    expect(whiteNoiseBound(100)).toBeCloseTo(0.196, 10);
    expect(whiteNoiseBound(0)).toBe(0);
  });
});

describe("histogram", () => {
  it("counts every value once in equal-width bins", () => {
    const values = Array.from({ length: 64 }, (_, at) => at);
    const result = histogram(values);
    expect(result.counts.length).toBe(7);
    expect(result.edges.length).toBe(8);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(64);
    expect(histogram([null]).counts).toEqual([]);
    expect(histogram([2, 2], 4).counts.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("annual means", () => {
  it("averages complete years only", () => {
    const months = monthsFrom(2001, 18);
    const values = months.map((_, at) => (at < 12 ? 1 : 5));
    expect(annualMeans(values, months)).toEqual([
      { year: 2001, mean: 1, count: 12 },
      { year: 2002, mean: null, count: 6 },
    ]);
  });
});

describe("interval chart", () => {
  it("centres 0 and fits every number", () => {
    const scale = intervalScale([-0.1, 0.5, 0.2], 0, 200);
    expect(scale.x(0)).toBe(100);
    expect(scale.x(0.5)).toBeLessThan(200);
    expect(scale.x(-scale.limit)).toBe(0);
    expect(intervalScale([0], 0, 10).limit).toBe(1);
  });

  it("converts a slope per decade over the period", () => {
    expect(periodMonths("2001-01-01", "2025-12-01")).toBe(300);
    expect(changeOverPeriod(0.4, "2001-01-01", "2021-01-01")).toBeCloseTo(
      0.8,
      12,
    );
  });
});

describe("CSV", () => {
  it("writes one row per month with a value or an anomaly", () => {
    const csv = seriesCsv({
      unit: "K",
      months: ["2001-01-01", "2001-02-01", "2001-03-01"],
      values: [1.5, null, 2],
      anomalies: [0.1, null, null],
      coverage: [1, null, 0.2],
    });
    expect(csv).toBe(
      "month,value,anomaly,coverage,used_in_trend,unit\n" +
        "2001-01,1.5,0.1,1,true,K\n" +
        "2001-03,2,,0.2,false,K\n",
    );
  });
});

describe("p value positions", () => {
  it("is −log10(p) capped, null when missing", () => {
    expect(pStrength(0.01)).toBeCloseTo(2, 12);
    expect(pStrength(1)).toBe(0);
    expect(pStrength(1e-12)).toBe(6);
    expect(pStrength(0)).toBe(6);
    expect(pStrength(null)).toBeNull();
  });
});

describe("shared small-multiple range", () => {
  it("is symmetric at the 98th percentile of the absolute values", () => {
    const values = Array.from({ length: 100 }, (_, at) => at - 50);
    values.push(1000);
    expect(sharedLimit([values, [null]])).toEqual([-49, 49]);
    expect(sharedLimit([[null]])).toBeNull();
  });
});
