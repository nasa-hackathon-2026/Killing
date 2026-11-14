import { describe, expect, it } from "vitest";
import type { AnalyzedTrend, TrendEntry } from "../analysis/trends";
import {
  encodeForm,
  trendArrowDirection,
  trendMark,
  trendSignal,
  type EncodingSpec,
} from "./encoding";

const spec: EncodingSpec = {
  maxCount: 300,
  size: [0.5, 1.5],
  speed: [1, 3],
  speedLaw: "linear",
};

function analyzed(
  slope: number,
  significant: boolean | null,
  fdr: boolean | null,
): AnalyzedTrend {
  const test = { p: 0.01, p_fdr: 0.02, significant, significant_fdr: fdr };
  return {
    status: "analyzed",
    unit: "K",
    data: { first_month: "2001-01-01", last_month: "2025-12-01", n_valid: 300 },
    ols: { ...test, slope_per_decade: slope, ci_per_decade: [0, 1] },
    mann_kendall: { original: test, hamed_rao: test, seasonal: test },
    sen: { slope_per_decade: slope, ci_per_decade: [0, 1] },
  };
}

describe("encodeForm", () => {
  it("draws nothing without data and a floor at the series minimum", () => {
    expect(encodeForm(0, spec, { hasData: false }).count).toBe(0);
    expect(encodeForm(0.9, spec, { hasData: false }).count).toBe(0);
    expect(encodeForm(0, spec).count).toBeGreaterThan(0);
  });

  it("stays inside the cap it is given", () => {
    expect(encodeForm(1, spec, { cap: 120 }).count).toBe(120);
    expect(encodeForm(0.5, spec, { cap: 120 }).count).toBe(60);
    expect(encodeForm(0, spec, { cap: 120 }).count).toBe(10);
    expect(encodeForm(1, spec, { cap: 9999 }).count).toBe(300);
  });

  it("maps the value to count, size and speed", () => {
    expect(encodeForm(0, spec)).toEqual({ count: 24, size: 0.5, speed: 1 });
    expect(encodeForm(0.5, spec)).toEqual({ count: 150, size: 1, speed: 2 });
    expect(encodeForm(1, spec)).toEqual({ count: 300, size: 1.5, speed: 3 });
  });

  it("clamps out-of-range and missing values", () => {
    expect(encodeForm(2, spec)).toEqual(encodeForm(1, spec));
    expect(encodeForm(-1, spec)).toEqual(encodeForm(0, spec));
    expect(encodeForm(Number.NaN, spec).count).toBe(0);
  });

  it("never draws more than the shared instance limit", () => {
    expect(encodeForm(1, { ...spec, maxCount: 100000 }).count).toBe(480);
  });

  it("follows a square root when the value stands for an energy", () => {
    const thermal: EncodingSpec = { ...spec, speedLaw: "sqrt" };
    expect(encodeForm(0, thermal).speed).toBeCloseTo(1, 9);
    expect(encodeForm(1, thermal).speed).toBeCloseTo(3, 9);
    // Halfway in energy (1 to 9) is 5, so speed is sqrt(5).
    expect(encodeForm(0.5, thermal).speed).toBeCloseTo(Math.sqrt(5), 9);
  });
});

describe("trendSignal", () => {
  it("reports direction only for a significant trend", () => {
    expect(trendSignal(analyzed(0.4, true, true))).toEqual({
      state: "rising",
      fdr: true,
    });
    expect(trendSignal(analyzed(-0.4, true, false))).toEqual({
      state: "falling",
      fdr: false,
    });
    expect(trendSignal(analyzed(0.4, false, false)).state).toBe(
      "not-significant",
    );
  });

  it("keeps missing and insufficient results apart", () => {
    const insufficient: TrendEntry = {
      status: "insufficient",
      unit: "K",
      reason: { code: "too_many_missing", text_en: "Too many missing months" },
    };
    expect(trendSignal(insufficient).state).toBe("insufficient");
    expect(trendSignal(undefined).state).toBe("unavailable");
    expect(trendSignal(analyzed(0.4, null, null)).state).toBe("unavailable");
  });

  it("turns a signal into a mark and an arrow direction", () => {
    expect(trendMark({ state: "rising", fdr: true }).glyph).toBe("▲");
    expect(trendMark({ state: "falling", fdr: false }).glyph).toBe("▽");
    expect(trendMark({ state: "not-significant", fdr: false }).label).toBe(
      "Not significant",
    );
    expect(trendMark({ state: "insufficient", fdr: false }).label).toBe(
      "Insufficient data",
    );
    expect(trendArrowDirection({ state: "rising", fdr: false })).toBe(1);
    expect(trendArrowDirection({ state: "falling", fdr: true })).toBe(-1);
    expect(trendArrowDirection({ state: "not-significant", fdr: false })).toBe(
      0,
    );
    expect(trendArrowDirection(undefined)).toBe(0);
  });
});
