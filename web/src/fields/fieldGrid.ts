// Reads data/grid/<id>/monthly_climatology.i16 with the trend map's decoder
// and cell lookup (trendmap/trendGrid.ts), and places the dots. Pure.

import {
  cellIndex,
  decodeSlopes,
  type TrendGridMeta,
  type TrendGridSpec,
} from "../trendmap/trendGrid";
import { fieldLevel, robustRange, type FieldRange } from "./fieldMapping";

export const CLIMATOLOGY_LAYER = "monthly_climatology";
const ROW_ORDER = "lat (south to north), lon (west to east)";

// The parts of meta.json the field uses (a superset of what the trend map
// reads, minus the trend block, which OMI-style grids may not have).
export type FieldGridMeta = Pick<
  TrendGridMeta,
  "id" | "name_en" | "product" | "grid" | "encoding"
> & {
  layers: (TrendGridMeta["layers"][number] & { labels?: string[] })[];
  coverage?: { complete_years?: [number, number] };
};

export type FieldGridSpec = TrendGridSpec & {
  climatology: {
    file: string;
    unit: string;
    labels: string[];
    period: [number, number] | null;
  };
};

// Grid and climatology layer of meta.json, as a TrendGridSpec whose `slope`
// layer is the climatology, so trendGrid's decoder reads it. Throws instead
// of guessing when the layout is not the expected one.
export function fieldGridSpec(meta: FieldGridMeta): FieldGridSpec {
  const { grid, encoding } = meta;
  if (!grid.order.includes(ROW_ORDER)) {
    throw new Error(`unexpected grid order: ${grid.order}`);
  }
  if (encoding.dtype !== "int16" || encoding.byte_order !== "little") {
    throw new Error(
      `unexpected encoding: ${encoding.dtype} ${encoding.byte_order}`,
    );
  }
  const layer = meta.layers.find((item) => item.name === CLIMATOLOGY_LAYER);
  if (!layer) throw new Error("no monthly_climatology layer in meta.json");
  const labels = layer.labels ?? [];
  const expected = Array.from({ length: 12 }, (_, index) =>
    String(index + 1).padStart(2, "0"),
  );
  if (labels.join(",") !== expected.join(",")) {
    throw new Error(`unexpected climatology labels: ${labels.join(",")}`);
  }
  const years = meta.coverage?.complete_years;
  return {
    nLat: grid.n_lat,
    nLon: grid.n_lon,
    latSouth: grid.lat_south_edge,
    latStep: grid.lat_step,
    lonWest: grid.lon_west_edge,
    lonStep: grid.lon_step,
    slope: {
      file: layer.file,
      unit: layer.unit,
      scale: layer.scale,
      offset: layer.offset,
      missing: layer.missing ?? encoding.missing,
    },
    significance: { file: "", missing: 0 },
    climatology: {
      file: layer.file,
      unit: layer.unit,
      labels,
      period: years ? [years[0], years[1]] : null,
    },
  };
}

// The 12 monthly layers, each nLat × nLon from the south-west corner, NaN
// where there is no data.
export function decodeClimatology(
  buffer: ArrayBuffer,
  spec: FieldGridSpec,
): Float32Array[] {
  const cells = spec.nLat * spec.nLon;
  if (buffer.byteLength !== cells * 2 * 12) {
    throw new Error(
      `climatology file has ${buffer.byteLength} bytes, expected ${cells * 24}`,
    );
  }
  return Array.from({ length: 12 }, (_, month) =>
    decodeSlopes(
      buffer.slice(month * cells * 2, (month + 1) * cells * 2),
      spec,
    ),
  );
}

// Seeded generator in [0, 1), so the dots land in the same places every load.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FieldDots = {
  count: number;
  lat: Float32Array;
  lon: Float32Array;
  // Grid cell under each dot.
  cell: Int32Array;
  // Random threshold (0..1) of each dot; see dotBrightness.
  threshold: Float32Array;
  // Level (0..1, NaN = no data) of each dot in each month: dot × 12 + month.
  levels: Float32Array;
};

// A cell is usable when it has data in at least one month.
export function validCells(months: Float32Array[]): Uint8Array {
  const cells = months[0]?.length ?? 0;
  const valid = new Uint8Array(cells);
  for (const layer of months) {
    for (let index = 0; index < cells; index += 1) {
      if (Number.isFinite(layer[index])) valid[index] = 1;
    }
  }
  return valid;
}

// Up to `count` dots, uniform over the sphere's area (so dot density per
// area follows the level and nothing else), kept only where the cell under
// them has data.
export function placeDots(
  spec: FieldGridSpec,
  months: Float32Array[],
  range: FieldRange,
  gamma: number,
  count: number,
  maxAttemptsPerDot: number,
  seed = 1,
): FieldDots {
  const random = seededRandom(seed);
  const valid = validCells(months);
  const lat = new Float32Array(count);
  const lon = new Float32Array(count);
  const cell = new Int32Array(count);
  const threshold = new Float32Array(count);
  let placed = 0;
  const attempts = count * maxAttemptsPerDot;
  for (let attempt = 0; attempt < attempts && placed < count; attempt += 1) {
    const latDeg = (Math.asin(2 * random() - 1) * 180) / Math.PI;
    const lonDeg = random() * 360 - 180;
    const index = cellIndex(spec, latDeg, lonDeg);
    if (index === null || !valid[index]) continue;
    lat[placed] = latDeg;
    lon[placed] = lonDeg;
    cell[placed] = index;
    threshold[placed] = random();
    placed += 1;
  }
  const levels = new Float32Array(placed * 12);
  for (let dot = 0; dot < placed; dot += 1) {
    for (let month = 0; month < 12; month += 1) {
      levels[dot * 12 + month] = fieldLevel(
        months[month]?.[cell[dot] ?? 0] ?? Number.NaN,
        range,
        gamma,
      );
    }
  }
  return {
    count: placed,
    lat: lat.subarray(0, placed),
    lon: lon.subarray(0, placed),
    cell: cell.subarray(0, placed),
    threshold: threshold.subarray(0, placed),
    levels,
  };
}

// Range of all 12 months together.
export function climatologyRange(months: Float32Array[]): FieldRange | null {
  const cells = months[0]?.length ?? 0;
  const all = new Float32Array(cells * months.length);
  months.forEach((layer, month) => all.set(layer, month * cells));
  return robustRange(all);
}
