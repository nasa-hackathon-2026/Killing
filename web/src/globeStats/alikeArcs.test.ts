import { describe, expect, it } from "vitest";
import type { Place } from "../snapshot/places";
import type { SimilarSeriesFile } from "../analysis/miningPlus";
import { buildAlikeArcs } from "./alikeArcs";

function entry(
  series: string,
  overrides: Partial<
    SimilarSeriesFile["results"][string]["most_similar"][number]
  > = {},
) {
  return {
    series,
    cosine: 0.8,
    cosine_detrended: 0.6,
    n_eff: 120,
    q: 0.01,
    significant: true,
    q_detrended: 0.02,
    significant_detrended: true,
    trend_sensitive: false,
    ...overrides,
  };
}

const places: Place[] = [
  {
    id: "taipei",
    nameEn: "Taipei",
    group: "taiwan",
    lat: 25,
    lon: 121,
    aggregation: "point",
  },
  {
    id: "sydney",
    nameEn: "Sydney",
    group: "world_city",
    lat: -34,
    lon: 151,
    aggregation: "point",
  },
];

const similar: SimilarSeriesFile = {
  note: "",
  parameters: { alpha: 0.05 },
  methods: {},
  window: { first_month: "2001-01", last_month: "2025-12", n_months: 300 },
  summary: {
    n_series: 2,
    n_series_by_group: {},
    n_candidate_pairs: 2,
    n_candidate_pairs_significant: 1,
    n_candidate_pairs_significant_detrended: 1,
    n_listed: 2,
    n_listed_significant: 1,
    n_listed_significant_detrended: 1,
    n_listed_trend_sensitive: 1,
  },
  variable_names: { temperature: "Temperature", rain: "Rain" },
  locations: {
    taipei: { name_en: "Taipei", group: "taiwan" },
    sydney: { name_en: "Sydney", group: "world_city" },
    global: { name_en: "Global", group: "global" },
  },
  series: {
    source: {
      variable_id: "temperature",
      location_id: "taipei",
      aggregation: "point",
      known_issues: [],
      n_filled: 300,
      z: [],
    },
    local: {
      variable_id: "rain",
      location_id: "taipei",
      aggregation: "point",
      known_issues: [],
      n_filled: 300,
      z: [],
    },
    target: {
      variable_id: "rain",
      location_id: "sydney",
      aggregation: "point",
      known_issues: [],
      n_filled: 300,
      z: [],
    },
    global: {
      variable_id: "rain",
      location_id: "global",
      aggregation: "area_mean_grid",
      known_issues: [],
      n_filled: 300,
      z: [],
    },
  },
  results: {
    source: {
      most_similar: [
        entry("local"),
        entry("target", {
          cosine: -0.7,
          cosine_detrended: -0.1,
          significant_detrended: false,
          trend_sensitive: true,
        }),
        entry("global"),
      ],
      least_similar: [],
    },
  },
  check: { pgvector_matches_numpy: true, tolerance: 0 },
};

describe("places that move alike", () => {
  it("maps listed series to places, marks sign and detrending, and keeps non-place rows table-only", () => {
    const arcs = buildAlikeArcs(similar, places, "taipei", "temperature");

    expect(
      arcs.map((arc) => [arc.targetLocationId, arc.targetVariableId]),
    ).toEqual([
      ["taipei", "rain"],
      ["sydney", "rain"],
      ["global", "rain"],
    ]);
    expect(arcs[0]).toMatchObject({ samePlace: true, draw: false });
    expect(arcs[1]).toMatchObject({
      samePlace: false,
      draw: true,
      positive: false,
      dashed: true,
      cosine: -0.7,
      detrendedCosine: -0.1,
    });
    expect(arcs[2]).toMatchObject({
      targetLat: null,
      targetLon: null,
      draw: false,
    });
  });
});
