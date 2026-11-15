// Pure functions behind the time series chart and the timeline's anomaly
// strip. They only rearrange numbers the pipeline already produced; no test
// statistic is computed here.
import { localNumber, t, tm } from "../i18n";
import { monthNumber } from "./timelineMath";

export type MonthlyPoint = {
  month: string;
  value: number | null;
  coverage?: number | null;
};

// One series of data/analysis/anomalies.json: consecutive months from
// `first_month`, null where the month was not used.
export type AnomalySeries = {
  first_month: string;
  values: (number | null)[];
};

export type ChartMode = "values" | "anomalies" | "running";

export const CHART_MODES: { id: ChartMode; label: string }[] = [
  { id: "values", label: "Monthly values" },
  { id: "anomalies", label: "Anomalies" },
  { id: "running", label: "12-month running mean" },
];

// The button text of a chart mode in the active language and voice.
export function chartModeLabel(id: ChartMode): string {
  return id === "values" ? t("chart.modes.values") : tm(`chart.modes.${id}`);
}

export const RUNNING_WINDOW = 12;

// Kelvin is shown as °C, like everywhere else on the page.
export function displayValue(
  value: number | null,
  unit: string,
): number | null {
  if (value === null) return null;
  return unit === "K" ? value - 273.15 : value;
}

export function displayUnit(unit: string): string {
  if (unit === "K" || unit === "C" || unit === "degC") return "°C";
  if (unit === "1") return "";
  return unit;
}

// The series laid out on the timeline's months; a month it lacks is null.
function alignToMonths<T>(
  points: MonthlyPoint[],
  months: string[],
  pick: (point: MonthlyPoint) => T | null,
): (T | null)[] {
  const byMonth = new Map<string, T | null>();
  for (const point of points) byMonth.set(point.month, pick(point));
  return months.map((month) => byMonth.get(month) ?? null);
}

export function alignValues(
  points: MonthlyPoint[],
  months: string[],
): (number | null)[] {
  return alignToMonths(points, months, (point) => point.value);
}

export function alignCoverage(
  points: MonthlyPoint[],
  months: string[],
): (number | null)[] {
  return alignToMonths(points, months, (point) => point.coverage ?? null);
}

// anomalies.json values laid out on the timeline's months.
export function alignAnomalies(
  series: AnomalySeries,
  months: string[],
): (number | null)[] {
  const first = monthNumber(series.first_month);
  return months.map(
    (month) => series.values[monthNumber(month) - first] ?? null,
  );
}

// Fallback when anomalies.json has no entry: value minus the mean of the
// same calendar month over this series' own months with a value (the
// pipeline's definition, without its coverage screening).
export function calendarAnomalies(
  values: (number | null)[],
  months: string[],
): (number | null)[] {
  const sums = new Array<number>(12).fill(0);
  const counts = new Array<number>(12).fill(0);
  values.forEach((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return;
    const calendar = monthNumber(month) % 12;
    sums[calendar] = (sums[calendar] ?? 0) + value;
    counts[calendar] = (counts[calendar] ?? 0) + 1;
  });
  return values.map((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return null;
    const calendar = monthNumber(month) % 12;
    return value - (sums[calendar] ?? 0) / (counts[calendar] ?? 1);
  });
}

// Centred running mean over `window` consecutive entries (for 12: the six
// months before and the five after). Null unless every month of the window
// has a value, so a gap is never bridged and a partial year never stands in
// for a full one.
export function runningMean(
  values: (number | null)[],
  window = RUNNING_WINDOW,
): (number | null)[] {
  const before = Math.floor(window / 2);
  return values.map((_, index) => {
    const start = index - before;
    const end = start + window;
    if (start < 0 || end > values.length) return null;
    let sum = 0;
    for (let at = start; at < end; at += 1) {
      const value = values[at];
      if (value === null || value === undefined) return null;
      sum += value;
    }
    return sum / window;
  });
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type TrendLine = {
  // Month numbers (see monthNumber) of the two ends of the analysed period.
  start: number;
  end: number;
  // The fitted line and the lines with the lower and upper CI slopes.
  line: [number, number];
  low: [number, number];
  high: [number, number];
};

// trends.json stores the slope and its confidence interval but no intercept.
// A least-squares line always passes through (mean time, mean value) of the
// points it was fitted to, so the line is rebuilt from the slope through
// that point: `anomalies` gives the months the fit used (non-null ones) and
// `level` the series drawn (anomalies themselves, or the monthly values, in
// which case the line sits at their mean level and still has the anomaly
// slope). The band is the two lines with the CI's slopes through the same
// point: slope uncertainty only, not a prediction interval.
export function trendLine(
  slopePerDecade: number,
  ciPerDecade: [number, number],
  months: string[],
  anomalies: (number | null)[],
  level: (number | null)[],
): TrendLine | null {
  const times: number[] = [];
  const levels: number[] = [];
  anomalies.forEach((anomaly, index) => {
    const month = months[index];
    const value = level[index];
    if (anomaly === null || month === undefined) return;
    times.push(monthNumber(month));
    if (value !== null && value !== undefined) levels.push(value);
  });
  const centreTime = mean(times);
  const centreLevel = mean(levels);
  if (centreTime === null || centreLevel === null || times.length < 2) {
    return null;
  }
  const start = times[0] ?? 0;
  const end = times.at(-1) ?? 0;
  const ends = (perDecade: number): [number, number] => [
    centreLevel + (perDecade / 120) * (start - centreTime),
    centreLevel + (perDecade / 120) * (end - centreTime),
  ];
  return {
    start,
    end,
    line: ends(slopePerDecade),
    low: ends(ciPerDecade[0]),
    high: ends(ciPerDecade[1]),
  };
}

export type StripBar = {
  index: number;
  // -1 to 1: the anomaly over the strip's scale, clamped.
  level: number;
};

export const STRIP_QUANTILE = 0.98;

// Bars of the timeline's anomaly strip: one per month with an anomaly,
// scaled by the 98th percentile of the absolute anomalies so one extreme
// month does not flatten the rest.
export function stripBars(anomalies: (number | null)[]): StripBar[] {
  const sizes = anomalies
    .filter((value): value is number => value !== null)
    .map((value) => Math.abs(value))
    .sort((a, b) => a - b);
  if (sizes.length === 0) return [];
  const scale =
    sizes[
      Math.min(sizes.length - 1, Math.floor(STRIP_QUANTILE * sizes.length))
    ] ||
    sizes.at(-1) ||
    0;
  const bars: StripBar[] = [];
  anomalies.forEach((value, index) => {
    if (value === null) return;
    bars.push({
      index,
      level: scale === 0 ? 0 : Math.max(-1, Math.min(1, value / scale)),
    });
  });
  return bars;
}

// Months of documented steps for one series: the `break_months` of the known
// issues trends.json lists for it, sorted, without duplicates.
export function breakMonths(
  issueIds: string[] | undefined,
  issues: Record<string, { break_months?: string[] }> | undefined,
): string[] {
  const months = new Set<string>();
  for (const id of issueIds ?? []) {
    for (const month of issues?.[id]?.break_months ?? []) months.add(month);
  }
  return [...months].sort();
}

// p values the way the panel prints them.
export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined) return t("common.status.notAvailable");
  if (p < 0.001) return localNumber("< 0.001");
  return localNumber(p.toFixed(3));
}

// "+0.42 °C", "−1.2e-6 kg m-2 s-1": an anomaly with its sign. A difference
// in K equals a difference in °C, so no offset is applied.
export function formatAnomaly(value: number | null, unit: string): string {
  if (value === null) return t("common.status.notAvailable");
  const size = Math.abs(value);
  const text = localNumber(
    displayUnit(unit) === "°C"
      ? size.toFixed(2)
      : size !== 0 && (size >= 1e5 || size < 0.01)
        ? size.toExponential(2)
        : size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2),
  );
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const suffix = displayUnit(unit) === "" ? "" : ` ${displayUnit(unit)}`;
  return `${sign}${text}${suffix}`;
}
