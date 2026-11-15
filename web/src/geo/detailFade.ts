import { TAIWAN_DETAIL } from "./detailCoverage";

// The Taiwan close-up fades out toward its border so the patch blends into
// the globe instead of ending in a hard square edge. The fade covers this
// fraction of the patch's width and height on each side (about 1°), which
// leaves the main island (about 21.9–25.3° N, 120.0–122.0° E) fully opaque.
export const DETAIL_FADE_FRACTION = 0.15;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Opacity at patch coordinates u (west 0 → east 1), v (south 0 → north 1).
function edgeAlphaAt(u: number, v: number): number {
  const fromSide = Math.min(u, 1 - u);
  const fromTopOrBottom = Math.min(v, 1 - v);
  return (
    smoothstep(0, DETAIL_FADE_FRACTION, fromSide) *
    smoothstep(0, DETAIL_FADE_FRACTION, fromTopOrBottom)
  );
}

export function detailEdgeAlpha(lat: number, lon: number): number {
  const { south, north, west, east } = TAIWAN_DETAIL;
  return edgeAlphaAt(
    (lon - west) / (east - west),
    (lat - south) / (north - south),
  );
}

// The fade as an RGBA mask (size × size, first row is the south edge) for
// a material's alphaMap, which reads the green channel.
export function detailFadeMask(size: number): Uint8Array {
  const mask = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const alpha = edgeAlphaAt((column + 0.5) / size, (row + 0.5) / size);
      const value = Math.round(alpha * 255);
      const at = (row * size + column) * 4;
      mask[at] = value;
      mask[at + 1] = value;
      mask[at + 2] = value;
      mask[at + 3] = 255;
    }
  }
  return mask;
}
