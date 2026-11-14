export type SeriesPoint = {
  month: string;
  value: number | null;
};

export function valueAt(points: SeriesPoint[], month: string): number | null {
  const point = points.find((item) => item.month === month);
  if (!point) return null;
  return point.value;
}

export function seriesBounds(
  points: SeriesPoint[],
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const point of points) {
    if (point.value === null) continue;
    found = true;
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  if (!found) return null;
  return { min, max };
}

// 0 is this series' own minimum and 1 is its own maximum. A missing month
// stays empty. Equal values are a real measurement, so they read as full.
export function intensityAt(points: SeriesPoint[], month: string): number {
  const value = valueAt(points, month);
  const bounds = seriesBounds(points);
  if (value === null || bounds === null) return 0;
  if (bounds.max === bounds.min) return 1;
  return (value - bounds.min) / (bounds.max - bounds.min);
}

export function formatMeasurement(value: number | null, unit: string): string {
  if (value === null) return "No data";
  if (unit === "K") return `${(value - 273.15).toFixed(1)} °C`;
  const absolute = Math.abs(value);
  const text =
    absolute !== 0 && (absolute >= 1e5 || absolute < 0.01)
      ? value.toExponential(2)
      : value.toFixed(absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2);
  if (unit === "1") return text;
  return `${text} ${unit}`;
}

export function sortedMonths(groups: SeriesPoint[][]): string[] {
  const months = new Set<string>();
  for (const points of groups) {
    for (const point of points) months.add(point.month);
  }
  return [...months].sort();
}

// The month the slider starts on: the latest month in which the largest
// number of series have a value. Products end in different months, so the
// very last month is mostly empty.
export function bestDefaultMonth(groups: SeriesPoint[][]): string | null {
  const counts = new Map<string, number>();
  for (const points of groups) {
    for (const point of points) {
      if (point.value === null) continue;
      counts.set(point.month, (counts.get(point.month) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount || (count === bestCount && month > (best ?? ""))) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}
