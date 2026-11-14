// Reads the per-cell trend maps written by `trend_detective.grid_derive`
// (data/grid/<id>/: meta.json, trend_slope_per_decade.i16,
// trend_significance.u8) and turns them into an RGBA image. Pure functions:
// nothing here computes or interprets a trend. The Python reference reader is
// `trend_detective.grid.read_frontend`.

import {
  NOT_SIGNIFICANT_ALPHA,
  RANGE_QUANTILE,
  SIGNIFICANT_ALPHA,
  ZERO_CHANGE_STRENGTH,
  type Rgb,
} from "./trendMapConfig";

// Classes of trend_significance.u8 (see `classes` in meta.json).
export const SIGNIFICANCE_MISSING = 0;
export const SIGNIFICANCE_NONE = 1;
export const SIGNIFICANCE_UNCORRECTED_ONLY = 2;
export const SIGNIFICANCE_FDR = 3;

type MetaLayer = {
  name: string;
  file: string;
  unit: string;
  scale: number;
  offset: number;
  dtype?: string;
  missing?: number;
  classes?: Record<string, string>;
};

// The parts of meta.json this module and the legend use.
export type TrendGridMeta = {
  id: string;
  name_en: string;
  product: string;
  grid: {
    n_lat: number;
    n_lon: number;
    lat_south_edge: number;
    lat_step: number;
    lon_west_edge: number;
    lon_step: number;
    order: string;
  };
  encoding: { dtype: string; byte_order: string; missing: number };
  trend: {
    parameters: { alpha: number };
    period: { first_month: string; last_month: string; n_months: number };
    cells: { n_total: number; n_analyzed: number };
    significant: {
      uncorrected: { area_fraction: number };
      fdr: { area_fraction: number };
    };
  };
  layers: MetaLayer[];
};

export type TrendGridSpec = {
  nLat: number;
  nLon: number;
  // Edges, not cell centres: row i covers latSouth + i × latStep up to
  // latSouth + (i + 1) × latStep, and likewise for columns.
  latSouth: number;
  latStep: number;
  lonWest: number;
  lonStep: number;
  slope: {
    file: string;
    unit: string;
    scale: number;
    offset: number;
    missing: number;
  };
  significance: { file: string; missing: number };
};

const ROW_ORDER = "lat (south to north), lon (west to east)";

// Checks that the files are laid out the way this reader assumes and picks
// out the two trend layers. Throws instead of guessing when they are not.
export function trendGridSpec(meta: TrendGridMeta): TrendGridSpec {
  const { grid, encoding } = meta;
  if (!grid.order.includes(ROW_ORDER)) {
    throw new Error(`unexpected grid order: ${grid.order}`);
  }
  if (encoding.dtype !== "int16" || encoding.byte_order !== "little") {
    throw new Error(
      `unexpected encoding: ${encoding.dtype} ${encoding.byte_order}`,
    );
  }
  const slope = meta.layers.find(
    (layer) => layer.name === "trend_slope_per_decade",
  );
  const significance = meta.layers.find(
    (layer) => layer.name === "trend_significance",
  );
  if (!slope || !significance) throw new Error("no trend layers in meta.json");
  if (significance.dtype !== "uint8") {
    throw new Error(`unexpected significance dtype: ${significance.dtype}`);
  }
  const classes = Object.keys(significance.classes ?? {}).sort();
  if (classes.join(",") !== "0,1,2,3") {
    throw new Error(`unexpected significance classes: ${classes.join(",")}`);
  }
  return {
    nLat: grid.n_lat,
    nLon: grid.n_lon,
    latSouth: grid.lat_south_edge,
    latStep: grid.lat_step,
    lonWest: grid.lon_west_edge,
    lonStep: grid.lon_step,
    slope: {
      file: slope.file,
      unit: slope.unit,
      scale: slope.scale,
      offset: slope.offset,
      missing: slope.missing ?? encoding.missing,
    },
    significance: {
      file: significance.file,
      missing: significance.missing ?? SIGNIFICANCE_MISSING,
    },
  };
}

// Slope per decade of every cell, row-major from the south-west corner; NaN
// where the cell has no data or was not analysed.
export function decodeSlopes(
  buffer: ArrayBuffer,
  spec: TrendGridSpec,
): Float32Array {
  const cells = spec.nLat * spec.nLon;
  if (buffer.byteLength !== cells * 2) {
    throw new Error(
      `slope file has ${buffer.byteLength} bytes, expected ${cells * 2}`,
    );
  }
  const view = new DataView(buffer);
  const slopes = new Float32Array(cells);
  for (let index = 0; index < cells; index += 1) {
    const stored = view.getInt16(index * 2, true);
    slopes[index] =
      stored === spec.slope.missing
        ? Number.NaN
        : stored * spec.slope.scale + spec.slope.offset;
  }
  return slopes;
}

export function decodeSignificance(
  buffer: ArrayBuffer,
  spec: TrendGridSpec,
): Uint8Array {
  const cells = spec.nLat * spec.nLon;
  if (buffer.byteLength !== cells) {
    throw new Error(
      `significance file has ${buffer.byteLength} bytes, expected ${cells}`,
    );
  }
  return new Uint8Array(buffer);
}

// Index of the cell that contains a point, or null outside the grid.
export function cellIndex(
  spec: TrendGridSpec,
  latDeg: number,
  lonDeg: number,
): number | null {
  const row = Math.floor((latDeg - spec.latSouth) / spec.latStep);
  const turns = (lonDeg - spec.lonWest) / 360;
  const east = (turns - Math.floor(turns)) * 360;
  const column = Math.floor(east / spec.lonStep);
  if (row < 0 || row >= spec.nLat || column >= spec.nLon) return null;
  return row * spec.nLon + column;
}

function roundToTwoDigits(value: number): number {
  return Number(value.toPrecision(2));
}

// Half-width L of the symmetric colour range ±L: a high quantile of the
// absolute slopes, rounded to two significant digits so the legend reads
// cleanly. 1 when there is nothing to show.
export function symmetricLimit(
  slopes: Float32Array,
  quantile = RANGE_QUANTILE,
): number {
  const magnitudes = Array.from(slopes)
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value))
    .sort((a, b) => a - b);
  if (magnitudes.length === 0) return 1;
  const position = Math.min(
    magnitudes.length - 1,
    Math.max(0, Math.ceil(quantile * magnitudes.length) - 1),
  );
  const limit = roundToTwoDigits(magnitudes[position] ?? 0);
  return limit > 0 ? limit : 1;
}

// Colour of a slope on a diverging ramp: -limit and below is the first stop,
// 0 the middle one, +limit and above the last.
export function divergingColor(
  slope: number,
  limit: number,
  palette: readonly Rgb[],
): Rgb {
  const clamped = Math.max(-1, Math.min(1, slope / limit));
  const position = ((clamped + 1) / 2) * (palette.length - 1);
  const lower = Math.min(palette.length - 2, Math.floor(position));
  const share = position - lower;
  const from = palette[lower] ?? [0, 0, 0];
  const to = palette[lower + 1] ?? from;
  return [
    Math.round(from[0] + (to[0] - from[0]) * share),
    Math.round(from[1] + (to[1] - from[1]) * share),
    Math.round(from[2] + (to[2] - from[2]) * share),
  ];
}

// Opacity (0 to 1) of a cell: full for trends significant after FDR
// correction, faded for the two other analysed classes, 0 for missing.
export function significanceAlpha(category: number): number {
  if (category === SIGNIFICANCE_FDR) return SIGNIFICANT_ALPHA;
  if (
    category === SIGNIFICANCE_NONE ||
    category === SIGNIFICANCE_UNCORRECTED_ONLY
  ) {
    return NOT_SIGNIFICANT_ALPHA;
  }
  return 0;
}

// Factor (ZERO_CHANGE_STRENGTH to 1) on a cell's opacity by the size of its
// trend: weakest at zero change, where the ramp is near-white, and full at
// ±limit and beyond. The colour itself is not changed.
export function changeStrength(slope: number, limit: number): number {
  const share = Math.min(1, Math.abs(slope) / limit);
  return ZERO_CHANGE_STRENGTH + (1 - ZERO_CHANGE_STRENGTH) * share;
}

// RGBA bytes, one pixel per cell in file order (first row = southernmost).
// Colour is the slope on the ramp; opacity is the significance class times
// the strength of the change.
export function paintTrendMap(
  slopes: Float32Array,
  significance: Uint8Array,
  limit: number,
  palette: readonly Rgb[],
): Uint8Array {
  const pixels = new Uint8Array(slopes.length * 4);
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index] ?? Number.NaN;
    const alpha = significanceAlpha(significance[index] ?? 0);
    if (!Number.isFinite(slope) || alpha === 0) continue;
    const [red, green, blue] = divergingColor(slope, limit, palette);
    pixels[index * 4] = red;
    pixels[index * 4 + 1] = green;
    pixels[index * 4 + 2] = blue;
    pixels[index * 4 + 3] = Math.round(
      alpha * changeStrength(slope, limit) * 255,
    );
  }
  return pixels;
}

const DEG = Math.PI / 180;

// Arguments of a three.js SphereGeometry patch that covers exactly the grid,
// edge to edge. With the conventions of geo/latLon.ts (longitude -180 at
// phi = 0, theta measured from the north pole) the patch's own UVs then run
// u: west edge to east edge, v: south edge to north edge, which is the order
// of the pixels from paintTrendMap in an unflipped DataTexture.
export function gridSpherePatch(spec: TrendGridSpec): {
  phiStart: number;
  phiLength: number;
  thetaStart: number;
  thetaLength: number;
} {
  const latNorth = spec.latSouth + spec.nLat * spec.latStep;
  return {
    phiStart: (spec.lonWest + 180) * DEG,
    phiLength: spec.nLon * spec.lonStep * DEG,
    thetaStart: (90 - latNorth) * DEG,
    thetaLength: spec.nLat * spec.latStep * DEG,
  };
}

// "K per decade" → "°C": a difference of 1 K equals a difference of 1 °C.
export function slopeUnitLabel(unit: string): string {
  const base = unit.replace(/ per decade$/, "");
  return base === "K" ? "°C" : base;
}

export function formatSlope(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e4 || magnitude < 1e-3) return value.toExponential(1);
  return String(Number(value.toPrecision(2)));
}
