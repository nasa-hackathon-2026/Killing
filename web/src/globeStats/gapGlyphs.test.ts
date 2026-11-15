import { describe, expect, it } from "vitest";
import type { ModelVsObsFile, Pair } from "../analysis/modelVsObs";
import { buildGapGlyphs } from "./gapGlyphs";

function pair(overrides: Partial<Pair> = {}): Pair {
  return {
    pair_id: "gldas_tair__ghcnm_tavg__london",
    group: "world_city",
    location_id: "london",
    model: {
      variable_id: "gldas_tair",
      source: "series",
      location_id: "london",
      known_issues: [],
      detail: {},
    },
    obs: { variable_id: "ghcnm_tavg", known_issues: [] },
    known_issues: [],
    status: "analyzed",
    n_common_months: 300,
    first_common_month: "2001-01-01",
    last_common_month: "2025-12-01",
    correlation: 0.8,
    model_trend: { slope_per_decade: 0.3, ci_per_decade: [0.2, 0.4], p: 0.01 },
    obs_trend: { slope_per_decade: 0.2, ci_per_decade: [0.1, 0.3], p: 0.02 },
    difference: {
      mean: 0,
      sd: 0.4,
      rmse: 0.4,
      trend: {
        slope_per_decade: 0,
        ci_per_decade: [-0.1, 0.1],
        p: 0.5,
        significant: false,
      },
      largest_step: null,
      largest_step_month: null,
    },
    ...overrides,
  };
}

function file(pairs: Pair[]): ModelVsObsFile {
  return {
    parameters: { window_start: "2001-01", window_end: "2025-12", alpha: 0.05 },
    note: "",
    summary: { n_pairs: pairs.length, n_pairs_by_group: {} },
    known_issues: {
      step: {
        kind: "discontinuity",
        summary_en: "documented model step",
        source_doc: "check.md",
      },
      observation_gap: {
        kind: "sampling_change",
        summary_en: "documented station sampling change",
        source_doc: "check.md",
      },
    },
    variables: {
      gldas_tair: {
        name_en: "Model temperature",
        unit: "K",
        data_kind: "model",
      },
      ghcnm_tavg: {
        name_en: "Adjusted station temperature",
        unit: "degC",
        data_kind: "in_situ",
      },
      ghcnm_tavg_unadj: {
        name_en: "Unadjusted station temperature",
        unit: "degC",
        data_kind: "in_situ",
      },
      gistemp_anom: {
        name_en: "Gridded temperature",
        unit: "K",
        data_kind: "in_situ",
      },
    },
    locations: {
      london: { name_en: "London", lat: 51.5, lon: -0.1 },
      global: { name_en: "Global", lat: null, lon: null },
    },
    skipped: [],
    pairs,
  };
}

describe("model–station globe glyphs", () => {
  it("uses the adjusted station pair at the recorded place coordinates and encodes disagreement", () => {
    const glyphs = buildGapGlyphs(
      file([
        pair({
          pair_id: "unadjusted",
          obs: { variable_id: "ghcnm_tavg_unadj", known_issues: [] },
          correlation: 0.2,
        }),
        pair({ pair_id: "adjusted", correlation: 0.8 }),
        pair({
          pair_id: "gridded",
          obs: { variable_id: "gistemp_anom", known_issues: [] },
        }),
      ]),
      "gldas_tair",
    );

    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toMatchObject({
      pairId: "adjusted",
      placeName: "London",
      lat: 51.5,
      lon: -0.1,
      modelSlope: 0.3,
      observationSlope: 0.2,
    });
    expect(glyphs[0]?.disagreement).toBeCloseTo(0.2);
  });

  it("keeps issue flags separate for the model and observed halves", () => {
    const [glyph] = buildGapGlyphs(
      file([
        pair({
          model: {
            variable_id: "gldas_tair",
            source: "series",
            location_id: "london",
            known_issues: ["step"],
            detail: {},
          },
          obs: { variable_id: "ghcnm_tavg", known_issues: ["observation_gap"] },
          known_issues: ["step", "observation_gap"],
        }),
      ]),
      "gldas_tair",
    );

    expect(glyph).toMatchObject({
      modelUnreliable: true,
      observationUnreliable: true,
    });
    expect(glyph?.summary).toContain("not reliable as a climate signal");
  });
});
