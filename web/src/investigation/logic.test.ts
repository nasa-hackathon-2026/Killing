import { describe, expect, it } from "vitest";
import type { AnalyzedTrend, TrendEntry } from "../analysis/trends";
import { layerRegistry } from "../layers/registry";
import {
  agreement,
  fdrFamily,
  groupOf,
  nextTab,
  parseTab,
  QUESTION_GROUPS,
  verdictOf,
} from "./logic";

function entry(
  olsSignificant: boolean,
  slope: number,
  mk: { significant: boolean | null; p: number | null; z?: number },
  seasonal: { significant: boolean | null; p: number | null; z?: number } = {
    significant: false,
    p: 0.5,
    z: 0,
  },
): TrendEntry {
  const test = (significant: boolean | null, p: number | null) => ({
    p,
    p_fdr: p,
    significant,
    significant_fdr: significant,
  });
  const trend: AnalyzedTrend = {
    status: "analyzed",
    unit: "K",
    data: { first_month: "2001-01-01", last_month: "2020-12-01", n_valid: 240 },
    ols: {
      ...test(olsSignificant, olsSignificant ? 0.01 : 0.4),
      slope_per_decade: slope,
      ci_per_decade: [slope - 1, slope + 1],
    },
    mann_kendall: {
      original: test(false, 0.5),
      hamed_rao: { ...test(mk.significant, mk.p), z: mk.z } as never,
      seasonal: {
        ...test(seasonal.significant, seasonal.p),
        z: seasonal.z,
      } as never,
    },
    sen: { slope_per_decade: slope, ci_per_decade: [slope - 1, slope + 1] },
  };
  return trend;
}

describe("tabs", () => {
  it("reads the tab parameter with 'what' as the fallback", () => {
    expect(parseTab("howmuch")).toBe("howmuch");
    expect(parseTab("nope")).toBe("what");
    expect(parseTab(null)).toBe("what");
  });

  it("moves with arrow keys and wraps", () => {
    expect(nextTab("what", "ArrowRight")).toBe("where");
    expect(nextTab("what", "ArrowLeft")).toBe("significant");
    expect(nextTab("significant", "ArrowRight")).toBe("what");
    expect(nextTab("where", "End")).toBe("significant");
    expect(nextTab("where", "Home")).toBe("what");
    expect(nextTab("where", "a")).toBeNull();
  });
});

describe("question groups", () => {
  it("puts every layer variable in exactly one group", () => {
    for (const layer of layerRegistry) {
      const groups = QUESTION_GROUPS.filter((group) =>
        group.variables.includes(layer.id),
      );
      expect(
        groups.map((group) => group.id),
        layer.id,
      ).toHaveLength(1);
    }
  });

  it("lists only layer variables", () => {
    const ids = new Set(layerRegistry.map((layer) => layer.id));
    for (const group of QUESTION_GROUPS) {
      for (const id of group.variables) expect(ids.has(id), id).toBe(true);
    }
  });

  it("follows the three sticky-note groups", () => {
    expect(groupOf("imerg_precip")?.id).toBe("water");
    expect(groupOf("gldas_soilmoist")?.id).toBe("water");
    expect(groupOf("gldas_evap")?.id).toBe("water");
    expect(groupOf("merra2_t2m")?.id).toBe("heat");
    expect(groupOf("modis_lst")?.id).toBe("heat");
    expect(groupOf("omi_no2")?.id).toBe("air");
    expect(groupOf("unknown")).toBeUndefined();
  });
});

describe("agreement of the linear and Mann-Kendall tests", () => {
  it("agrees when both are significant in the same direction", () => {
    expect(
      agreement(entry(true, 0.3, { significant: true, p: 0.01, z: 2 })),
    ).toBe("bothSame");
  });

  it("agrees when neither is significant", () => {
    expect(
      agreement(entry(false, 0.3, { significant: false, p: 0.3, z: 1 })),
    ).toBe("bothNone");
  });

  it("disagrees when only one is significant", () => {
    expect(
      agreement(entry(true, 0.3, { significant: false, p: 0.3, z: 1 })),
    ).toBe("disagree");
    expect(
      agreement(entry(false, 0.3, { significant: true, p: 0.01, z: 3 })),
    ).toBe("disagree");
  });

  it("disagrees when both are significant in opposite directions", () => {
    expect(
      agreement(entry(true, 0.3, { significant: true, p: 0.01, z: -3 })),
    ).toBe("disagree");
  });

  it("falls back to the seasonal test when Hamed-Rao has no p value", () => {
    expect(
      agreement(
        entry(
          true,
          -0.3,
          { significant: null, p: null },
          { significant: true, p: 0.02, z: -2 },
        ),
      ),
    ).toBe("bothSame");
  });

  it("is unknown without an analysed result", () => {
    expect(agreement(undefined)).toBe("unknown");
    expect(
      agreement({
        status: "insufficient",
        unit: "K",
        reason: { code: "x", text_en: "x" },
      }),
    ).toBe("unknown");
    expect(
      agreement(
        entry(
          true,
          0.3,
          { significant: null, p: null },
          { significant: null, p: null },
        ),
      ),
    ).toBe("unknown");
  });
});

describe("verdict lights", () => {
  it("separates after-FDR, before-FDR-only and not significant", () => {
    const base = { p: 0.01, p_fdr: 0.02 };
    expect(
      verdictOf({ ...base, significant: true, significant_fdr: true }),
    ).toBe("significant");
    expect(
      verdictOf({ ...base, significant: true, significant_fdr: false }),
    ).toBe("rawOnly");
    expect(
      verdictOf({ ...base, significant: false, significant_fdr: false }),
    ).toBe("notSignificant");
    expect(
      verdictOf({
        p: null,
        p_fdr: null,
        significant: null,
        significant_fdr: null,
      }),
    ).toBe("none");
  });
});

describe("FDR family", () => {
  it("is the world subset for its keys and the core run otherwise", () => {
    const world = new Set(["a__london__point"]);
    const sizes = { core: 130, world: 128 };
    expect(fdrFamily("a__london__point", world, sizes)).toEqual({
      scope: "world",
      size: 128,
    });
    expect(fdrFamily("a__taichung__point", world, sizes)).toEqual({
      scope: "core",
      size: 130,
    });
  });
});
