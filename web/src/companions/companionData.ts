// How a month of data becomes what a companion looks like. Pure functions.
// The rules follow the particle layers (forms/encoding.ts, formMapping.ts)
// so a companion and its particles never disagree.
import { trendCaveat, type TrendCaveat } from "../analysis/trendCaveats";
import type { TrendEntry } from "../analysis/trends";
import { encodeForm, trendSignal, type TrendSignal } from "../forms/encoding";
import { formSpec } from "../forms/formMapping";
import { clampUnit } from "../forms/particleField";
import { intensityAt, valueAt, type SeriesPoint } from "../snapshot/reading";

// Three postures only. No happy or sad faces: a posture says where the month
// sits against its own calendar month, nothing more.
export type CompanionMood = "above" | "near" | "below";

// A month counts as above or below usual when it is at least this many
// standard deviations from the mean of the same calendar month.
export const MOOD_THRESHOLD_Z = 0.5;

// Fewest years of the same calendar month needed to call anything "usual".
export const MIN_CLIMATOLOGY_YEARS = 5;

export function moodFor(anomalyZ: number | null | undefined): CompanionMood {
  if (anomalyZ === null || anomalyZ === undefined || Number.isNaN(anomalyZ)) {
    return "near";
  }
  if (anomalyZ >= MOOD_THRESHOLD_Z) return "above";
  if (anomalyZ <= -MOOD_THRESHOLD_Z) return "below";
  return "near";
}

export type MonthlyAnomaly = {
  // Mean of the same calendar month over the whole record.
  mean: number;
  // value - mean, in the series' unit.
  difference: number;
  // difference / sample standard deviation; null when that is zero.
  z: number | null;
  // Valid years of that calendar month.
  years: number;
  firstYear: string;
  lastYear: string;
};

// The month's value against the mean of the same calendar month in this
// series' own record. Null when the month has no value or the record holds
// too few years of that month.
export function monthlyAnomaly(
  points: SeriesPoint[],
  month: string,
): MonthlyAnomaly | null {
  const value = valueAt(points, month);
  if (value === null) return null;
  const calendarMonth = month.slice(5, 7);
  const same = points.filter(
    (point) =>
      point.value !== null && point.month.slice(5, 7) === calendarMonth,
  );
  if (same.length < MIN_CLIMATOLOGY_YEARS) return null;
  const values = same.map((point) => point.value as number);
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance =
    values.reduce((sum, item) => sum + (item - mean) ** 2, 0) /
    (values.length - 1);
  const deviation = Math.sqrt(variance);
  const years = same.map((point) => point.month.slice(0, 4)).sort();
  return {
    mean,
    difference: value - mean,
    z: deviation > 0 ? (value - mean) / deviation : null,
    years: values.length,
    firstYear: years[0] ?? "",
    lastYear: years.at(-1) ?? "",
  };
}

// Body scale at the series' own minimum and maximum.
export const BODY_SCALE: [number, number] = [0.72, 1];

// Seconds per breath at the slowest and the fastest particle speed.
export const BREATH_LIMITS: [number, number] = [0.9, 5];
// Slowest and fastest speed multiplier of any row in formMapping.ts
// (tested). Speeds span almost two orders of magnitude, so the period
// follows the logarithm of the speed.
export const SPEED_RANGE: [number, number] = [0.04, 3];

export type CompanionDrive = {
  // Multiplier on the drawn size of the body.
  scale: number;
  // Seconds per breath or bounce; shorter is livelier.
  period: number;
  // 0..1, for details that count with the value (leaves, grains, drops).
  amount: number;
};

// `value` is the normalized reading (0 = the series' own minimum, 1 = its
// own maximum), the same number the particle layer receives. Speed goes
// through the variable's own encoding row, including the square-root law of
// the temperatures.
export function companionDrive(
  variableId: string,
  value: number | null | undefined,
): CompanionDrive {
  const amount = clampUnit(value ?? 0);
  const spec = formSpec(variableId);
  const speed = spec ? encodeForm(amount, spec.encoding).speed : 1;
  const clamped = Math.min(SPEED_RANGE[1], Math.max(SPEED_RANGE[0], speed));
  const fastness =
    Math.log(clamped / SPEED_RANGE[0]) /
    Math.log(SPEED_RANGE[1] / SPEED_RANGE[0]);
  const period =
    BREATH_LIMITS[1] - (BREATH_LIMITS[1] - BREATH_LIMITS[0]) * fastness;
  return {
    scale: BODY_SCALE[0] + (BODY_SCALE[1] - BODY_SCALE[0]) * amount,
    period,
    amount,
  };
}

export type CompanionReading = {
  // Raw value in the series' unit; null for a month without data.
  raw: number | null;
  unit: string;
  // Normalized 0..1; null for a month without data.
  value: number | null;
  anomaly: MonthlyAnomaly | null;
  mood: CompanionMood;
  signal: TrendSignal;
  trend: TrendEntry | undefined;
  caveat: TrendCaveat | null;
};

// Everything a companion needs for one variable, place and month.
export function companionReading(
  variableId: string,
  series: { unit: string; points: SeriesPoint[] } | undefined,
  month: string | null,
  trend: TrendEntry | undefined,
  // The trends file's known_issues table (decides the "not reliable" mark).
  issues?: Record<string, { kind: string }>,
): CompanionReading {
  const raw = series && month ? valueAt(series.points, month) : null;
  const anomaly = series && month ? monthlyAnomaly(series.points, month) : null;
  return {
    raw,
    unit: series?.unit ?? "",
    value:
      series && month && raw !== null
        ? intensityAt(series.points, month)
        : null,
    anomaly,
    mood: moodFor(anomaly?.z),
    signal: trendSignal(trend, issues),
    trend,
    caveat: trendCaveat(variableId),
  };
}
