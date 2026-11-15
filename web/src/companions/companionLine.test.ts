import { afterEach, describe, expect, it } from "vitest";
import type { TrendEntry } from "../analysis/trends";
import { allTrendCaveats } from "../analysis/trendCaveats";
import { setLocale } from "../i18n";
import {
  companionLine,
  companionSpeech,
  companionSpeechParts,
  monthLabel,
  spokenLine,
} from "./companionLine";

const trend: TrendEntry = {
  status: "analyzed",
  unit: "K",
  data: { first_month: "2001-01-01", last_month: "2026-06-01", n_valid: 300 },
  ols: {
    slope_per_decade: 0.42,
    ci_per_decade: [0.2, 0.64],
    p: 0.001,
    p_fdr: 0.002,
    significant: true,
    significant_fdr: true,
  },
  mann_kendall: {
    original: { p: 0, p_fdr: 0, significant: true, significant_fdr: true },
    hamed_rao: { p: 0, p_fdr: 0, significant: true, significant_fdr: true },
    seasonal: { p: 0, p_fdr: 0, significant: true, significant_fdr: true },
  },
  sen: { slope_per_decade: 0.4, ci_per_decade: [0.2, 0.6] },
};

afterEach(() => {
  setLocale("en");
});

describe("companionLine", () => {
  it("keeps missing-month, trend uncertainty and data kind in separate display items", () => {
    const input = {
      companionName: "Leaf",
      variableName: "Vegetation greenness",
      place: "Kaohsiung",
      month: "2026-11-01",
      value: null,
      unit: "1",
      trend,
      dataKind: "satellite_retrieval" as const,
    };
    const parts = companionSpeechParts(input, "expert");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("no data for this month");
    expect(parts[1]).toContain("95% CI 0.20 to 0.64");
    expect(parts[2]).toBe("Data kind: satellite retrieval.");
    expect(parts.join(" ")).toBe(companionSpeech(input, "expert"));
    const plain = companionSpeechParts(input, "general");
    expect(plain).toHaveLength(3);
    expect(plain.join(" ")).toBe(companionSpeech(input, "general"));
  });
  it("states the value, the anomaly, the trend and the data kind", () => {
    expect(
      companionLine({
        variableName: "2 m air temperature",
        place: "Taichung",
        month: "2024-06-01",
        value: 301.15,
        unit: "K",
        anomaly: {
          difference: 0.84,
          mean: 300.31,
          firstYear: "2001",
          lastYear: "2026",
        },
        trend,
        dataKind: "model",
      }),
    ).toBe(
      "2 m air temperature at Taichung, June 2024: 28.0 °C. " +
        "That is 0.8 °C above the June mean of this record (27.2 °C, 2001 to 2026). " +
        "Trend 2001-01 to 2026-06: +0.42 °C per decade (95% CI 0.20 to 0.64), " +
        "significant after autocorrelation and FDR correction. " +
        "Data kind: model.",
    );
  });

  it("formats spoken months in the text language without changing the displayed month", () => {
    setLocale("ja");
    const input = {
      companionName: "Rain",
      variableName: "Precipitation",
      place: "Taipei",
      month: "2015-07-01",
      value: 0.23,
      unit: "mm/hr",
    };

    expect(companionSpeechParts(input, "general").join(" ")).toContain(
      "2015年7月",
    );
    expect(
      companionSpeechParts({ ...input, formatLocale: "en" }, "general").join(
        " ",
      ),
    ).toContain("July 2015");
  });

  it("says the number first, then that an unreliable trend is not a climate signal", () => {
    const line = companionLine({
      variableName: "Near-surface air temperature",
      place: "Tokyo",
      month: "2024-06-01",
      value: 295.15,
      unit: "K",
      trend,
      caveatSummary: allTrendCaveats("expert").gldas_tair?.summary,
      unreliableReason: allTrendCaveats("expert").gldas_tair?.reason,
      dataKind: "model",
    });
    expect(line).toBe(
      "Near-surface air temperature at Tokyo, June 2024: 22.0 °C. " +
        "Trend 2001-01 to 2026-06: +0.42 °C per decade (95% CI 0.20 to 0.64), " +
        "significant after autocorrelation and FDR correction. " +
        "This trend is not reliable as a climate signal: it contains step changes. " +
        "Data kind: model.",
    );
    expect(line).not.toContain("Caution:");
  });

  it("gives every caveat of the three GLDAS variables a reason clause", () => {
    for (const caveat of Object.values(allTrendCaveats("expert"))) {
      expect(caveat.reason).toMatch(/\.$/);
    }
  });

  it("says below for a negative difference and keeps the unit", () => {
    const line = companionLine({
      variableName: "Precipitation",
      place: "Taipei",
      month: "2020-01",
      value: 0.1,
      unit: "mm/hr",
      anomaly: {
        difference: -0.05,
        mean: 0.15,
        firstYear: "2001",
        lastYear: "2025",
      },
    });
    expect(line).toBe(
      "Precipitation at Taipei, January 2020: 0.10 mm/hr. " +
        "That is 0.05 mm/hr below the January mean of this record (0.15 mm/hr, 2001 to 2025).",
    );
  });

  it("says so when the month has no data, and still gives the trend", () => {
    const line = companionLine({
      variableName: "Total ozone",
      place: "Yushan",
      month: "2026-07-01",
      value: null,
      unit: "DU",
      trend,
    });
    expect(line).toContain("July 2026: no data for this month.");
    expect(line).toContain("Trend 2001-01 to 2026-06");
    expect(line).not.toContain("mean of this record");
  });

  it("appends the known-problem caution word for word", () => {
    const caution = allTrendCaveats("expert").gldas_tair?.summary ?? "";
    const line = companionLine({
      variableName: "Near-surface air temperature",
      place: "Taichung",
      month: "2024-06-01",
      value: 300,
      unit: "K",
      caveatSummary: caution,
      dataKind: "model",
    });
    expect(caution).not.toBe("");
    expect(line).toContain(caution);
  });

  it("reports a trend that was not analyzed with the file's own reason", () => {
    const line = companionLine({
      variableName: "Vegetation greenness",
      place: "Hualien",
      month: "2024-06-01",
      value: 0.7,
      unit: "1",
      trend: {
        status: "insufficient",
        unit: "1",
        reason: { code: "coverage", text_en: "40% of months are missing." },
      },
    });
    expect(line).toBe(
      "Vegetation greenness at Hualien, June 2024: 0.70. " +
        "Trend not analyzed: 40% of months are missing.",
    );
  });

  it("never states a cause, a conclusion or a feeling", () => {
    const banned =
      /because|due to|caused|leads to|therefore|worr|alarm|healthy|sick|danger|good|bad|happy|sad/i;
    for (const caution of [null, ...Object.values(allTrendCaveats("expert"))]) {
      const line = companionLine({
        variableName: "Precipitation",
        place: "Taichung",
        month: "2024-06-01",
        value: 1,
        unit: "mm/hr",
        anomaly: {
          difference: 0,
          mean: 1,
          firstYear: "2001",
          lastYear: "2026",
        },
        trend,
        // The caution sentences are checked facts written by the team
        // (trendCaveats.ts); only the template around them is tested here.
        caveatSummary: null,
        dataKind: "satellite_retrieval",
      });
      expect(line).not.toMatch(banned);
      expect(caution === null || caution.summary.startsWith("Caution:")).toBe(
        true,
      );
    }
  });

  it("handles a missing month", () => {
    expect(
      companionLine({
        variableName: "Precipitation",
        place: "Taichung",
        month: null,
        value: null,
        unit: "mm/hr",
      }),
    ).toBe("Precipitation at Taichung: no month selected.");
  });
});

describe("monthLabel and spokenLine", () => {
  it("names the month", () => {
    expect(monthLabel("2024-06-01")).toEqual({
      name: "June",
      label: "June 2024",
    });
  });

  it("spells symbols out without changing the numbers", () => {
    expect(
      spokenLine("Tropospheric NO2: 3.10e+15, +0.42 °C (95% CI 0.2 to 0.6)"),
    ).toBe(
      "Tropospheric N O 2: 3.10 times ten to the +15, +0.42 degrees Celsius (95 percent confidence interval 0.2 to 0.6)",
    );
  });
});
