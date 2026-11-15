// Descriptive numbers behind the investigation panel's charts: the seasonal
// cycle, residuals around the published trend line, their autocorrelation,
// a histogram, yearly means and the coordinates of the interval chart. All
// pure functions. No test statistic or p value is computed here: those come
// from data/analysis/trends.json only.
import { monthNumber } from "../timeline/timelineMath";

function finite(values: (number | null | undefined)[]): number[] {
  return values.filter(
    (value): value is number =>
      value !== null && value !== undefined && Number.isFinite(value),
  );
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Calendar month 0–11 of a "YYYY-MM-01" string.
export function calendarMonth(month: string): number {
  return monthNumber(month) % 12;
}

export type SeasonalCycle = {
  // Mean, smallest and largest value of each calendar month (January
  // first) over every year with a value; null for a month without any.
  mean: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  count: number[];
};

export function seasonalCycle(
  values: (number | null)[],
  months: string[],
): SeasonalCycle {
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  values.forEach((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return;
    buckets[calendarMonth(month)]?.push(value);
  });
  return {
    mean: buckets.map((bucket) => mean(bucket)),
    min: buckets.map((bucket) => (bucket.length ? Math.min(...bucket) : null)),
    max: buckets.map((bucket) => (bucket.length ? Math.max(...bucket) : null)),
    count: buckets.map((bucket) => bucket.length),
  };
}

// The last calendar year that has at least one value, laid out January to
// December (null where that month has none).
export function latestYear(
  values: (number | null)[],
  months: string[],
): { year: number; values: (number | null)[] } | null {
  let year: number | null = null;
  values.forEach((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return;
    const at = Math.floor(monthNumber(month) / 12);
    if (year === null || at > year) year = at;
  });
  if (year === null) return null;
  const found: number = year;
  const row: (number | null)[] = new Array<number | null>(12).fill(null);
  values.forEach((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return;
    if (Math.floor(monthNumber(month) / 12) === found) {
      row[calendarMonth(month)] = value;
    }
  });
  return { year: found, values: row };
}

// Anomalies minus the published least-squares line. trends.json has the
// slope but no intercept; a least-squares line passes through the mean time
// and mean anomaly of the months it was fitted to (the non-null ones), so
// with the published slope these are the fit's residuals.
export function residuals(
  anomalies: (number | null)[],
  months: string[],
  slopePerDecade: number,
): (number | null)[] {
  const times: number[] = [];
  const used: number[] = [];
  anomalies.forEach((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return;
    times.push(monthNumber(month));
    used.push(value);
  });
  const centreTime = mean(times);
  const centre = mean(used);
  if (centreTime === null || centre === null) return anomalies.map(() => null);
  return anomalies.map((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return null;
    return (
      value -
      (centre + (slopePerDecade / 120) * (monthNumber(month) - centreTime))
    );
  });
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

// 1.4826 × the median absolute deviation: a standard deviation that a few
// extreme months do not inflate.
export function robustSd(values: (number | null)[]): number {
  const data = finite(values).sort((a, b) => a - b);
  if (data.length === 0) return 0;
  const centre = median(data);
  const deviations = data
    .map((value) => Math.abs(value - centre))
    .sort((a, b) => a - b);
  return 1.4826 * median(deviations);
}

// Indices of the months more than `k` robust standard deviations from the
// median.
export function outlierIndices(values: (number | null)[], k = 3): number[] {
  const data = finite(values).sort((a, b) => a - b);
  if (data.length === 0) return [];
  const centre = median(data);
  const spread = robustSd(values);
  if (spread === 0) return [];
  const result: number[] = [];
  values.forEach((value, index) => {
    if (value !== null && Math.abs(value - centre) > k * spread) {
      result.push(index);
    }
  });
  return result;
}

// Sample autocorrelation at lags 1..maxLag of a monthly series laid out on
// consecutive months (null = missing). Pairs use the real lag in months, so
// a gap is never closed up; the mean and the denominator use every month
// with a value (the usual biased estimator).
export function autocorrelation(
  values: (number | null)[],
  maxLag = 24,
): number[] {
  const data = finite(values);
  const centre = mean(data);
  if (centre === null) return [];
  const denominator = data.reduce(
    (sum, value) => sum + (value - centre) ** 2,
    0,
  );
  const result: number[] = [];
  for (let lag = 1; lag <= maxLag; lag += 1) {
    if (denominator === 0) {
      result.push(0);
      continue;
    }
    let sum = 0;
    for (let at = 0; at + lag < values.length; at += 1) {
      const first = values[at];
      const second = values[at + lag];
      if (
        first === null ||
        first === undefined ||
        second === null ||
        second === undefined
      ) {
        continue;
      }
      sum += (first - centre) * (second - centre);
    }
    result.push(sum / denominator);
  }
  return result;
}

// The approximate 95% band of the autocorrelation of white noise.
export function whiteNoiseBound(count: number): number {
  return count > 0 ? 1.96 / Math.sqrt(count) : 0;
}

export type Histogram = { edges: number[]; counts: number[] };

// Equal-width bins over the data's range; Sturges' rule for the count,
// kept between 6 and 24.
export function histogram(values: (number | null)[], bins?: number): Histogram {
  const data = finite(values);
  if (data.length === 0) return { edges: [], counts: [] };
  const count =
    bins ?? Math.min(24, Math.max(6, Math.ceil(Math.log2(data.length)) + 1));
  let low = Math.min(...data);
  let high = Math.max(...data);
  if (low === high) {
    low -= 0.5;
    high += 0.5;
  }
  const width = (high - low) / count;
  const edges = Array.from({ length: count + 1 }, (_, at) => low + at * width);
  const counts = new Array<number>(count).fill(0);
  for (const value of data) {
    const bin = Math.min(count - 1, Math.floor((value - low) / width));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  return { edges, counts };
}

export type YearMean = { year: number; mean: number | null; count: number };

// The mean of each calendar year that has any value; `mean` is null unless
// all 12 months have one (so a partial year never stands in for a full one).
export function annualMeans(
  values: (number | null)[],
  months: string[],
): YearMean[] {
  const byYear = new Map<number, number[]>();
  values.forEach((value, index) => {
    const month = months[index];
    if (value === null || month === undefined) return;
    const year = Math.floor(monthNumber(month) / 12);
    const bucket = byYear.get(year) ?? [];
    bucket.push(value);
    byYear.set(year, bucket);
  });
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, bucket]) => ({
      year,
      mean: bucket.length === 12 ? mean(bucket) : null,
      count: bucket.length,
    }));
}

// The x mapping of the interval chart: a number line centred on 0 that
// holds every estimate and interval end with 8% room, so whether an
// interval crosses 0 is seen at once.
export function intervalScale(
  numbers: number[],
  left: number,
  right: number,
): { limit: number; x: (value: number) => number } {
  const largest = Math.max(0, ...numbers.map((value) => Math.abs(value)));
  const limit = largest === 0 ? 1 : largest * 1.08;
  const centre = (left + right) / 2;
  const half = (right - left) / 2;
  return { limit, x: (value) => centre + (value / limit) * half };
}

// Months of the analysed period (inclusive) and how many of them had no
// usable value.
export function periodMonths(first: string, last: string): number {
  return monthNumber(last) - monthNumber(first) + 1;
}

// Linear-extrapolation equivalent of a slope over a period: slope per
// decade × the period's length in decades (months between the first and
// the last month).
export function changeOverPeriod(
  slopePerDecade: number,
  first: string,
  last: string,
): number {
  return (slopePerDecade * (monthNumber(last) - monthNumber(first))) / 120;
}

// One series as CSV: month, value, anomaly, coverage and whether the month
// entered the trend tests (its anomaly is not null).
export function seriesCsv(rows: {
  months: string[];
  values: (number | null)[];
  anomalies: (number | null)[];
  coverage: (number | null)[];
}): string {
  const cell = (value: number | null | undefined) =>
    value === null || value === undefined ? "" : String(value);
  const lines = ["month,value,anomaly,coverage,used_in_trend"];
  rows.months.forEach((month, index) => {
    const value = rows.values[index] ?? null;
    const anomaly = rows.anomalies[index] ?? null;
    if (value === null && anomaly === null) return;
    lines.push(
      [
        month.slice(0, 7),
        cell(value),
        cell(anomaly),
        cell(rows.coverage[index]),
        anomaly === null ? "false" : "true",
      ].join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}
