import { describe, expect, it } from "vitest";
import {
  deltaUnit,
  formatChangePerDecade,
  loadTrends,
  significanceText,
  summarizeTrend,
  trendKey,
  type AnalyzedTrend,
  type TestResult,
  type TrendsFile,
} from "./trends";

function test(
  significant: boolean | null,
  significantFdr: boolean | null,
): TestResult {
  return {
    p: significant === null ? null : 0.01,
    p_fdr: significant === null ? null : 0.02,
    significant,
    significant_fdr: significantFdr,
  };
}

function analyzed(unit: string, ols: TestResult): AnalyzedTrend {
  return {
    status: "analyzed",
    unit,
    data: { first_month: "2001-01-01", last_month: "2026-09-01", n_valid: 309 },
    ols: { ...ols, slope_per_decade: 0.2104, ci_per_decade: [0.1249, 0.2951] },
    mann_kendall: {
      original: test(true, true),
      hamed_rao: test(true, true),
      seasonal: test(true, true),
    },
    sen: { slope_per_decade: 0.2, ci_per_decade: [0.1, 0.3] },
  };
}

describe("trendKey", () => {
  it("matches the series file name without the extension", () => {
    expect(trendKey("merra2_t2m", "taichung", "point")).toBe(
      "merra2_t2m__taichung__point",
    );
  });
});

describe("deltaUnit", () => {
  it("shows temperature differences as °C whatever the source unit", () => {
    expect(["K", "C", "degC"].map(deltaUnit)).toEqual(["°C", "°C", "°C"]);
  });

  it("drops the unit of dimensionless variables and keeps the others", () => {
    expect(deltaUnit("1")).toBe("");
    expect(deltaUnit("mm/hr")).toBe("mm/hr");
  });
});

describe("formatChangePerDecade", () => {
  it("shows a kelvin slope as a °C difference without the 273.15 offset", () => {
    expect(formatChangePerDecade(0.2104, [0.1249, 0.2951], "K")).toBe(
      "+0.21 °C per decade (95% CI 0.12 to 0.30)",
    );
  });

  it("keeps the minus signs of a negative slope and interval", () => {
    expect(formatChangePerDecade(-0.0198, [-0.0473, 0.00763], "mm/hr")).toBe(
      "-0.0198 mm/hr per decade (95% CI -0.0473 to 0.0076)",
    );
  });

  it("uses exponent notation for very large or very small numbers", () => {
    expect(
      formatChangePerDecade(-1.89e15, [-2.14e15, -1.64e15], "molecules/cm^2"),
    ).toBe(
      "-1.89e+15 molecules/cm^2 per decade (95% CI -2.14e+15 to -1.64e+15)",
    );
    expect(
      formatChangePerDecade(9.57e-7, [2.86e-7, 1.63e-6], "kg m-2 s-1"),
    ).toBe("+9.57e-7 kg m-2 s-1 per decade (95% CI 2.86e-7 to 1.63e-6)");
  });

  it("writes no unit for a dimensionless variable", () => {
    expect(formatChangePerDecade(0.0128, [0.01, 0.0155], "1")).toBe(
      "+0.0128 per decade (95% CI 0.0100 to 0.0155)",
    );
  });

  it("gives every number the precision of the largest one", () => {
    expect(formatChangePerDecade(4.44, [2.34, 16.55], "DU")).toBe(
      "+4.4 DU per decade (95% CI 2.3 to 16.6)",
    );
  });

  it("labels the interval with the confidence level from alpha", () => {
    expect(formatChangePerDecade(1, [0.5, 1.5], "K", 0.1)).toContain("90% CI");
  });
});

describe("significanceText", () => {
  it("separates the raw result from the FDR-corrected one", () => {
    expect(significanceText(test(true, true))).toBe(
      "significant after autocorrelation and FDR correction",
    );
    expect(significanceText(test(true, false))).toBe(
      "significant after autocorrelation correction, not after FDR correction",
    );
    expect(significanceText(test(false, false))).toBe(
      "not significant after autocorrelation correction",
    );
  });

  it("says so when the test has no p value", () => {
    expect(significanceText(test(null, null))).toBe(
      "test could not be computed",
    );
  });
});

describe("summarizeTrend", () => {
  it("combines change per decade, significance and the analyzed period", () => {
    expect(summarizeTrend(analyzed("K", test(true, true)))).toEqual({
      headline: "+0.21 °C per decade (95% CI 0.12 to 0.30)",
      significance: "significant after autocorrelation and FDR correction",
      period: "2001-01 to 2026-09",
    });
  });

  it("shows the reason when a series was not analyzed", () => {
    expect(
      summarizeTrend({
        status: "insufficient",
        unit: "molecules/cm^2",
        reason: { code: "too_many_missing", text_en: "40% of months missing." },
      }),
    ).toEqual({
      headline: "Trend not analyzed",
      significance: "40% of months missing.",
      period: null,
    });
  });

  it("returns nothing for a series that is not in the results", () => {
    expect(summarizeTrend(undefined)).toBeNull();
  });
});

describe("loadTrends", () => {
  const core: TrendsFile = {
    input: { snapshot_generated_at: "2026-11-14T13:02:25Z" },
    parameters: { alpha: 0.05, min_coverage: 0.25 },
    series: { omi_no2__taichung__point: analyzed("K", test(true, true)) },
  };
  const world: TrendsFile = {
    ...core,
    series: { omi_no2__tokyo__point: analyzed("K", test(true, false)) },
  };

  it("reads the core trends and adds the world subset's series", async () => {
    const urls: string[] = [];
    const loaded = await loadTrends(<T>(url: string) => {
      urls.push(url);
      return Promise.resolve((url.includes("world/") ? world : core) as T);
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/data\/analysis\/trends\.json$/);
    expect(urls[1]).toMatch(/data\/analysis\/world\/trends\.json$/);
    expect(Object.keys(loaded.series).sort()).toEqual([
      "omi_no2__taichung__point",
      "omi_no2__tokyo__point",
    ]);
    expect(loaded.series.omi_no2__tokyo__point).toBe(
      world.series.omi_no2__tokyo__point,
    );
    expect(loaded.parameters).toBe(core.parameters);
  });

  it("returns the core trends alone when there is no world subset", async () => {
    const loaded = await loadTrends(<T>(url: string) =>
      url.includes("world/")
        ? Promise.reject(new Error("404"))
        : Promise.resolve(core as T),
    );
    expect(loaded).toBe(core);
  });
});
