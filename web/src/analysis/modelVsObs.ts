// Model vs observation pairs (data/analysis/model_vs_obs.json, #97): the
// file's shape plus the pure helpers the compare page uses. Numbers only; the
// page does not say which side is right.
import type { TrendCaveat } from "./trendCaveats";
import { analysisUrl } from "./trends";

export type DataKind = "in_situ" | "satellite_retrieval" | "model" | "unknown";

export type PairTrend = {
  slope_per_decade: number;
  ci_per_decade: [number, number];
  p: number;
};

export type PairSeries = {
  first_month: string;
  model_anomaly: (number | null)[];
  obs_anomaly: (number | null)[];
  difference: (number | null)[];
};

export type PairAnnual = {
  first_year: number;
  model_anomaly: (number | null)[];
  obs_anomaly: (number | null)[];
  difference: (number | null)[];
};

export type Pair = {
  pair_id: string;
  group: string;
  location_id: string;
  model: {
    variable_id: string;
    source: string;
    location_id: string;
    known_issues: string[];
    detail: {
      distance_km?: number;
      containing_cell?: boolean;
      cell_center?: [number, number];
    };
  };
  obs: { variable_id: string; known_issues: string[] };
  known_issues: string[];
  status: string;
  n_common_months: number;
  first_common_month: string | null;
  last_common_month: string | null;
  correlation?: number | null;
  model_trend?: PairTrend;
  obs_trend?: PairTrend;
  slope_difference?: number;
  difference?: {
    mean: number;
    sd: number;
    rmse: number;
    trend: PairTrend & { significant: boolean };
    largest_step: number | null;
    largest_step_month: string | null;
  };
  monthly?: PairSeries;
  annual?: PairAnnual;
};

export type KnownIssue = {
  kind: string;
  summary_en: string;
  source_doc: string;
  issue_ref?: string;
  break_months?: string[];
};

export type ModelVsObsFile = {
  parameters: { window_start: string; window_end: string; alpha: number };
  note: string;
  summary: { n_pairs: number; n_pairs_by_group: Record<string, number> };
  known_issues: Record<string, KnownIssue>;
  variables: Record<
    string,
    { name_en: string | null; unit: string | null; data_kind: DataKind }
  >;
  locations: Record<
    string,
    { name_en: string | null; lat?: number | null; lon?: number | null }
  >;
  skipped: { pair_id: string; reason: string }[];
  pairs: Pair[];
};

export const GROUP_LABELS: Record<string, string> = {
  taiwan_station: "Taiwan stations",
  taiwan_gistemp: "Taiwan, GISTEMP grid cell",
  world_city: "World cities",
  global: "Global mean",
};

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  in_situ: "In situ",
  satellite_retrieval: "Satellite retrieval",
  model: "Model",
  unknown: "Unclassified",
};

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}

export async function loadModelVsObs(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<ModelVsObsFile> {
  return fetchJson<ModelVsObsFile>(analysisUrl("model_vs_obs.json"));
}

export function groupsOf(file: ModelVsObsFile): string[] {
  const seen: string[] = [];
  for (const pair of file.pairs) {
    if (!seen.includes(pair.group)) seen.push(pair.group);
  }
  return seen;
}

// "+0.34", "−0.15"; a real minus sign, and an em dash when there is no value.
export function formatSigned(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value < 0 ? "−" : "+"}${text}`;
}

export function formatMonth(month: string | null | undefined): string {
  return month ? month.slice(0, 7) : "—";
}

// One caveat for a pair, in the shape of the existing trend caveats: which
// known issues apply to either series, with their summaries and sources.
export function pairCaveat(
  pair: Pair,
  issues: Record<string, KnownIssue>,
): TrendCaveat | null {
  const found = pair.known_issues
    .map((id) => issues[id])
    .filter((issue): issue is KnownIssue => issue !== undefined);
  if (!found.length) return null;
  const sides = [
    pair.model.known_issues.length ? "model" : null,
    pair.obs.known_issues.length ? "observation" : null,
  ].filter((side) => side !== null);
  const sources = [
    ...new Set(
      found.map((issue) =>
        issue.issue_ref
          ? `${issue.source_doc} (${issue.issue_ref})`
          : issue.source_doc,
      ),
    ),
  ];
  return {
    summary: `Caution: the ${sides.join(" and ")} series has ${
      found.length === 1 ? "a known issue" : `${found.length} known issues`
    }.`,
    details: found.map((issue) => issue.summary_en).join(" "),
    sources: sources.join("; "),
  };
}

// Verified step months of either series (known issues with break_months),
// inside the plotted period.
export function breakMonths(
  pair: Pair,
  issues: Record<string, KnownIssue>,
): string[] {
  const months = pair.known_issues.flatMap(
    (id) => issues[id]?.break_months ?? [],
  );
  return [...new Set(months)].sort();
}

export type ChartSeries = {
  // Time of every point in fractional years (mid-month, or mid-year).
  time: number[];
  model: (number | null)[];
  obs: (number | null)[];
  difference: (number | null)[];
  resolution: "month" | "year";
};

export function monthToYear(month: string): number {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return year + (monthNumber - 1) / 12;
}

// Monthly values when the file has them, annual means otherwise.
export function chartSeries(pair: Pair): ChartSeries | null {
  if (pair.monthly) {
    const start = monthToYear(pair.monthly.first_month);
    return {
      time: pair.monthly.difference.map(
        (_, index) => start + (index + 0.5) / 12,
      ),
      model: pair.monthly.model_anomaly,
      obs: pair.monthly.obs_anomaly,
      difference: pair.monthly.difference,
      resolution: "month",
    };
  }
  if (pair.annual) {
    const first = pair.annual.first_year;
    return {
      time: pair.annual.difference.map((_, index) => first + index + 0.5),
      model: pair.annual.model_anomaly,
      obs: pair.annual.obs_anomaly,
      difference: pair.annual.difference,
      resolution: "year",
    };
  }
  return null;
}

export function valueRange(series: ChartSeries): [number, number] {
  let low = 0;
  let high = 0;
  for (const values of [series.model, series.obs, series.difference]) {
    for (const value of values) {
      if (value === null) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  const edge = Math.max(Math.abs(low), Math.abs(high), 0.5);
  // Whole degrees above 1, half degrees below, so the half-way ticks are
  // round numbers too.
  const rounded = edge > 1 ? Math.ceil(edge) : Math.ceil(edge * 2) / 2;
  return [-rounded, rounded];
}

// SVG path with a gap wherever a value is missing.
export function linePath(
  time: number[],
  values: (number | null)[],
  x: (time: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    const t = time[index];
    if (value === null || t === undefined) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(t).toFixed(1)},${y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

export type CompareLink = { href: string; label: string };

// Observation variables that are station records, in order of preference;
// any other observation (a gridded analysis) is linked as "observations".
const STATION_OBS = ["station_temp", "ghcnm_tavg", "ghcnm_tavg_unadj"];

// For the main view: per model variable, the link to the compare page's
// pair at this place (`<place>` or its station `<place>_station`). A station
// pair is preferred; only analyzed pairs are linked.
export function compareLinksFor(
  pairs: Pair[],
  locationId: string,
  comparePage: string,
): Record<string, CompareLink> {
  const here = pairs.filter(
    (pair) =>
      pair.status === "analyzed" &&
      (pair.location_id === locationId ||
        pair.location_id === `${locationId}_station`),
  );
  const rank = (pair: Pair) => {
    const index = STATION_OBS.indexOf(pair.obs.variable_id);
    return index < 0 ? STATION_OBS.length : index;
  };
  const links: Record<string, CompareLink> = {};
  for (const pair of [...here].sort((a, b) => rank(a) - rank(b))) {
    if (links[pair.model.variable_id]) continue;
    const params = new URLSearchParams({
      group: pair.group,
      pair: pair.pair_id,
    });
    links[pair.model.variable_id] = {
      href: `${comparePage}?${params.toString()}`,
      label:
        rank(pair) < STATION_OBS.length
          ? "Compare with station"
          : "Compare with observations",
    };
  }
  return links;
}
