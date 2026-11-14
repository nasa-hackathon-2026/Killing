import { describe, expect, it } from "vitest";
import {
  filterRules,
  formatItem,
  formatParameter,
  formatRule,
  formatShare,
  loadMining,
  nextSort,
  sortRules,
  type Rule,
} from "./mining";

function rule(
  antecedents: string[],
  consequent: string,
  support: number,
  confidence: number,
  lift: number,
  sameVariable = false,
): Rule {
  return {
    antecedents,
    consequent,
    support,
    confidence,
    lift,
    same_variable: sameVariable,
  };
}

const rules = [
  rule(["imerg_precip=high"], "gldas_soilmoist=high", 0.12, 0.8, 2.4),
  rule(["prev:omi_o3=low"], "omi_o3=low", 0.18, 0.68, 2.55, true),
  rule(["airs_tsurf=low", "gldas_tair=low"], "merra2_t2m=low", 0.15, 0.87, 2.6),
];

describe("formatItem", () => {
  it("writes the variable and its state", () => {
    expect(formatItem("imerg_precip=high")).toBe("imerg_precip high");
  });

  it("marks an item taken from the previous month", () => {
    expect(formatItem("prev:omi_o3=low")).toBe("omi_o3 low (previous month)");
  });
});

describe("formatRule", () => {
  it("joins the antecedents and points to the consequent", () => {
    expect(formatRule(rules[2]!)).toBe(
      "airs_tsurf low + gldas_tair low → merra2_t2m low",
    );
  });
});

describe("formatShare", () => {
  it("shows a fraction as a percentage with one decimal", () => {
    expect(formatShare(0.125)).toBe("12.5%");
    expect(formatShare(1)).toBe("100.0%");
  });
});

describe("sortRules", () => {
  it("orders by a numeric column in either direction", () => {
    const descending = sortRules(rules, { key: "lift", descending: true });
    const ascending = sortRules(rules, { key: "support", descending: false });

    expect(descending.map((item) => item.lift)).toEqual([2.6, 2.55, 2.4]);
    expect(ascending.map((item) => item.support)).toEqual([0.12, 0.15, 0.18]);
  });

  it("orders by the rule text", () => {
    const sorted = sortRules(rules, { key: "rule", descending: false });

    expect(sorted.map((item) => item.consequent)).toEqual([
      "merra2_t2m=low",
      "gldas_soilmoist=high",
      "omi_o3=low",
    ]);
  });

  it("leaves the input array untouched", () => {
    sortRules(rules, { key: "confidence", descending: true });

    expect(rules.map((item) => item.lift)).toEqual([2.4, 2.55, 2.6]);
  });
});

describe("nextSort", () => {
  it("flips the direction when the same column is clicked again", () => {
    expect(nextSort({ key: "lift", descending: true }, "lift")).toEqual({
      key: "lift",
      descending: false,
    });
  });

  it("starts a numeric column from the largest value and text from A", () => {
    const current = { key: "lift", descending: false } as const;

    expect(nextSort(current, "support")).toEqual({
      key: "support",
      descending: true,
    });
    expect(nextSort(current, "rule")).toEqual({
      key: "rule",
      descending: false,
    });
  });
});

describe("filterRules", () => {
  it("can hide rules whose consequent variable is also an antecedent", () => {
    expect(filterRules(rules, true)).toHaveLength(2);
    expect(filterRules(rules, false)).toHaveLength(3);
  });
});

describe("formatParameter", () => {
  it("shortens long fractions and lists arrays", () => {
    expect(formatParameter(0.3333333333)).toBe("0.3333");
    expect(formatParameter(["power_t2m", "modis_ndvi_pc"])).toBe(
      "power_t2m, modis_ndvi_pc",
    );
    expect(formatParameter([])).toBe("none");
    expect(formatParameter(null)).toBe("none");
    expect(formatParameter(3)).toBe("3");
  });
});

describe("loadMining", () => {
  it("reads both result files from the analysis folder", async () => {
    const urls: string[] = [];
    const loaded = await loadMining(<T>(url: string) => {
      urls.push(url);
      return Promise.resolve({ file: url.split("/").at(-1) } as T);
    });

    expect(urls.map((url) => url.split("/").slice(-3).join("/"))).toEqual([
      "data/analysis/fpgrowth.json",
      "data/analysis/decision_tree.json",
    ]);
    expect(loaded.rules).toEqual({ file: "fpgrowth.json" });
    expect(loaded.tree).toEqual({ file: "decision_tree.json" });
  });
});
