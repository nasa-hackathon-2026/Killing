// Exploratory mining results written by
// `uv run python -m trend_detective.mining` (data/analysis/fpgrowth.json and
// decision_tree.json). This module only reads, sorts and formats them.
import { analysisUrl } from "./trends";

export type VariableNames = Record<string, string>;

export type Rule = {
  antecedents: string[];
  consequent: string;
  support: number;
  confidence: number;
  lift: number;
  // One-sided Fisher exact test, and its Benjamini-Hochberg corrected value
  p: number;
  q: number;
  same_variable: boolean;
};

export type RuleSet = {
  n_transactions: number;
  n_frequent_itemsets: number;
  n_candidate_rules: number;
  n_rules: number;
  rules: Rule[];
  // Lagged rules whose right-side variable is also on the left
  n_persistence_rules: number;
  persistence_rules: Rule[];
};

export type ExcludedVariable = {
  variable_id: string;
  correlated_with: string;
  correlation: number;
  n_pairs: number;
};

export type RuleTable = {
  locations: string[];
  variables: string[];
  first_month: string | null;
  last_month: string | null;
  n_missing_cells: number;
  n_cells: number;
  dropped_series: { variable_id: string; location_id: string }[];
  excluded_variables: ExcludedVariable[];
  same_month: RuleSet;
  lagged_one_month: RuleSet;
  // Months filled on the anomaly inside the table period (absent in older files)
  gap_filling?: {
    n_filled_linear: number;
    n_filled_climatology: number;
    n_series_with_filled_months: number;
  };
};

// The same run with and without gap filling; keys are "filled" and "unfilled"
export type RunPair = Record<string, number>;

export type RuleComparison = {
  n_transactions: RunPair;
  n_candidate_rules: RunPair;
  n_rules: RunPair;
  n_listed_rules_in_both: number;
  top_rules_compared: number;
  top_rules_same_set: boolean;
  top_rules_same_order: boolean;
};

export type TableComparison = {
  n_missing_cells: RunPair;
  same_month: RuleComparison;
  lagged_one_month: RuleComparison;
};

// The same run with and without cutting series at verified step months
export type SegmentationComparison = {
  segmented_series: {
    variable_id: string;
    location_id: string;
    break_months: string[];
  }[];
  same_month: RuleComparison;
  lagged_one_month: RuleComparison;
};

export type TreeDigest = {
  n_complete_rows: number;
  folds: {
    fold: number;
    n_train: number;
    n_test: number;
    test_accuracy: number;
    train_majority_accuracy: number;
    test_majority_accuracy: number;
    persistence_accuracy: number;
  }[];
  summary: { mean_test_accuracy: number; n_folds_above_all: number };
};

export type Parameters = Record<
  string,
  number | string | boolean | string[] | null
>;

type FileHeader = {
  exploratory: boolean;
  note: string;
  detrending_note: string;
  input: { snapshot_generated_at: string };
  parameters: Parameters;
  variable_names: VariableNames;
};

export type FpGrowthFile = FileHeader & {
  significance_note: string;
  tables: Record<string, RuleTable>;
  gap_filling_note?: string;
  gap_filling_sensitivity?: {
    primary: string;
    compared_with: string;
    tables: Record<string, TableComparison>;
  };
  segmentation_sensitivity?: {
    note: string;
    primary: string;
    compared_with: string;
    tables: Record<string, SegmentationComparison>;
  };
};

export type ClassCounts = Record<string, number>;

export type Fold = {
  fold: number;
  train_first_month: string;
  train_last_month: string;
  test_first_month: string;
  test_last_month: string;
  n_train: number;
  n_test: number;
  class_counts: { train: ClassCounts; test: ClassCounts };
  accuracy: { train: number; test: number };
  baselines: {
    // Always guess the most common class of the training months
    train_majority: {
      predicted_class: string;
      tie: boolean;
      test_accuracy: number;
    };
    // Always guess the most common class of the test months (hindsight)
    test_majority: { predicted_class: string; test_accuracy: number };
    // Guess that the target stays in last month's state
    persistence: { test_accuracy: number };
  };
  above_train_majority: boolean;
  above_test_majority: boolean;
  above_persistence: boolean;
  confusion_matrix_test: Record<string, ClassCounts>;
  feature_importances: { feature: string; importance: number }[];
  tree_text: string;
};

export type DecisionTreeFile = FileHeader & {
  table: string;
  target: string;
  target_classes: string[];
  features: string[];
  rows_by_location: Record<
    string,
    { n_rows: number; n_complete_rows: number; missing_variables: string[] }
  >;
  excluded_variables: ExcludedVariable[];
  // Same physical quantity as the target, so never used as features
  same_quantity_excluded: string[];
  validation: { n_folds: number; min_train_months: number };
  folds: Fold[];
  summary: {
    n_folds: number;
    n_folds_above_all: number;
    above_all_in_every_fold: boolean;
    mean_test_accuracy: number;
    mean_train_majority_accuracy: number;
    mean_test_majority_accuracy: number;
    mean_persistence_accuracy: number;
    text_en: string;
  };
  gap_filling_sensitivity?: {
    primary: string;
    compared_with: string;
    filled?: TreeDigest;
    unfilled?: TreeDigest;
  };
  segmentation_sensitivity?: {
    primary: string;
    compared_with: string;
    segmented?: TreeDigest;
    unsegmented?: TreeDigest;
  };
};

export type MiningResults = {
  rules: FpGrowthFile;
  tree: DecisionTreeFile;
};

export type RuleSortKey = "rule" | "support" | "confidence" | "lift" | "q";

export type RuleSort = { key: RuleSortKey; descending: boolean };

export async function loadMining(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<MiningResults> {
  const [rules, tree] = await Promise.all([
    fetchJson<FpGrowthFile>(analysisUrl("fpgrowth.json")),
    fetchJson<DecisionTreeFile>(analysisUrl("decision_tree.json")),
  ]);
  return { rules, tree };
}

function nameOf(variable: string, names: VariableNames): string {
  return names[variable] ?? variable;
}

// "prev:omi_o3=low" → "Total column ozone (OMI) low (previous month)"
export function formatItem(item: string, names: VariableNames): string {
  const lagged = item.startsWith("prev:");
  const [variable = "", state] = (lagged ? item.slice(5) : item).split("=");
  return `${nameOf(variable, names)} ${state}${lagged ? " (previous month)" : ""}`;
}

export function formatRule(rule: Rule, names: VariableNames): string {
  const left = rule.antecedents.map((item) => formatItem(item, names));
  return `${left.join(" + ")} → ${formatItem(rule.consequent, names)}`;
}

// A decision tree feature: "prev:omi_o3" is last month's value of omi_o3.
export function formatFeature(feature: string, names: VariableNames): string {
  return feature.startsWith("prev:")
    ? `${nameOf(feature.slice(5), names)} (previous month)`
    : nameOf(feature, names);
}

// The tree is written as indented "if <feature> <= <threshold>:" lines.
export function labelTreeText(text: string, names: VariableNames): string {
  return text.replace(
    /^(\s*if )(\S+)( <= )/gm,
    (_, start: string, feature: string, end: string) =>
      `${start}${formatFeature(feature, names)}${end}`,
  );
}

export function formatQ(q: number): string {
  return q < 0.001 ? "<0.001" : q.toFixed(3);
}

export function formatExcluded(
  item: ExcludedVariable,
  names: VariableNames,
): string {
  return (
    `${nameOf(item.variable_id, names)} (correlation ` +
    `${item.correlation.toFixed(3)} with ` +
    `${nameOf(item.correlated_with, names)}, ${item.n_pairs} location-months)`
  );
}

export function foldVerdict(fold: Fold): string {
  const notAbove = [
    fold.above_train_majority ? null : "training-majority guess",
    fold.above_test_majority ? null : "test-majority guess",
    fold.above_persistence ? null : "persistence guess",
  ].filter((name) => name !== null);
  return notAbove.length
    ? `not above: ${notAbove.join(", ")}`
    : "above all three baselines";
}

export function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Clicking the active column flips its direction; a new column starts with
// the largest values first (text starts A to Z, q starts with the smallest).
export function nextSort(current: RuleSort, key: RuleSortKey): RuleSort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key !== "rule" && key !== "q" };
}

export function sortRules(
  rules: Rule[],
  sort: RuleSort,
  names: VariableNames = {},
): Rule[] {
  const direction = sort.descending ? -1 : 1;
  const key = sort.key;
  return [...rules].sort((a, b) => {
    const order =
      key === "rule"
        ? formatRule(a, names).localeCompare(formatRule(b, names))
        : a[key] - b[key];
    return order * direction;
  });
}

// Rules never have the same variable on both sides. Lagged rules that only
// say "a variable stays in its state" are kept apart and hidden by default.
export function visibleRules(set: RuleSet, showPersistence: boolean): Rule[] {
  return showPersistence ? [...set.rules, ...set.persistence_rules] : set.rules;
}

export type RuleComparisonRow = {
  table: string;
  timing: string;
  comparison: RuleComparison;
};

// One row per table and timing of a sensitivity comparison (gap filling by
// default, or the segmented-against-unsegmented one).
export function ruleComparisonRows(
  file: FpGrowthFile,
  which: "gap_filling" | "segmentation" = "gap_filling",
): RuleComparisonRow[] {
  const tables: Record<
    string,
    { same_month: RuleComparison; lagged_one_month: RuleComparison }
  > =
    (which === "gap_filling"
      ? file.gap_filling_sensitivity?.tables
      : file.segmentation_sensitivity?.tables) ?? {};
  return Object.entries(tables).flatMap(([table, item]) => [
    { table, timing: "same month", comparison: item.same_month },
    {
      table,
      timing: "previous month → this month",
      comparison: item.lagged_one_month,
    },
  ]);
}

// "yes" only when the top rules are the same rules in the same order.
export function formatTopRules(comparison: RuleComparison): string {
  if (comparison.top_rules_compared === 0) return "no rules";
  if (comparison.top_rules_same_order) return "same rules, same order";
  if (comparison.top_rules_same_set) return "same rules, different order";
  return "different rules";
}

export function formatParameter(value: Parameters[string]): string {
  if (value === null) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "number" && !Number.isInteger(value)) {
    return String(Number(value.toFixed(4)));
  }
  return String(value);
}

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}
