// Colours of the globe marks. They reuse the ramps of the global trend map
// (trendmap/trendMapConfig.ts): temperature in blue (falling) and red
// (rising), water and everything else in brown (falling) and teal (rising),
// both ColorBrewer schemes that stay apart for red-green colour blindness.
import { divergingColor } from "../trendmap/trendGrid";
import {
  PALETTES,
  trendMapVariable,
  type PaletteId,
  type Rgb,
} from "../trendmap/trendMapConfig";

// Variables that are a temperature but have no global trend map.
const TEMPERATURE_LIKE = new Set([
  "gldas_tair",
  "airs_tsurf",
  "merra2_t2m",
  "modis_lst",
  "power_t2m",
]);

export function paletteFor(variableId: string): PaletteId {
  const mapped = trendMapVariable(variableId);
  if (mapped) return mapped.palette;
  return TEMPERATURE_LIKE.has(variableId) ? "blue-red" : "brown-teal";
}

function mix(a: Rgb, b: Rgb, share: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * share),
    Math.round(a[1] + (b[1] - a[1]) * share),
    Math.round(a[2] + (b[2] - a[2]) * share),
  ];
}

// The colour of a rising or falling mark: between the two outer stops of the
// ramp, strong enough to read against dark ocean and bright land.
export function directionColor(palette: PaletteId, direction: 1 | -1): Rgb {
  const stops = PALETTES[palette];
  const last = stops.length - 1;
  return direction > 0
    ? mix(stops[last - 1], stops[last], 0.35)
    : mix(stops[0], stops[1], 0.35);
}

// A colour of the same ramp for a size of change (model vs station discs).
export function slopeColor(
  slope: number,
  limit: number,
  palette: PaletteId,
): Rgb {
  return divergingColor(slope, limit, PALETTES[palette]);
}

// Pulls a colour toward grey: the look of a mark that is not to be trusted.
export function desaturate(color: Rgb, amount: number): Rgb {
  const grey = Math.round(0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2]);
  return mix(color, [grey, grey, grey], amount);
}

export function css(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}
