import { describe, expect, it } from "vitest";
import seed from "../../../data/seed/cleaning.json";
import {
  ISSUE_KIND_AFFECTS_TREND,
  issueAffectsTrend,
  trendUnreliable,
} from "./trendReliability";
import type { TrendEntry } from "./trends";

const test = { p: 0, p_fdr: 0, significant: true, significant_fdr: true };

function analyzed(known_issues?: string[]): TrendEntry {
  return {
    status: "analyzed",
    unit: "K",
    data: { first_month: "2001-01-01", last_month: "2026-06-01", n_valid: 300 },
    ols: { ...test, slope_per_decade: 2.08, ci_per_decade: [1.5, 2.6] },
    mann_kendall: { original: test, hamed_rao: test, seasonal: test },
    sen: { slope_per_decade: 2, ci_per_decade: [1.5, 2.5] },
    known_issues,
  };
}

const issues = {
  step: { kind: "discontinuity" },
  sign: { kind: "product_disagreement" },
  gap: { kind: "missing_composites" },
  other: { kind: "something_new" },
};

describe("issueAffectsTrend", () => {
  it("counts steps, sampling changes and sign disagreements between products", () => {
    expect(issueAffectsTrend("discontinuity")).toBe(true);
    expect(issueAffectsTrend("sampling_change")).toBe(true);
    expect(issueAffectsTrend("product_disagreement")).toBe(true);
    expect(issueAffectsTrend("auxiliary")).toBe(true);
  });

  it("does not count gaps in the record or an unknown kind", () => {
    expect(issueAffectsTrend("missing_composites")).toBe(false);
    expect(issueAffectsTrend("no_data")).toBe(false);
    expect(issueAffectsTrend("something_new")).toBe(false);
  });

  // A new kind in the seed must be given a row here, on purpose.
  it("has a row for every kind used in data/seed/cleaning.json", () => {
    const kinds = [...new Set(seed.known_issues.map((issue) => issue.kind))];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(ISSUE_KIND_AFFECTS_TREND, kind).toHaveProperty(kind);
    }
  });

  it("classifies the issues of the seed as documented", () => {
    const byVariable = (affects: boolean) =>
      [
        ...new Set(
          seed.known_issues
            .filter((issue) => issueAffectsTrend(issue.kind) === affects)
            .map((issue) => issue.kind),
        ),
      ].sort();
    expect(byVariable(true)).toEqual([
      "auxiliary",
      "discontinuity",
      "product_disagreement",
      "sampling_change",
    ]);
    expect(byVariable(false)).toEqual(["missing_composites", "no_data"]);
  });
});

describe("trendUnreliable", () => {
  it("is true when any listed issue affects trends", () => {
    expect(trendUnreliable(analyzed(["step"]), issues)).toBe(true);
    expect(trendUnreliable(analyzed(["gap", "sign"]), issues)).toBe(true);
  });

  it("is false for gaps only, unknown ids, no issues or no table", () => {
    expect(trendUnreliable(analyzed(["gap"]), issues)).toBe(false);
    expect(trendUnreliable(analyzed(["other", "missing"]), issues)).toBe(false);
    expect(trendUnreliable(analyzed(), issues)).toBe(false);
    expect(trendUnreliable(analyzed(["step"]), undefined)).toBe(false);
    expect(trendUnreliable(undefined, issues)).toBe(false);
  });

  it("is false for a series that was not analyzed", () => {
    expect(
      trendUnreliable(
        {
          status: "insufficient",
          unit: "K",
          reason: { code: "x", text_en: "x" },
        },
        issues,
      ),
    ).toBe(false);
  });
});
