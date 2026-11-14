// SVG coordinates of the time series chart; pure functions.

export type Scale = (value: number) => number;

export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const span = domain[1] - domain[0];
  if (span === 0) return () => (range[0] + range[1]) / 2;
  return (value) =>
    range[0] + ((value - domain[0]) / span) * (range[1] - range[0]);
}

// Smallest and largest of the non-null values, padded by 6% so the line does
// not touch the frame; null when there is nothing to draw.
export function paddedExtent(
  groups: (number | null)[][],
): [number, number] | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const values of groups) {
    for (const value of values) {
      if (value === null) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  if (low > high) return null;
  const pad = low === high ? Math.abs(low) * 0.1 || 1 : (high - low) * 0.06;
  return [low - pad, high + pad];
}

// About `target` round tick values (1, 2 or 5 × a power of ten apart) inside
// the domain.
export function niceTicks(domain: [number, number], target = 4): number[] {
  const span = domain[1] - domain[0];
  if (!(span > 0)) return [domain[0]];
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((factor) => factor * power).find((size) => size >= raw) ??
    10 * power;
  const ticks: number[] = [];
  const first = Math.ceil(domain[0] / step);
  for (let at = first; at * step <= domain[1] + step * 1e-9; at += 1) {
    // Rounds away the binary noise of at * step (0.30000000000000004).
    ticks.push(Number((at * step).toPrecision(12)));
  }
  return ticks;
}

export function formatTick(value: number, ticks: number[]): string {
  const largest = Math.max(...ticks.map((tick) => Math.abs(tick)));
  if (largest !== 0 && (largest >= 1e5 || largest < 0.01)) {
    return value === 0 ? "0" : value.toExponential(1);
  }
  const step =
    ticks.length > 1 ? Math.abs((ticks[1] ?? 0) - (ticks[0] ?? 0)) : 1;
  const digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
  return value.toFixed(digits);
}

// Years to label on the time axis: every `step` years, with the step chosen
// so there are at most `maxTicks` labels. Input and output are month numbers
// (year × 12 + month − 1) of each January.
export function yearTicks(start: number, end: number, maxTicks = 7): number[] {
  const firstYear = Math.ceil(start / 12);
  const lastYear = Math.floor(end / 12);
  const count = lastYear - firstYear + 1;
  if (count <= 0) return [];
  const step =
    [1, 2, 5, 10, 20, 50].find(
      (size) =>
        Math.floor(lastYear / size) - Math.ceil(firstYear / size) + 1 <=
        maxTicks,
    ) ?? 100;
  const ticks: number[] = [];
  for (
    let year = Math.ceil(firstYear / step) * step;
    year <= lastYear;
    year += step
  ) {
    ticks.push(year * 12);
  }
  return ticks;
}

function fixed(value: number): string {
  return value.toFixed(1);
}

// An SVG path through the non-null values. A null breaks the line (the gap
// is not bridged); a value with nulls on both sides becomes a zero-length
// segment, which a round line cap draws as a dot.
export function linePath(
  values: (number | null)[],
  x: (index: number) => number,
  y: Scale,
): string {
  const parts: string[] = [];
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      open = false;
      return;
    }
    const at = `${fixed(x(index))} ${fixed(y(value))}`;
    if (open) {
      parts.push(`L${at}`);
      return;
    }
    const next = values[index + 1];
    parts.push(next === null || next === undefined ? `M${at}L${at}` : `M${at}`);
    open = true;
  });
  return parts.join("");
}

// The index whose x position is nearest to a pointer position, for evenly
// spaced indices between `left` (index 0) and `right` (index count − 1).
export function nearestIndex(
  position: number,
  left: number,
  right: number,
  count: number,
): number {
  if (count <= 1 || right === left) return 0;
  const index = Math.round(((position - left) / (right - left)) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}
