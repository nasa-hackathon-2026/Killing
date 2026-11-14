import { describe, expect, it } from "vitest";
import {
  foldVerdict,
  formatExcluded,
  formatFeature,
  formatItem,
  formatParameter,
  formatQ,
  formatRule,
  formatShare,
  formatTopRules,
  labelTreeText,
  loadMining,
  nextSort,
  ruleComparisonRows,
  sortRules,
  visibleRules,
  type Fold,
  type FpGrowthFile,
  type Rule,
  type RuleSet,
} from "./mining";

const names = {
  imerg_precip: "Precipitation (GPM IMERG Final)",
  omi_o3: "Total column ozone (OMI)",
};

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
    p: 0.001,
    q: 0.002,
    same_variable: sameVariable,
  };
}

const rules = [
  rule(["imerg_precip=high"], "gldas_soilmoist=high", 0.12, 0.8, 2.4),
  rule(["prev:omi_o3=low"], "omi_o3=low", 0.18, 0.68, 2.55, true),
  rule(["airs_tsurf=low", "gldas_tair=low"], "merra2_t2m=low", 0.15, 0.87, 2.6),
];

describe("formatItem", () => {
  it("writes the variable name and its state", () => {
    expect(formatItem("imerg_precip=high", names)).toBe(
      "Precipitation (GPM IMERG Final) high",
    );
  });

  it("marks an item taken from the previous month", () => {
    expect(formatItem("prev:omi_o3=low", names)).toBe(
      "Total column ozone (OMI) low (previous month)",
    );
  });

  it("falls back to the id when the variable has no name", () => {
    expect(formatItem("mystery=low", names)).toBe("mystery low");
  });
});

describe("formatRule", () => {
  it("joins the antecedents and points to the consequent", () => {
    expect(
      formatRule(
        rule(["imerg_precip=high", "x=low"], "omi_o3=low", 0, 0, 0),
        names,
      ),
    ).toBe(
      "Precipitation (GPM IMERG Final) high + x low → Total column ozone (OMI) low",
    );
  });
});

describe("formatFeature", () => {
  it("names a feature and marks the previous month", () => {
    expect(formatFeature("omi_o3", names)).toBe("Total column ozone (OMI)");
    expect(formatFeature("prev:omi_o3", names)).toBe(
      "Total column ozone (OMI) (previous month)",
    );
  });
});

describe("labelTreeText", () => {
  it("replaces feature ids in the split lines only", () => {
    const text = [
      "if prev:omi_o3 <= 1.5:",
      "  if imerg_precip <= -0.2:",
      "    -> low (n = 20: high 1, low 15, normal 4)",
      "else:",
      "  -> high (n = 30: high 20, low 5, normal 5)",
    ].join("\n");

    expect(labelTreeText(text, names).split("\n")).toEqual([
      "if Total column ozone (OMI) (previous month) <= 1.5:",
      "  if Precipitation (GPM IMERG Final) <= -0.2:",
      "    -> low (n = 20: high 1, low 15, normal 4)",
      "else:",
      "  -> high (n = 30: high 20, low 5, normal 5)",
    ]);
  });
});

describe("formatQ", () => {
  it("shows three decimals and a floor for very small values", () => {
    expect(formatQ(0.0312)).toBe("0.031");
    expect(formatQ(0.001)).toBe("0.001");
    expect(formatQ(3.2e-15)).toBe("<0.001");
  });
});

describe("formatExcluded", () => {
  it("says which kept variable it duplicates and how strongly", () => {
    expect(
      formatExcluded(
        {
          variable_id: "omi_o3",
          correlated_with: "imerg_precip",
          correlation: -0.8581,
          n_pairs: 1008,
        },
        names,
      ),
    ).toBe(
      "Total column ozone (OMI) (correlation -0.858 with Precipitation (GPM IMERG Final), 1008 location-months)",
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
    // By displayed name: "airs_tsurf…", "Precipitation…", "Total column ozone…"
    const sorted = sortRules(rules, { key: "rule", descending: false }, names);

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
    // Small q first
    expect(nextSort(current, "q")).toEqual({ key: "q", descending: false });
  });
});

describe("visibleRules", () => {
  const set = {
    rules: [rules[0]!, rules[2]!],
    persistence_rules: [rules[1]!],
  } as RuleSet;

  it("hides same-variable persistence rules unless asked", () => {
    expect(visibleRules(set, false)).toEqual([rules[0], rules[2]]);
    expect(visibleRules(set, true)).toEqual([rules[0], rules[2], rules[1]]);
  });
});

function fold(
  test: number,
  trainMajority: number,
  testMajority: number,
  persistence: number,
): Fold {
  return {
    accuracy: { train: 0.9, test },
    baselines: {
      train_majority: {
        predicted_class: "low",
        tie: false,
        test_accuracy: trainMajority,
      },
      test_majority: { predicted_class: "high", test_accuracy: testMajority },
      persistence: { test_accuracy: persistence },
    },
    above_train_majority: test > trainMajority,
    above_test_majority: test > testMajority,
    above_persistence: test > persistence,
  } as Fold;
}

describe("foldVerdict", () => {
  it("says plainly which baselines the tree is not above", () => {
    expect(foldVerdict(fold(0.6, 0.3, 0.4, 0.5))).toBe(
      "above all three baselines",
    );
    expect(foldVerdict(fold(0.45, 0.3, 0.4, 0.5))).toBe(
      "not above: persistence guess",
    );
    expect(foldVerdict(fold(0.35, 0.3, 0.4, 0.5))).toBe(
      "not above: test-majority guess, persistence guess",
    );
    expect(foldVerdict(fold(0.2, 0.3, 0.4, 0.5))).toBe(
      "not above: training-majority guess, test-majority guess, persistence guess",
    );
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
    expect(formatParameter(true)).toBe("yes");
    expect(formatParameter(false)).toBe("no");
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

describe("gap filling comparison", () => {
  const comparison = {
    n_transactions: { filled: 100, unfilled: 100 },
    n_candidate_rules: { filled: 12, unfilled: 11 },
    n_rules: { filled: 12, unfilled: 11 },
    n_listed_rules_in_both: 11,
    top_rules_compared: 10,
    top_rules_same_set: true,
    top_rules_same_order: true,
  };

  it("lists one row per table and timing", () => {
    const file = {
      gap_filling_sensitivity: {
        primary: "filled",
        compared_with: "unfilled",
        tables: {
          region: {
            n_missing_cells: { filled: 0, unfilled: 28 },
            same_month: comparison,
            lagged_one_month: { ...comparison, top_rules_compared: 0 },
          },
        },
      },
    } as unknown as FpGrowthFile;

    const rows = ruleComparisonRows(file);
    expect(rows.map((row) => [row.table, row.timing])).toEqual([
      ["region", "same month"],
      ["region", "previous month → this month"],
    ]);
    expect(rows[0]?.comparison.n_rules.filled).toBe(12);
  });

  it("is empty for a file written before the comparison existed", () => {
    expect(ruleComparisonRows({} as FpGrowthFile)).toEqual([]);
  });

  it("says whether the top rules agree", () => {
    expect(formatTopRules(comparison)).toBe("same rules, same order");
    expect(formatTopRules({ ...comparison, top_rules_same_order: false })).toBe(
      "same rules, different order",
    );
    expect(
      formatTopRules({
        ...comparison,
        top_rules_same_order: false,
        top_rules_same_set: false,
      }),
    ).toBe("different rules");
    expect(formatTopRules({ ...comparison, top_rules_compared: 0 })).toBe(
      "no rules",
    );
  });
});
