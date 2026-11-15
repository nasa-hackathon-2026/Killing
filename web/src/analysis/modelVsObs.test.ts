import { describe, expect, it } from "vitest";
import {
  breakMonths,
  compareLinksFor,
  chartSeries,
  formatMonth,
  formatSigned,
  groupsOf,
  linePath,
  monthToYear,
  pairCaveat,
  valueRange,
  type KnownIssue,
  type ModelVsObsFile,
  type Pair,
} from "./modelVsObs";

const issues: Record<string, KnownIssue> = {
  step: {
    kind: "discontinuity",
    summary_en: "Step of about +0.4 K.",
    source_doc: "docs/data/gldas-tair-check.md",
    issue_ref: "#74",
    break_months: ["2011-05-01"],
  },
  sampling: {
    kind: "sampling_change",
    summary_en: "Observations per day rose from 24 to 44.",
    source_doc: "docs/data/sources/ghcnh_taiwan.md",
  },
};

function pair(overrides: Partial<Pair> = {}): Pair {
  return {
    pair_id: "gldas_tair__station_temp__stn",
    group: "taiwan_station",
    location_id: "stn",
    model: {
      variable_id: "gldas_tair",
      source: "grid_cube_cell",
      location_id: "stn",
      known_issues: ["step"],
      detail: {},
    },
    obs: { variable_id: "station_temp", known_issues: ["sampling"] },
    known_issues: ["sampling", "step"],
    status: "analyzed",
    n_common_months: 300,
    first_common_month: "2001-01-01",
    last_common_month: "2025-12-01",
    ...overrides,
  };
}

describe("formatting", () => {
  it("writes signs with a real minus and a dash for no value", () => {
    expect(formatSigned(0.344)).toBe("+0.34");
    expect(formatSigned(-0.149)).toBe("−0.15");
    expect(formatSigned(-0.001)).toBe("0.00");
    expect(formatSigned(null)).toBe("—");
    expect(formatSigned(undefined)).toBe("—");
  });

  it("shortens months", () => {
    expect(formatMonth("2019-10-01")).toBe("2019-10");
    expect(formatMonth(null)).toBe("—");
  });
});

describe("pairCaveat", () => {
  it("names the sides and lists summaries and sources", () => {
    const caveat = pairCaveat(pair(), issues);
    expect(caveat?.summary).toBe(
      "Caution: the model and observation series has 2 known issues.",
    );
    expect(caveat?.details).toContain("Step of about +0.4 K.");
    expect(caveat?.details).toContain("24 to 44");
    expect(caveat?.sources).toBe(
      "docs/data/sources/ghcnh_taiwan.md; docs/data/gldas-tair-check.md (#74)",
    );
  });

  it("is null without known issues", () => {
    const clean = pair({ known_issues: [] });
    expect(pairCaveat(clean, issues)).toBeNull();
  });
});

describe("breakMonths", () => {
  it("collects verified step months of either series", () => {
    expect(breakMonths(pair(), issues)).toEqual(["2011-05-01"]);
    expect(breakMonths(pair({ known_issues: ["sampling"] }), issues)).toEqual(
      [],
    );
  });
});

describe("chartSeries", () => {
  it("uses monthly values when present", () => {
    const series = chartSeries(
      pair({
        monthly: {
          first_month: "2001-03-01",
          model_anomaly: [1, null],
          obs_anomaly: [0.5, 0.2],
          difference: [0.5, null],
        },
      }),
    );
    expect(series?.resolution).toBe("month");
    expect(series?.time[0]).toBeCloseTo(2001 + 2.5 / 12);
  });

  it("falls back to annual means", () => {
    const series = chartSeries(
      pair({
        annual: {
          first_year: 2001,
          model_anomaly: [1, 2],
          obs_anomaly: [0, 1],
          difference: [1, 1],
        },
      }),
    );
    expect(series?.resolution).toBe("year");
    expect(series?.time).toEqual([2001.5, 2002.5]);
    expect(chartSeries(pair())).toBeNull();
  });
});

describe("chart geometry", () => {
  it("makes a symmetric range rounded to whole or half degrees", () => {
    expect(
      valueRange({
        time: [0, 1],
        model: [1.2, null],
        obs: [-0.3, 0],
        difference: [0, 0],
        resolution: "month",
      }),
    ).toEqual([-2, 2]);
  });

  it("breaks the line at missing values", () => {
    const path = linePath(
      [0, 1, 2, 3],
      [1, 2, null, 4],
      (t) => t * 10,
      (v) => v,
    );
    expect(path).toBe("M0.0,1.0L10.0,2.0M30.0,4.0");
  });

  it("turns a month into fractional years", () => {
    expect(monthToYear("2011-05-01")).toBeCloseTo(2011 + 4 / 12);
  });
});

describe("groupsOf", () => {
  it("keeps the order of the file", () => {
    const file = {
      pairs: [pair(), pair({ group: "global" }), pair()],
    } as unknown as ModelVsObsFile;
    expect(groupsOf(file)).toEqual(["taiwan_station", "global"]);
  });
});

describe("compareLinksFor", () => {
  const pair = (
    pair_id: string,
    location_id: string,
    model: string,
    obs: string,
    status = "analyzed",
  ) =>
    ({
      pair_id,
      group: "world_city",
      location_id,
      status,
      model: { variable_id: model },
      obs: { variable_id: obs },
    }) as unknown as Parameters<typeof compareLinksFor>[0][number];
  const pairs = [
    pair(
      "merra2_t2m__gistemp_anom__tokyo",
      "tokyo",
      "merra2_t2m",
      "gistemp_anom",
    ),
    pair("merra2_t2m__ghcnm_tavg__tokyo", "tokyo", "merra2_t2m", "ghcnm_tavg"),
    pair(
      "gldas_tair__gistemp_anom__lagos",
      "lagos",
      "gldas_tair",
      "gistemp_anom",
    ),
    pair(
      "x__station_temp__taipei_station",
      "taipei_station",
      "merra2_t2m",
      "station_temp",
    ),
    pair("skipped", "cairo", "merra2_t2m", "ghcnm_tavg", "insufficient"),
  ];

  it("links each model variable to its pair at the place, station first", () => {
    expect(compareLinksFor(pairs, "tokyo", "/compare/")).toEqual({
      merra2_t2m: {
        href: "/compare/?group=world_city&pair=merra2_t2m__ghcnm_tavg__tokyo",
        label: "Compare with station",
      },
    });
  });

  it("names a gridded observation as observations, not a station", () => {
    expect(compareLinksFor(pairs, "lagos", "/compare/").gldas_tair?.label).toBe(
      "Compare with observations",
    );
  });

  it("finds the station pair of a Taiwan place and skips unanalyzed pairs", () => {
    expect(Object.keys(compareLinksFor(pairs, "taipei", "/c/"))).toEqual([
      "merra2_t2m",
    ]);
    expect(compareLinksFor(pairs, "cairo", "/c/")).toEqual({});
    expect(compareLinksFor(pairs, "global", "/c/")).toEqual({});
  });
});
