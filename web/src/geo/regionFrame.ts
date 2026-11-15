// A data area drawn on the globe: the bounding box of a region of the
// catalog (data/snapshot/catalog.json, `locations` with kind "region"). The
// box is the sampling area of the area-mean series, nothing more. Pure
// functions: the center, the vertices of a thin outline that follows the
// surface, the camera distance that shows the whole box, and the text of the
// box.

// [west, south, east, north] in degrees, as in the catalog.
export type Bbox = [number, number, number, number];

const DEG = Math.PI / 180;

export function isBbox(value: unknown): value is Bbox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item)) &&
    value[1] < value[3] &&
    value[1] >= -90 &&
    value[3] <= 90
  );
}

function wrapLongitude(lon: number): number {
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

// The middle of the box. A box whose east edge is west of its west edge
// crosses the antimeridian.
export function bboxCenter(bbox: Bbox): { lat: number; lon: number } {
  const [west, south, east, north] = bbox;
  const span = east >= west ? east - west : east + 360 - west;
  return { lat: (south + north) / 2, lon: wrapLongitude(west + span / 2) };
}

// Vertices of the outline, in order around the box (south edge west to east,
// then up the east edge, back along the north edge, down the west edge).
// Every edge is cut into `perEdge` steps, so the line follows the curved
// surface instead of cutting through it. The first vertex is not repeated.
export function bboxFrameVertices(
  bbox: Bbox,
  perEdge = 24,
): { lat: number; lon: number }[] {
  const [west, south, east, north] = bbox;
  const eastEdge = east >= west ? east : east + 360;
  const steps = Math.max(1, Math.floor(perEdge));
  const out: { lat: number; lon: number }[] = [];
  const between = (a: number, b: number, i: number) =>
    a + ((b - a) * i) / steps;
  for (let i = 0; i < steps; i += 1) {
    out.push({ lat: south, lon: wrapLongitude(between(west, eastEdge, i)) });
  }
  for (let i = 0; i < steps; i += 1) {
    out.push({ lat: between(south, north, i), lon: wrapLongitude(eastEdge) });
  }
  for (let i = 0; i < steps; i += 1) {
    out.push({ lat: north, lon: wrapLongitude(between(eastEdge, west, i)) });
  }
  for (let i = 0; i < steps; i += 1) {
    out.push({ lat: between(north, south, i), lon: wrapLongitude(west) });
  }
  return out;
}

export const REGION_MIN_DISTANCE = 1.3;
export const REGION_MAX_DISTANCE = 2;

// Camera distance from the Earth's center at which the whole box fits with
// room around it: the box takes about `fill` of the shorter side of the
// view. `aspect` is width over height of the canvas, `fovDeg` the vertical
// field of view. Clamped so the camera never ends inside the orbit limit or
// far from the surface.
export function regionFrameDistance(
  bbox: Bbox,
  aspect = 1.6,
  fovDeg = 45,
  fill = 0.4,
): number {
  const [west, south, east, north] = bbox;
  const { lat } = bboxCenter(bbox);
  const lonSpan = (east >= west ? east - west : east + 360 - west) * DEG;
  const latSpan = (north - south) * DEG;
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 ? aspect : 1.6;
  // Surface length that fits on the screen at distance d: the height is
  // 2 (d - 1) tan(fov / 2), the width is that times the aspect.
  const needed = Math.max(
    latSpan / fill,
    (lonSpan * Math.max(0.2, Math.cos(lat * DEG))) / (fill * safeAspect),
  );
  const distance = 1 + needed / (2 * Math.tan((fovDeg / 2) * DEG));
  return Math.min(REGION_MAX_DISTANCE, Math.max(REGION_MIN_DISTANCE, distance));
}

// "120.0–122.1°E, 21.8–25.4°N": the box as the note under the place menu
// states it. Hemispheres are written as letters; numbers are not localized
// (they are coordinates).
export function formatBbox(bbox: Bbox): string {
  const [west, south, east, north] = bbox;
  const lon = (value: number) => `${Math.abs(value).toFixed(1)}`;
  const lonUnit = (value: number) => (value < 0 ? "W" : "E");
  const latUnit = (value: number) => (value < 0 ? "S" : "N");
  const lonText =
    lonUnit(west) === lonUnit(east)
      ? `${lon(west)}–${lon(east)}°${lonUnit(east)}`
      : `${lon(west)}°${lonUnit(west)}–${lon(east)}°${lonUnit(east)}`;
  const latText =
    latUnit(south) === latUnit(north)
      ? `${lon(south)}–${lon(north)}°${latUnit(north)}`
      : `${lon(south)}°${latUnit(south)}–${lon(north)}°${latUnit(north)}`;
  return `${lonText}, ${latText}`;
}
