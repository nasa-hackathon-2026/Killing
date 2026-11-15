// How the global trend map follows the timeline (#197). The trend itself is
// one number per cell for the whole record, so the month does not change the
// colours; it changes how strongly each cell is drawn. Each cell is brighter
// in the calendar months where its own typical value (the monthly
// climatology, the same 12 layers the distribution dots use) is higher, and
// dimmer where it is lower. The cycle repeats every year: it is the typical
// seasonal cycle, not the value of the chosen year. Pure functions.

// Brightness of a cell in its typically lowest month, as a share of its
// brightness in its highest month. Above 0 so a cell never disappears.
export const SEASON_FLOOR = 0.3;
// A cell with almost no seasonal cycle (the tropics, for temperature) would
// otherwise have noise stretched to the full swing: its half-range is raised
// to at least this share of the variable's overall range.
export const MIN_CYCLE_SHARE = 0.05;

export type SeasonalCycle = {
  // Mean of the 12 monthly values of each cell; NaN where a month is missing.
  mean: Float32Array;
  // Half the spread (max − min) of the 12 values, raised to the minimum.
  scale: Float32Array;
};

export function seasonalCycle(
  months: readonly Float32Array[],
  overallSpan: number,
): SeasonalCycle {
  const cells = months[0]?.length ?? 0;
  const mean = new Float32Array(cells);
  const scale = new Float32Array(cells);
  const floor = Math.abs(overallSpan) * MIN_CYCLE_SHARE;
  for (let cell = 0; cell < cells; cell += 1) {
    let sum = 0;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let finite = true;
    for (const layer of months) {
      const value = layer[cell] ?? Number.NaN;
      if (!Number.isFinite(value)) {
        finite = false;
        break;
      }
      sum += value;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    if (!finite || months.length === 0) {
      mean[cell] = Number.NaN;
      scale[cell] = Number.NaN;
    } else {
      mean[cell] = sum / months.length;
      scale[cell] = Math.max((high - low) / 2, floor, Number.EPSILON);
    }
  }
  return { mean, scale };
}

// Value of a cell at a calendar position 0 ≤ p < 12 (0 = mid-January), blended
// linearly between the two nearest months; December runs into January.
export function valueAt(
  months: readonly Float32Array[],
  cell: number,
  position: number,
): number {
  const wrapped = ((position % 12) + 12) % 12;
  const from = Math.floor(wrapped);
  const share = wrapped - from;
  const a = months[from]?.[cell] ?? Number.NaN;
  if (share === 0) return a;
  const b = months[(from + 1) % 12]?.[cell] ?? Number.NaN;
  return a + (b - a) * share;
}

// Brightness factor of a cell, SEASON_FLOOR..1: 1 at the top of its own
// cycle, SEASON_FLOOR at the bottom. Cells without a cycle (NaN) stay at 1,
// so a trend cell with no climatology is drawn as the static map draws it.
export function seasonFactor(
  value: number,
  mean: number,
  scale: number,
  floor = SEASON_FLOOR,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(mean)) return 1;
  const share = Math.min(1, Math.max(0, 0.5 + (0.5 * (value - mean)) / scale));
  return floor + (1 - floor) * share;
}

// Writes into `out` (RGBA, same layout as `base`): colours copied from the
// painted trend map, alpha multiplied by the season factor at `position`.
// The trend map and the climatology are on the same grid (the caller checks).
export function paintSeason(
  base: Uint8Array,
  out: Uint8Array,
  months: readonly Float32Array[],
  cycle: SeasonalCycle,
  position: number,
): void {
  const cells = base.length / 4;
  for (let cell = 0; cell < cells; cell += 1) {
    const at = cell * 4;
    const alpha = base[at + 3] ?? 0;
    out[at] = base[at] ?? 0;
    out[at + 1] = base[at + 1] ?? 0;
    out[at + 2] = base[at + 2] ?? 0;
    if (alpha === 0) {
      out[at + 3] = 0;
      continue;
    }
    const factor = seasonFactor(
      valueAt(months, cell, position),
      cycle.mean[cell] ?? Number.NaN,
      cycle.scale[cell] ?? 1,
    );
    out[at + 3] = Math.round(alpha * factor);
  }
}
