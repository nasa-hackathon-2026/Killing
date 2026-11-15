import { describe, expect, it } from "vitest";
import type { TrendEntry, TrendsFile } from "../analysis/trends";
import {
  buildTrendGlyphs,
  classifyTrend,
  countGlyphs,
  followedVariable,
  glyphLength,
  minSeparationDeg,
  spreadMarks,
} from "./trendGlyphs";

function analyzedTrend(
  slope: number,
  significant: boolean,
  fdr: boolean,
  knownIssues: string[] = [],
): TrendEntry {
  const test = {
    p: significant ? 0.01 : 0.4,
    p_fdr: fdr ? 0.02 : 0.6,
    significant,
    significant_fdr: fdr,
  };
  return {
    status: "analyzed",
    unit: "K",
    data: {
      first_month: "2001-01-01",
      last_month: "2025-12-01",
      n_valid: 300,
    },
    ols: {
      ...test,
      slope_per_decade: slope,
      ci_per_decade: [slope - 0.1, slope + 0.1],
    },
    mann_kendall: { original: test, hamed_rao: test, seasonal: test },
    sen: { slope_per_decade: slope, ci_per_decade: [slope - 0.1, slope + 0.1] },
    known_issues: knownIssues,
  };
}

function trendsFile(entries: Record<string, TrendEntry>): TrendsFile {
  return {
    input: { snapshot_generated_at: "2026-01-01" },
    parameters: { alpha: 0.05, min_coverage: 0.25 },
    known_issues: { step: { kind: "discontinuity", summary_en: "step" } },
    series: entries,
  };
}

describe("trend glyphs", () => {
  it("draws every outline short, including significant before FDR only", () => {
    expect(glyphLength(1, "solid")).toBe(46);
    expect(glyphLength(1, "hollow")).toBe(18);
    expect(glyphLength(0, "hollow")).toBe(12);
    expect(glyphLength(1, "nodata")).toBe(0);
  });

  it("follows the chart, else the open layer with most filled marks", () => {
    const filled = (id: string) =>
      ({ imerg_precip: 1, merra2_t2m: 10 })[id] ?? 0;
    expect(
      followedVariable("omi_ozone", ["imerg_precip", "merra2_t2m"], filled),
    ).toBe("omi_ozone");
    expect(followedVariable(null, ["imerg_precip", "merra2_t2m"], filled)).toBe(
      "merra2_t2m",
    );
    expect(followedVariable(null, ["a", "b"], () => 0)).toBe("a");
    expect(followedVariable(null, [], filled)).toBeNull();
  });

  it("keeps only the selected mark of a close cluster when far away", () => {
    const marks = [
      { placeId: "taichung", lat: 24.15, lon: 120.68 },
      { placeId: "taipei", lat: 25.03, lon: 121.56 },
      { placeId: "kaohsiung", lat: 22.63, lon: 120.3 },
      { placeId: "hualien", lat: 23.99, lon: 121.6 },
      { placeId: "yushan", lat: 23.47, lon: 120.95 },
      { placeId: "tokyo", lat: 35.68, lon: 139.69 },
    ];
    const far = spreadMarks(marks, "taipei", minSeparationDeg(3.2));
    expect(far.map((mark) => mark.placeId)).toEqual(["taipei", "tokyo"]);
    const near = spreadMarks(marks, "taipei", minSeparationDeg(1.2));
    expect(near).toHaveLength(6);
    // Selected elsewhere: the cluster still shows one mark.
    const other = spreadMarks(marks, "tokyo", minSeparationDeg(3.2));
    expect(other.map((mark) => mark.placeId)).toEqual(["taichung", "tokyo"]);
  });

  it("marks any analyzed trend with a documented trend-affecting issue as unreliable", () => {
    const glyph = classifyTrend(analyzedTrend(0.4, false, false, ["step"]), {
      step: { kind: "discontinuity" },
    });

    expect(glyph).toMatchObject({
      kind: "unreliable",
      significant: false,
      unreliable: true,
    });
  });

  it("maps places to FDR, no-data, and unreliable marks without recomputing tests", () => {
    const glyphs = buildTrendGlyphs(
      [
        { id: "north", nameEn: "North", aggregation: "point", lat: 40, lon: 0 },
        {
          id: "south",
          nameEn: "South",
          aggregation: "point",
          lat: -20,
          lon: 30,
        },
        { id: "east", nameEn: "East", aggregation: "point", lat: 10, lon: 120 },
      ],
      "temperature",
      trendsFile({
        temperature__north__point: analyzedTrend(0.5, true, false),
        temperature__east__point: analyzedTrend(-0.4, true, true, ["step"]),
      }),
      "Temperature",
    );

    expect(glyphs.map(({ placeId, kind }) => [placeId, kind])).toEqual([
      ["north", "hollow"],
      ["south", "nodata"],
      ["east", "unreliable"],
    ]);
    expect(countGlyphs(glyphs)).toEqual({
      solidUp: 0,
      solidDown: 0,
      hollow: 1,
      unreliable: 1,
      nodata: 1,
    });
  });
});
