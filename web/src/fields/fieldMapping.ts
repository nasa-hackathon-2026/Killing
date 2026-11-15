// Pure functions behind the global distribution: grid value → level (0..1),
// level → whether and how brightly one dot glows, calendar month blending and
// the near/far blend of the hybrid view. Numbers come from fieldConfig.ts.

import {
  BLEND_FAR_DISTANCE,
  BLEND_NEAR_DISTANCE,
  FIELD_NEAR_STRENGTH,
  LEVEL_FLOOR,
  LOCAL_FAR_STRENGTH,
  MAX_BRIGHTNESS,
  MIN_BRIGHTNESS,
  RANGE_HIGH_QUANTILE,
  RANGE_LOW_QUANTILE,
  THRESHOLD_SOFTNESS,
} from "./fieldConfig";

export type FieldRange = { low: number; high: number };

function quantileOfSorted(sorted: Float64Array, quantile: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(quantile * (sorted.length - 1))),
  );
  return sorted[position] ?? Number.NaN;
}

// Low and high quantiles of every finite value (all months together, cells
// equally weighted). Null when there is no finite value. When the quantiles
// coincide (a flat field) the range is widened so levels stay finite.
export function robustRange(
  values: ArrayLike<number>,
  lowQuantile = RANGE_LOW_QUANTILE,
  highQuantile = RANGE_HIGH_QUANTILE,
): FieldRange | null {
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (Number.isFinite(values[index])) count += 1;
  }
  if (count === 0) return null;
  const finite = new Float64Array(count);
  let next = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN;
    if (Number.isFinite(value)) {
      finite[next] = value;
      next += 1;
    }
  }
  finite.sort();
  const low = quantileOfSorted(finite, lowQuantile);
  const high = quantileOfSorted(finite, highQuantile);
  if (high > low) return { low, high };
  return { low: low - 0.5, high: low + 0.5 };
}

// Level of a value, 0..1: normalised to the range (clamped), raised to gamma,
// then lifted so the lowest valid value keeps LEVEL_FLOOR. NaN (no data)
// stays NaN, which draws nothing.
export function fieldLevel(
  value: number,
  range: FieldRange,
  gamma = 1,
  floor = LEVEL_FLOOR,
): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const share = Math.min(
    1,
    Math.max(0, (value - range.low) / (range.high - range.low)),
  );
  return floor + (1 - floor) * share ** gamma;
}

// Brightness (0..1) of one dot with its random threshold (0..1) at a level.
// The dot is lit when the level is above its threshold, fading in over
// `softness`, so the share of lit dots in an area follows the level (density)
// and lit dots are brighter where the level is higher (brightness).
export function dotBrightness(
  level: number,
  threshold: number,
  softness = THRESHOLD_SOFTNESS,
): number {
  if (!Number.isFinite(level)) return 0;
  const lit = Math.min(1, Math.max(0, (level - threshold) / softness));
  if (lit === 0) return 0;
  return lit * (MIN_BRIGHTNESS + (MAX_BRIGHTNESS - MIN_BRIGHTNESS) * level);
}

// A calendar position 0 ≤ p < 12 (0 = mid-January) as the two monthly layers
// to blend and the share of the second one. December blends into January.
export function monthBlend(position: number): {
  from: number;
  to: number;
  share: number;
} {
  const wrapped = ((position % 12) + 12) % 12;
  const from = Math.floor(wrapped);
  return { from, to: (from + 1) % 12, share: wrapped - from };
}

// Linear blend of two levels; NaN when either month has no data in the cell
// (the dot then draws nothing rather than a half-made value).
export function blendLevels(from: number, to: number, share: number): number {
  if (share === 0) return from;
  if (share === 1) return to;
  return from + (to - from) * share;
}

// Next shown calendar position, moving toward `target` (0..11) along the
// shorter way round the year by at most `step` months. Lets the field slide
// between the 12 climatologies while the timeline plays.
export function followMonth(
  shown: number,
  target: number,
  step: number,
): number {
  let gap = (((target - shown) % 12) + 12) % 12;
  if (gap > 6) gap -= 12;
  if (Math.abs(gap) <= step) return ((target % 12) + 12) % 12;
  const next = shown + Math.sign(gap) * step;
  return ((next % 12) + 12) % 12;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Hybrid view by camera distance from the Earth's centre: `field` multiplies
// the global distribution, `local` the place's particles. Continuous and
// monotonic: far → field 1, local LOCAL_FAR_STRENGTH; near → field
// FIELD_NEAR_STRENGTH, local 1.
export function nearFarBlend(
  distance: number,
  near = BLEND_NEAR_DISTANCE,
  far = BLEND_FAR_DISTANCE,
): { field: number; local: number } {
  const farness = smoothstep(near, far, distance);
  return {
    field: FIELD_NEAR_STRENGTH + (1 - FIELD_NEAR_STRENGTH) * farness,
    local: 1 - (1 - LOCAL_FAR_STRENGTH) * farness,
  };
}

// 0-based calendar month of a "YYYY-MM…" string; null when it does not parse.
export function calendarMonth(month: string | null): number | null {
  if (!month || !/^\d{4}-\d{2}(?:-01)?$/.test(month)) return null;
  const number = Number(month.slice(5, 7));
  return Number.isInteger(number) && number >= 1 && number <= 12
    ? number - 1
    : null;
}

// Two significant digits for the legend ends; whole numbers stay whole.
export function formatFieldValue(value: number): string {
  if (!Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(1);
  if (magnitude >= 10) return String(Math.round(value));
  return String(Number(value.toPrecision(2)));
}
