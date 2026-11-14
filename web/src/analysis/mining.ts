// Exploratory mining results written by
// `uv run python -m trend_detective.mining` (data/analysis/fpgrowth.json and
// decision_tree.json). This module only reads, sorts and formats them.
import { analysisUrl } from "./trends";

export type Rule = {
  antecedents: string[];
  consequent: string;
  support: number;
  confidence: number;
  lift: number;
  same_variable: boolean;
};

export type RuleSet = {
  n_transactions: number;
  n_frequent_itemsets: number;
  n_rules: number;
  rules: Rule[];
};

export type RuleTable = {
  locations: string[];
  variables: string[];
  first_month: string | null;
  last_month: string | null;
  n_missing_cells: number;
  n_cells: number;
  dropped_series: { variable_id: string; location_id: string }[];
  same_month: RuleSet;
  lagged_one_month: RuleSet;
};

export type Parameters = Record<string, number | string | string[] | null>;

export type FpGrowthFile = {
  exploratory: boolean;
  note: string;
  input: { snapshot_generated_at: string };
  parameters: Parameters;
  tables: Record<string, RuleTable>;
};

export type ClassCounts = Record<string, number>;

export type DecisionTreeFile = {
  exploratory: boolean;
  note: string;
  input: { snapshot_generated_at: string };
  parameters: Parameters;
  table: string;
  target: string;
  target_classes: string[];
  features: string[];
  rows_by_location: Record<
    string,
    { n_rows: number; n_complete_rows: number; missing_variables: string[] }
  >;
  split: {
    train_first_month: string;
    train_last_month: string;
    test_first_month: string;
    test_last_month: string;
    n_train: number;
    n_test: number;
  };
  class_counts: { train: ClassCounts; test: ClassCounts };
  accuracy: { train: number; test: number };
  baseline_majority_class: {
    predicted_class: string;
    tie: boolean;
    train_accuracy: number;
    test_accuracy: number;
    best_constant_on_test: { predicted_class: string; test_accuracy: number };
  };
  confusion_matrix_test: Record<string, ClassCounts>;
  feature_importances: { feature: string; importance: number }[];
  tree_text: string;
};

export type MiningResults = {
  rules: FpGrowthFile;
  tree: DecisionTreeFile;
};

export type RuleSortKey = "rule" | "support" | "confidence" | "lift";

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

// "prev:omi_o3=low" → "omi_o3 low (previous month)"
export function formatItem(item: string): string {
  const lagged = item.startsWith("prev:");
  const [variable, state] = (lagged ? item.slice(5) : item).split("=");
  return `${variable} ${state}${lagged ? " (previous month)" : ""}`;
}

export function formatRule(rule: Rule): string {
  return `${rule.antecedents.map(formatItem).join(" + ")} → ${formatItem(rule.consequent)}`;
}

export function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Clicking the active column flips its direction; a new column starts with
// the largest values first (text starts A to Z).
export function nextSort(current: RuleSort, key: RuleSortKey): RuleSort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key !== "rule" };
}

export function sortRules(rules: Rule[], sort: RuleSort): Rule[] {
  const direction = sort.descending ? -1 : 1;
  return [...rules].sort((a, b) => {
    const order =
      sort.key === "rule"
        ? formatRule(a).localeCompare(formatRule(b))
        : a[sort.key] - b[sort.key];
    return order * direction;
  });
}

export function filterRules(rules: Rule[], hideSameVariable: boolean): Rule[] {
  return hideSameVariable ? rules.filter((rule) => !rule.same_variable) : rules;
}

export function formatParameter(value: Parameters[string]): string {
  if (value === null) return "none";
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
