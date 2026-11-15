import type { TrendMap } from "../trendmap/loadTrendMap";
import type { FieldData } from "./loadField";

// RGB (0..1) and strength (0..1) of each dot from the painted trend map: the
// colour of its cell, dimmed where the cell is not significant or barely
// changes (the alpha of the painted pixel). Null when the map is not on the
// grid of the dots, which then keep the layer's own colour.
export function trendDotColors(
  trendMap: TrendMap | null,
  field: FieldData,
): Float32Array | null {
  if (!trendMap) return null;
  const a = trendMap.spec;
  const b = field.spec;
  if (
    a.nLat !== b.nLat ||
    a.nLon !== b.nLon ||
    a.latSouth !== b.latSouth ||
    a.lonWest !== b.lonWest ||
    a.latStep !== b.latStep ||
    a.lonStep !== b.lonStep
  ) {
    return null;
  }
  const { dots } = field;
  const out = new Float32Array(dots.count * 4);
  for (let dot = 0; dot < dots.count; dot += 1) {
    const at = (dots.cell[dot] ?? 0) * 4;
    out[dot * 4] = (trendMap.pixels[at] ?? 255) / 255;
    out[dot * 4 + 1] = (trendMap.pixels[at + 1] ?? 255) / 255;
    out[dot * 4 + 2] = (trendMap.pixels[at + 2] ?? 255) / 255;
    out[dot * 4 + 3] = (trendMap.pixels[at + 3] ?? 255) / 255;
  }
  return out;
}
