// Exploratory results added in #111: the model-vs-observation gap tree
// (gap_tree.json), the variable network (variable_graph.json) and the
// similar-series lists (similar_series.json). This module only reads, lays
// out and formats them; every number comes from the files.
import { strata, strataAssignment, type StratumId } from "../strata/strataSpec";
import { analysisUrl } from "./trends";

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

// ---- Association rules: items as small labels ----

export type RuleChip = {
  variableId: string;
  state: string;
  previousMonth: boolean;
};

// "prev:omi_o3=low" → { variableId: "omi_o3", state: "low", previousMonth: true }
export function ruleChip(item: string): RuleChip {
  const previousMonth = item.startsWith("prev:");
  const [variableId = "", state = ""] = (
    previousMonth ? item.slice(5) : item
  ).split("=");
  return { variableId, state, previousMonth };
}

export function ruleVariables(rule: {
  antecedents: string[];
  consequent: string;
}): string[] {
  return [
    ...new Set(
      [...rule.antecedents, rule.consequent].map(
        (item) => ruleChip(item).variableId,
      ),
    ),
  ];
}

// "all" keeps every rule; otherwise only the rules that mention the variable.
export function filterRulesByVariable<
  T extends { antecedents: string[]; consequent: string },
>(rules: T[], variableId: string): T[] {
  if (variableId === "all") return rules;
  return rules.filter((rule) => ruleVariables(rule).includes(variableId));
}

// ---- Variable network ----

export type GraphNode = {
  node_id: number;
  variable_id: string;
  component: number;
  degree: number;
  n_significant_edges: number;
};

export type GraphEdge = {
  edge_id: number;
  source: string;
  target: string;
  // 0: same month. 1: the source is one month earlier than the target.
  lag: number;
  r: number;
  n_eff: number;
  n_months_median: number;
  n_locations: number;
  r_min: number;
  r_max: number;
  same_sign_in_all_locations: boolean;
  p: number;
  q: number;
  significant: boolean;
  known_issues: boolean;
};

export type GraphTable = {
  locations: string[];
  n_tests: number;
  n_significant: number;
  n_significant_by_lag: Record<string, number>;
  n_components: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  excluded_pairs: { source: string; target: string; reason: string }[];
};

export type WorldPair = {
  source: string;
  target: string;
  lag: number;
  n_cities: number;
  n_significant: number;
  n_significant_positive: number;
  n_significant_negative: number;
  sign_consistent: boolean;
  r_median: number;
  r_min: number;
  r_max: number;
};

export type VariableGraphFile = {
  note: string;
  significance_note: string;
  parameters: Record<string, unknown> & { alpha: number };
  methods: Record<string, string>;
  variables: Record<
    string,
    {
      name_en: string;
      data_kind: string;
      category_path: string;
      known_issues: string[];
    }
  >;
  tables: Record<string, GraphTable>;
  world_cities: {
    cities: string[];
    variables: string[];
    n_tests: number;
    n_significant: number;
    n_pairs: number;
    pairs: WorldPair[];
  } | null;
  pgrouting: Record<
    string,
    {
      n_nodes: number;
      n_components: number;
      n_nodes_component_differs_from_union_find: number;
      n_nodes_degree_differs: number;
    }
  > | null;
};

export function loadVariableGraph(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<VariableGraphFile> {
  return fetchJson<VariableGraphFile>(analysisUrl("variable_graph.json"));
}

// The stratum a variable is drawn on: the layer view's table first; variables
// that are not layers (a second product of the same quantity) follow their
// category path.
export function stratumOfVariable(
  variableId: string,
  categoryPath: string,
): StratumId {
  const assigned = strataAssignment(variableId);
  if (assigned) return assigned.stratum;
  if (categoryPath.startsWith("atmosphere.temperature")) return "near-surface";
  if (categoryPath.startsWith("atmosphere.water")) return "troposphere-water";
  if (categoryPath.startsWith("atmosphere")) return "troposphere-air";
  if (categoryPath.startsWith("land.water.soil")) return "top-soil";
  return "land-surface";
}

export type PlacedNode = {
  variableId: string;
  stratum: StratumId;
  x: number;
  y: number;
  // True when the node sits in the upper half of its row (label goes above).
  above: boolean;
};

export type NetworkLayout = {
  width: number;
  height: number;
  rows: { stratum: StratumId; nameEn: string; color: string; y: number }[];
  nodes: PlacedNode[];
};

// Fixed layout: one row per stratum, top of the atmosphere first (the same
// order as the layer view); the variables of a row are spread evenly.
export function networkLayout(
  variables: { id: string; categoryPath: string }[],
  width: number,
  rowHeight: number,
  labelWidth: number,
): NetworkLayout {
  const rows = strata.map((item, index) => ({
    stratum: item.id,
    nameEn: item.nameEn,
    color: item.color,
    y: rowHeight * (index + 0.5),
  }));
  const nodes: PlacedNode[] = [];
  for (const row of rows) {
    const members = variables.filter(
      (item) => stratumOfVariable(item.id, item.categoryPath) === row.stratum,
    );
    const span = width - labelWidth;
    members.forEach((item, index) => {
      nodes.push({
        variableId: item.id,
        stratum: row.stratum,
        x: labelWidth + (span * (index + 0.5)) / members.length,
        // Neighbours in a row are staggered so that an edge between the
        // first and the third does not run through the second.
        y: row.y + (index % 2 === 0 ? -14 : 14),
        above: index % 2 === 0,
      });
    });
  }
  return { width, height: rowHeight * rows.length, rows, nodes };
}

// A curved edge: straight edges of one row would lie on top of each other.
export function edgePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bend: number,
): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const cx = mx - (dy / length) * bend;
  const cy = my + (dx / length) * bend;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

export function edgeWidth(r: number): number {
  return 1 + Math.abs(r) * 6;
}

export function significantEdges(table: GraphTable, lag: "all" | 0 | 1) {
  return table.edges
    .filter((edge) => edge.significant && (lag === "all" || edge.lag === lag))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export function formatR(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

export function formatSmall(value: number): string {
  return value < 0.001 ? "<0.001" : value.toFixed(3);
}

export function lagLabel(lag: number): string {
  return lag === 0 ? "same month" : "first leads by one month";
}

// ---- Similar series ----

export type SimilarEntry = {
  series: string;
  cosine: number;
  cosine_detrended: number;
  n_eff: number;
  q: number;
  significant: boolean;
  q_detrended: number;
  significant_detrended: boolean;
  trend_sensitive: boolean;
};

export type SimilarSeriesFile = {
  note: string;
  parameters: Record<string, unknown> & { alpha: number };
  methods: Record<string, string>;
  window: { first_month: string; last_month: string; n_months: number };
  summary: {
    n_series: number;
    n_series_by_group: Record<string, number>;
    n_candidate_pairs: number;
    n_candidate_pairs_significant: number;
    n_candidate_pairs_significant_detrended: number;
    n_listed: number;
    n_listed_significant: number;
    n_listed_significant_detrended: number;
    n_listed_trend_sensitive: number;
  };
  variable_names: Record<string, string>;
  locations: Record<string, { name_en: string; group: string }>;
  series: Record<
    string,
    {
      variable_id: string;
      location_id: string;
      aggregation: string;
      known_issues: string[];
      n_filled: number;
      z: number[];
    }
  >;
  results: Record<
    string,
    { most_similar: SimilarEntry[]; least_similar: SimilarEntry[] }
  >;
  check: { pgvector_matches_numpy: boolean; tolerance: number };
};

export function loadSimilarSeries(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<SimilarSeriesFile> {
  return fetchJson<SimilarSeriesFile>(analysisUrl("similar_series.json"));
}

// The series key of a place and a variable, or null when there is none.
export function similarKey(
  file: Pick<SimilarSeriesFile, "series">,
  locationId: string,
  variableId: string,
): string | null {
  for (const [key, item] of Object.entries(file.series)) {
    if (item.location_id === locationId && item.variable_id === variableId) {
      return key;
    }
  }
  return null;
}

export function variablesAt(
  file: Pick<SimilarSeriesFile, "series" | "variable_names">,
  locationId: string,
): string[] {
  const present = new Set(
    Object.values(file.series)
      .filter((item) => item.location_id === locationId)
      .map((item) => item.variable_id),
  );
  return Object.keys(file.variable_names).filter((id) => present.has(id));
}

// "?place=tokyo&variable=imerg_precip#similar" → the selection, falling back
// to the first place and its first variable when a value is unknown.
export function similarSelection(
  file: Pick<SimilarSeriesFile, "series" | "variable_names" | "locations">,
  search: string,
): { locationId: string; variableId: string } {
  const query = new URLSearchParams(search);
  const places = Object.keys(file.locations);
  const wanted = query.get("place") ?? "";
  const locationId = places.includes(wanted) ? wanted : (places[0] ?? "");
  const variables = variablesAt(file, locationId);
  const variable = query.get("variable") ?? "";
  return {
    locationId,
    variableId: variables.includes(variable) ? variable : (variables[0] ?? ""),
  };
}

// "#similar" → "similar" when the page has that section, otherwise null.
// The sections are drawn after their result files are read, so the browser
// cannot scroll to a link's fragment by itself when the page opens; the
// page does it once the sections exist.
export function sectionFromHash(
  hash: string,
  sectionIds: readonly string[],
): string | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return sectionIds.includes(id) ? id : null;
}

export function similarLink(
  base: string,
  locationId: string,
  variableId: string,
): string {
  return `${base}mining/?place=${encodeURIComponent(locationId)}&variable=${encodeURIComponent(variableId)}#similar`;
}

// A polyline through standardized anomalies; `limit` is the value at the top
// edge (the bottom edge is −limit), larger values are clipped.
export function sparkPath(
  values: number[],
  width: number,
  height: number,
  limit: number,
): string {
  if (values.length < 2) return "";
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const clipped = Math.max(-limit, Math.min(limit, value));
      const y = ((limit - clipped) / (2 * limit)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
}

// 12-month running mean, so two overlaid lines stay readable at 248 points.
export function runningMean(values: number[], window: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
    if (index >= window) sum -= values[index - window] ?? 0;
    if (index >= window - 1) out.push(sum / window);
  }
  return out;
}

// ---- Gap tree ----

export type GapStat = {
  model: string;
  group: string;
  n_months: number;
  mean_abs_difference: number;
  median_abs_difference: number;
  ci: [number | null, number | null];
};

export type GapBaselines = Record<
  "train_majority" | "persistence" | "calendar_month",
  { test_accuracy: number; macro_f1: number; predicted_class?: string }
>;

export type GapFold = {
  fold: number;
  held_out_station?: string;
  models_at_station?: string[];
  train_first_month?: string;
  train_last_month?: string;
  test_first_month?: string;
  test_last_month?: string;
  n_train: number;
  n_test: number;
  accuracy: { train: number; test: number };
  macro_f1: { test: number };
  baselines: GapBaselines;
  hindsight_test_majority: { predicted_class: string; test_accuracy: number };
  above_train_majority: boolean;
  above_persistence: boolean;
  above_calendar_month: boolean;
  above_all_baselines: boolean;
  confusion_matrix_test: Record<string, Record<string, number>>;
  feature_importances: { feature: string; importance: number }[];
  tree_text: string;
};

export type GapValidation = {
  features: string[];
  folds: GapFold[];
  summary: {
    n_folds: number;
    n_folds_above_all: number;
    mean_test_accuracy: number;
    mean_macro_f1: number;
    mean_train_majority_accuracy: number;
    mean_persistence_accuracy: number;
    mean_calendar_month_accuracy: number;
    text_en: string;
  };
  importance_stability: {
    feature: string;
    mean: number;
    min: number;
    max: number;
    n_folds_used: number;
    n_folds_top: number;
  }[];
};

export type GapVariant = {
  note: string;
  include_segment: boolean;
  include_target_lag: boolean;
  n_rows: number;
  rows_dropped: Record<string, number>;
  first_month: string;
  last_month: string;
  walk_forward: GapValidation;
  leave_one_location_out: GapValidation;
};

export type GapTreeFile = {
  note: string;
  parameters: Record<string, unknown>;
  methods: Record<string, string>;
  leakage_guards: string[];
  classes: string[];
  gldas_break_months: string[];
  segments: { segment: number; first_month: string | null }[];
  pairs: {
    pair_id: string;
    model: string;
    station: string;
    station_name_en: string;
    n_months: number;
    context_point: string;
    context_distance_km: number;
  }[];
  context_variables: string[];
  excluded_temperature_variables: string[];
  variable_names: Record<string, string>;
  descriptive: Record<string, GapStat[]>;
  primary_variant: string;
  variants_run: string[];
  variants: Record<string, GapVariant>;
};

export function loadGapTree(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<GapTreeFile> {
  return fetchJson<GapTreeFile>(analysisUrl("gap_tree.json"));
}

export function stationName(file: GapTreeFile, station: string): string {
  const found = file.pairs.find((pair) => pair.station === station);
  // "Tainan (CWA / WMO 59358)" → "Tainan"
  return found ? found.station_name_en.replace(/ \(.*$/, "") : station;
}

// "2011-05-01" → "2011-05"
function monthOf(value: string): string {
  return value.slice(0, 7);
}

// Segment 2 of breaks 2011-05, 2017-07 → "2011-05 to 2017-06"
export function segmentLabel(file: GapTreeFile, segment: string): string {
  const index = file.segments.findIndex(
    (item) => String(item.segment) === segment,
  );
  if (index < 0) return segment;
  const start = file.segments[index]?.first_month;
  const next = file.segments[index + 1]?.first_month;
  if (!start) return next ? `before ${monthOf(next)}` : "all months";
  return next
    ? `${monthOf(start)} up to ${monthOf(next)}`
    : `from ${monthOf(start)}`;
}

export function gapGroupLabel(
  file: GapTreeFile,
  grouping: string,
  group: string,
): string {
  if (grouping === "by_product_station") return stationName(file, group);
  if (grouping === "by_product_segment") return segmentLabel(file, group);
  if (grouping === "by_product") return "all months";
  return group;
}

// A feature of the gap tree in words.
export function gapFeatureLabel(file: GapTreeFile, feature: string): string {
  if (feature === "calendar_month") return "calendar month";
  if (feature === "model_is_gldas") return "model is GLDAS (1) or MERRA-2 (0)";
  if (feature === "gldas_segment") return "GLDAS segment number";
  if (feature === "obs_state") return "state of the station anomaly";
  if (feature === "prev_gap_class") return "class of the previous month";
  if (feature.startsWith("station:")) {
    return `station is ${stationName(file, feature.slice(8))}`;
  }
  if (feature.startsWith("ctx:")) {
    const id = feature.slice(4);
    return `state of ${file.variable_names[id] ?? id}`;
  }
  return feature;
}

export function labelGapTreeText(file: GapTreeFile, text: string): string {
  return text.replace(
    /^(\s*if )(\S+)( <= )/gm,
    (_, start: string, feature: string, end: string) =>
      `${start}${gapFeatureLabel(file, feature)}${end}`,
  );
}

export function gapFoldVerdict(fold: GapFold): string {
  const notAbove = [
    fold.above_train_majority ? null : "training-majority guess",
    fold.above_persistence ? null : "persistence guess",
    fold.above_calendar_month ? null : "calendar-month guess",
  ].filter((name) => name !== null);
  return notAbove.length
    ? `not above: ${notAbove.join(", ")}`
    : "above all three baselines";
}

// Width of a bar as a share of the largest upper bound in the table.
export function barScale(rows: GapStat[]): number {
  return Math.max(
    ...rows.map((row) => row.ci[1] ?? row.mean_abs_difference),
    0,
  );
}
