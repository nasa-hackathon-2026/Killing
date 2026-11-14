// Trend statistics written by `uv run python -m trend_detective.trends`
// (data/analysis/trends.json). This module only reads and formats them; it
// does not compute or interpret anything.

export type TestResult = {
  p: number | null;
  p_fdr: number | null;
  significant: boolean | null;
  significant_fdr: boolean | null;
};

export type AnalyzedTrend = {
  status: "analyzed";
  unit: string;
  data: { first_month: string; last_month: string; n_valid: number };
  ols: TestResult & {
    slope_per_decade: number;
    ci_per_decade: [number, number];
  };
  mann_kendall: {
    original: TestResult;
    hamed_rao: TestResult;
    seasonal: TestResult;
  };
  sen: { slope_per_decade: number; ci_per_decade: [number, number] };
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
  series: Record<string, TrendEntry>;
};

export type TrendSummary = {
  headline: string;
  significance: string;
  period: string | null;
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

export async function loadTrends(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<TrendsFile> {
  return fetchJson<TrendsFile>(analysisUrl("trends.json"));
}

// A difference of 1 K equals a difference of 1 °C, so a change per decade in
// K is shown as °C without any offset.
export function deltaUnit(unit: string): string {
  if (unit === "K" || unit === "C" || unit === "degC") return "°C";
  if (unit === "1") return "";
  return unit;
}

function formatter(unit: string, values: number[]): (value: number) => string {
  if (deltaUnit(unit) === "°C") return (value) => value.toFixed(2);
  const largest = Math.max(...values.map((value) => Math.abs(value)));
  if (largest === 0) return () => "0";
  if (largest >= 1e5 || largest < 0.001) {
    return (value) => value.toExponential(2);
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
  return (value) => value.toFixed(digits);
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
  const level = Math.round((1 - alpha) * 100);
  return (
    `${signed(format(slope), slope)}${suffix} per decade ` +
    `(${level}% CI ${format(interval[0])} to ${format(interval[1])})`
  );
}

// Wording follows the linear trend's t-test: raw means after the lag-1
// autocorrelation correction, FDR means after Benjamini-Hochberg as well.
export function significanceText(test: TestResult): string {
  if (test.significant === null) return "test could not be computed";
  if (!test.significant) {
    return "not significant after autocorrelation correction";
  }
  if (test.significant_fdr) {
    return "significant after autocorrelation and FDR correction";
  }
  return "significant after autocorrelation correction, not after FDR correction";
}

export function summarizeTrend(
  entry: TrendEntry | undefined,
  alpha = 0.05,
): TrendSummary | null {
  if (!entry) return null;
  if (entry.status === "insufficient") {
    return {
      headline: "Trend not analyzed",
      significance: entry.reason.text_en,
      period: null,
    };
  }
  return {
    headline: formatChangePerDecade(
      entry.ols.slope_per_decade,
      entry.ols.ci_per_decade,
      entry.unit,
      alpha,
    ),
    significance: significanceText(entry.ols),
    period: `${entry.data.first_month.slice(0, 7)} to ${entry.data.last_month.slice(0, 7)}`,
  };
}

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}
