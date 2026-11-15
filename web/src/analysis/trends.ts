// Trend statistics written by `uv run python -m trend_detective.trends`
// (data/analysis/trends.json). This module only reads and formats them; it
// does not compute or interpret anything.

import { localNumber, t, type Voice } from "../i18n";

export type TestResult = {
  p: number | null;
  p_fdr: number | null;
  significant: boolean | null;
  significant_fdr: boolean | null;
};

export type AnalyzedTrend = {
  status: "analyzed";
  unit: string;
  data: {
    first_month: string;
    last_month: string;
    n_valid: number;
    n_points?: number;
    missing_fraction?: number;
  };
  ols: TestResult & {
    slope_per_decade: number;
    ci_per_decade: [number, number];
    // Lag-1 autocorrelation of the residuals and the effective sample size
    // the corrected test used.
    lag1_autocorrelation?: number;
    n_effective?: number;
  };
  mann_kendall: {
    original: TestResult;
    hamed_rao: TestResult;
    seasonal: TestResult;
  };
  sen: { slope_per_decade: number; ci_per_decade: [number, number] };
  // Ids into TrendsFile.known_issues.
  known_issues?: string[];
};

export type TrendKnownIssue = {
  kind: string;
  summary_en: string;
  break_months?: string[];
};

export type InsufficientTrend = {
  status: "insufficient";
  unit: string;
  reason: { code: string; text_en: string };
};

export type TrendEntry = AnalyzedTrend | InsufficientTrend;

export type TrendsFile = {
  input: { snapshot_generated_at: string };
  parameters: { alpha: number; min_coverage: number };
  known_issues?: Record<string, TrendKnownIssue>;
  series: Record<string, TrendEntry>;
};

export type TrendSummary = {
  headline: string;
  significance: string;
  period: string | null;
  // The plain line of the general voice ("About +0.21 °C per decade"); null
  // when no trend was analyzed.
  plain: string | null;
};

export function analysisUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/analysis/${file}`;
}

export function trendKey(
  variableId: string,
  locationId: string,
  aggregation: string,
): string {
  return `${variableId}__${locationId}__${aggregation}`;
}

// The world subset's own results (data/analysis/world, written by
// `uv run python -m trend_detective.world_export`). Same format; its p_fdr
// values are adjusted within that file only (its own FDR family).
export const WORLD_ANALYSIS = "world/";

// Series of the second file are added to the first. The keys cannot clash
// (they carry the place id); where they would, the first file wins.
export function mergeSeriesFiles<T extends { series: Record<string, unknown> }>(
  core: T,
  world: { series: T["series"] } | null,
): T {
  if (!world) return core;
  return { ...core, series: { ...world.series, ...core.series } };
}

// Core trends plus, when it is published, the world subset's. Parameters and
// known issues are read from the core file (both runs use the same seed).
export async function loadTrends(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<TrendsFile> {
  const [core, world] = await Promise.all([
    fetchJson<TrendsFile>(analysisUrl("trends.json")),
    fetchJson<TrendsFile>(analysisUrl(`${WORLD_ANALYSIS}trends.json`)).catch(
      () => null,
    ),
  ]);
  const merged = mergeSeriesFiles(core, world);
  return world?.known_issues
    ? {
        ...merged,
        known_issues: { ...world.known_issues, ...core.known_issues },
      }
    : merged;
}

// A difference of 1 K equals a difference of 1 °C, so a change per decade in
// K is shown as °C without any offset.
export function deltaUnit(unit: string): string {
  if (unit === "K" || unit === "C" || unit === "degC") return "°C";
  if (unit === "1") return "";
  return unit;
}

function formatter(unit: string, values: number[]): (value: number) => string {
  if (deltaUnit(unit) === "°C") return (value) => localNumber(value.toFixed(2));
  const largest = Math.max(...values.map((value) => Math.abs(value)));
  if (largest === 0) return () => "0";
  if (largest >= 1e5 || largest < 0.001) {
    return (value) => localNumber(value.toExponential(2));
  }
  const digits =
    largest >= 100
      ? 0
      : largest >= 10
        ? 1
        : largest >= 1
          ? 2
          : largest >= 0.1
            ? 3
            : largest >= 0.01
              ? 4
              : 5;
  return (value) => localNumber(value.toFixed(digits));
}

function signed(text: string, value: number): string {
  return value > 0 ? `+${text}` : text;
}

// "+0.21 °C per decade (95% CI 0.12 to 0.30)". The three numbers share one
// precision, chosen from the largest of them.
export function formatChangePerDecade(
  slope: number,
  interval: [number, number],
  unit: string,
  alpha = 0.05,
): string {
  const format = formatter(unit, [slope, ...interval]);
  const suffix = deltaUnit(unit) === "" ? "" : ` ${deltaUnit(unit)}`;
  return t("trend.change.expert", {
    slope: `${signed(format(slope), slope)}${suffix}`,
    level: Math.round((1 - alpha) * 100),
    low: format(interval[0]),
    high: format(interval[1]),
  });
}

// The slope alone with its unit, at the same precision as the full line, so
// the plain wording never shows a different number: "+0.21 °C". `sign`
// false gives the size only ("0.21 °C"), for sentences that say the
// direction in words.
export function formatSlope(
  slope: number,
  interval: [number, number],
  unit: string,
  sign = true,
): string {
  const format = formatter(unit, [slope, ...interval]);
  const suffix = deltaUnit(unit) === "" ? "" : ` ${deltaUnit(unit)}`;
  const text = sign ? signed(format(slope), slope) : format(Math.abs(slope));
  return `${text}${suffix}`;
}

// "About +0.21 °C per decade": the plain line of the general voice.
export function formatChangePlain(
  slope: number,
  interval: [number, number],
  unit: string,
): string {
  return t("trend.change.general", {
    slope: formatSlope(slope, interval, unit),
  });
}

export type SignificanceOutcome =
  | "notComputed"
  | "notSignificant"
  | "fdr"
  | "rawOnly"
  | "unreliableFdr"
  | "unreliableRawOnly";

// Which of the six wordings a test result gets. Raw means after the lag-1
// autocorrelation correction, FDR after Benjamini-Hochberg as well.
// `unreliable`: the series has a documented issue that affects trends
// (trendReliability.ts). The statistical fact stays; its reading is limited.
export function significanceOutcome(
  test: TestResult,
  unreliable = false,
): SignificanceOutcome {
  if (test.significant === null) return "notComputed";
  if (!test.significant) return "notSignificant";
  if (unreliable)
    return test.significant_fdr ? "unreliableFdr" : "unreliableRawOnly";
  return test.significant_fdr ? "fdr" : "rawOnly";
}

// The wording of the linear trend's t-test, with the statistical terms by
// default; `voice` "general" gives the plain sentence for the same outcome.
export function significanceText(
  test: TestResult,
  unreliable = false,
  voice: Voice = "expert",
): string {
  return t(
    `trend.significance.${significanceOutcome(test, unreliable)}.${voice}`,
  );
}

export function formatPeriod(first: string, last: string): string {
  return t("trend.period", {
    first: first.slice(0, 7),
    last: last.slice(0, 7),
  });
}

export function summarizeTrend(
  entry: TrendEntry | undefined,
  alpha = 0.05,
  unreliable = false,
): TrendSummary | null {
  if (!entry) return null;
  if (entry.status === "insufficient") {
    return {
      headline: t("trend.notAnalyzed.expert"),
      significance: entry.reason.text_en,
      period: null,
      plain: null,
    };
  }
  return {
    headline: formatChangePerDecade(
      entry.ols.slope_per_decade,
      entry.ols.ci_per_decade,
      entry.unit,
      alpha,
    ),
    significance: significanceText(entry.ols, unreliable),
    period: formatPeriod(entry.data.first_month, entry.data.last_month),
    plain: formatChangePlain(
      entry.ols.slope_per_decade,
      entry.ols.ci_per_decade,
      entry.unit,
    ),
  };
}

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}
