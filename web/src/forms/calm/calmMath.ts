// The Calm particle style, as pure functions: how a normalized value
// becomes countable units, where the units sit in the cluster, how big the
// cluster's disc and its "usual" ring are, and how they move between months.
//
// The value is the same normalized reading the Lively style receives
// (0 = the series' own minimum, 1 = its own maximum; snapshot/reading.ts).
import { monthlyAnomaly } from "../../companions/companionData";
import {
  seriesBounds,
  valueAt,
  type SeriesPoint,
} from "../../snapshot/reading";
import { clampUnit } from "../particleField";

// Units drawn at the series' own maximum.
export const CALM_MAX_UNITS = 25;
// This many small units combine into one big one.
export const CALM_GROUP_SIZE = 5;
// A month with data never shows fewer units than this, so the series' own
// minimum does not look like "No data" (0 units).
export const CALM_MIN_UNITS = 1;

// The value on the unit scale, not rounded: the cluster's disc and the
// "usual" ring both use it, so they share one scale.
export function calmUnitValue(value: number, hasData = true): number {
  if (!hasData || Number.isNaN(value)) return 0;
  return Math.max(CALM_MIN_UNITS, clampUnit(value) * CALM_MAX_UNITS);
}

// Whole units drawn for a value.
export function calmUnits(value: number, hasData = true): number {
  return Math.round(calmUnitValue(value, hasData));
}

// How many big (combined) and small (single) shapes make up `units`.
export function calmSplit(units: number): { big: number; small: number } {
  const whole = Math.max(0, Math.floor(units));
  return {
    big: Math.floor(whole / CALM_GROUP_SIZE),
    small: whole % CALM_GROUP_SIZE,
  };
}

// Lengths below are in unit radii (one small unit has radius 1).

// Distance of the five units of a big shape from its center. Less than a
// loose ring would need, so the five overlap and read as one clump.
export const CALM_CLUMP_RADIUS = 1.3;
// Room a big shape takes when shapes are packed.
export const CALM_BIG_RADIUS = 2.45;
// Room a single unit takes when shapes are packed.
export const CALM_SMALL_RADIUS = 1.12;
// Disc radius = CALM_PACKING * sqrt(units): area follows the value, and
// every layout of 1..25 units fits inside its own disc (tested).
export const CALM_PACKING = 1.62;

export function calmRadius(unitValue: number): number {
  if (!(unitValue > 0)) return 0;
  return CALM_PACKING * Math.sqrt(unitValue);
}

// Radius of the ring that marks what is usual for the calendar month.
// `usual` is the normalized mean of that calendar month; null = unknown.
export function calmUsualRadius(usual: number | null | undefined): number {
  if (usual === null || usual === undefined || Number.isNaN(usual)) return 0;
  return calmRadius(calmUnitValue(usual));
}

// The mean of this calendar month over the whole record (monthlyAnomaly in
// companionData.ts), on the same 0..1 scale as intensityAt. It does not
// depend on the year, so a month without a value still has one. Null when
// the record holds too few years of that calendar month.
export function usualIntensity(
  points: SeriesPoint[],
  month: string,
): number | null {
  const bounds = seriesBounds(points);
  if (!bounds) return null;
  const calendarMonth = month.slice(5, 7);
  const reference =
    valueAt(points, month) !== null
      ? month
      : points.find(
          (point) =>
            point.value !== null && point.month.slice(5, 7) === calendarMonth,
        )?.month;
  if (!reference) return null;
  const anomaly = monthlyAnomaly(points, reference);
  if (!anomaly) return null;
  if (bounds.max === bounds.min) return 1;
  return clampUnit((anomaly.mean - bounds.min) / (bounds.max - bounds.min));
}

export type Point = { x: number; y: number };
type Circle = Point & { r: number };

function overlaps(circle: Circle, placed: Circle[]): boolean {
  return placed.some(
    (other) =>
      Math.hypot(circle.x - other.x, circle.y - other.y) <
      circle.r + other.r - 1e-6,
  );
}

// Places circles one after another, each as close to the first as it can
// get while touching two circles already placed. Deterministic.
function pack(radii: number[]): Circle[] {
  const placed: Circle[] = [];
  for (const r of radii) {
    const first = placed[0];
    if (!first) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    if (placed.length === 1) {
      placed.push({ x: first.r + r, y: 0, r });
      continue;
    }
    let best: Circle | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i] as Circle;
        const b = placed[j] as Circle;
        const da = a.r + r;
        const db = b.r + r;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d === 0 || d > da + db) continue;
        const along = (da * da - db * db + d * d) / (2 * d);
        const across = da * da - along * along;
        if (across < 0) continue;
        const ux = (b.x - a.x) / d;
        const uy = (b.y - a.y) / d;
        for (const side of [1, -1]) {
          const h = Math.sqrt(across) * side;
          const candidate = {
            x: a.x + ux * along - uy * h,
            y: a.y + uy * along + ux * h,
            r,
          };
          const distance = Math.hypot(candidate.x, candidate.y);
          if (distance < bestDistance - 1e-9 && !overlaps(candidate, placed)) {
            best = candidate;
            bestDistance = distance;
          }
        }
      }
    }
    placed.push(best ?? { x: first.r + r, y: 0, r });
  }
  // Center the whole arrangement on the middle of its bounding box.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const circle of placed) {
    minX = Math.min(minX, circle.x - circle.r);
    maxX = Math.max(maxX, circle.x + circle.r);
    minY = Math.min(minY, circle.y - circle.r);
    maxY = Math.max(maxY, circle.y + circle.r);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return placed.map((circle) => ({
    x: circle.x - cx,
    y: circle.y - cy,
    r: circle.r,
  }));
}

export type CalmLayout = {
  // Center of every unit, in drawing order: unit i belongs to big shape
  // floor(i / CALM_GROUP_SIZE) when that shape is complete, otherwise it is
  // a single.
  units: Point[];
  // Center of every big (combined) shape.
  bigs: Point[];
};

const layouts = new Map<number, CalmLayout>();

// Where the units of a cluster sit. Big shapes are packed first, then the
// singles around them. Unit indices are stable: going from 4 to 5 units
// moves the same five shapes together into one clump.
export function calmLayout(units: number): CalmLayout {
  const whole = Math.min(CALM_MAX_UNITS, Math.max(0, Math.floor(units)));
  const cached = layouts.get(whole);
  if (cached) return cached;
  const { big, small } = calmSplit(whole);
  const circles = pack([
    ...Array.from({ length: big }, () => CALM_BIG_RADIUS),
    ...Array.from({ length: small }, () => CALM_SMALL_RADIUS),
  ]);
  const bigs = circles.slice(0, big).map(({ x, y }) => ({ x, y }));
  const positions: Point[] = [];
  for (const center of bigs) {
    for (let k = 0; k < CALM_GROUP_SIZE; k += 1) {
      const angle = Math.PI / 2 + (k * 2 * Math.PI) / CALM_GROUP_SIZE;
      positions.push({
        x: center.x + CALM_CLUMP_RADIUS * Math.cos(angle),
        y: center.y + CALM_CLUMP_RADIUS * Math.sin(angle),
      });
    }
  }
  for (const circle of circles.slice(big)) {
    positions.push({ x: circle.x, y: circle.y });
  }
  const layout = { units: positions, bigs };
  layouts.set(whole, layout);
  return layout;
}

// Farthest edge of any unit from the cluster's center.
export function calmExtent(units: number): number {
  return calmLayout(units).units.reduce(
    (most, point) => Math.max(most, Math.hypot(point.x, point.y) + 1),
    0,
  );
}

// Seconds-based easing towards a target: after 1/rate seconds about 63% of
// the way there, whatever the frame rate. `rate` <= 0 or an infinite rate
// jumps (used for "reduce motion").
export function approach(
  current: number,
  target: number,
  delta: number,
  rate: number,
): number {
  if (!Number.isFinite(rate) || rate <= 0) return target;
  const step = 1 - Math.exp(-rate * Math.max(0, delta));
  return current + (target - current) * step;
}

export type CalmGrid = {
  columns: number;
  // Size multiplier of every cluster.
  scale: number;
  // How far right of the place a row may reach, in unit radii. On a wide
  // window the Companions and Layers panels stand right of the middle, so
  // longer rows grow to the left instead.
  maxRight: number;
  // Room under each cluster for its name, in unit radii. The name does not
  // shrink with the clusters; under small clusters it wraps to two lines.
  labelRoom: number;
};

// How the clusters of `count` open layers share the space above the place:
// one large cluster, a row of a few, or two to three rows of small ones.
// `aspect` is the canvas width / height (a phone held upright is < 1).
export function calmGrid(count: number, aspect: number): CalmGrid {
  const layers = Math.max(1, Math.floor(count) || 1);
  if (aspect < 1) {
    const maxRight = Number.POSITIVE_INFINITY;
    if (layers === 1) return { columns: 1, scale: 0.8, maxRight, labelRoom: 3 };
    if (layers <= 3)
      return { columns: layers, scale: 0.46, maxRight, labelRoom: 4.4 };
    if (layers <= 6)
      return { columns: 3, scale: 0.42, maxRight, labelRoom: 4.4 };
    return { columns: 4, scale: 0.3, maxRight, labelRoom: 3.4 };
  }
  const maxRight = 10;
  if (layers === 1) return { columns: 1, scale: 1, maxRight, labelRoom: 3 };
  if (layers <= 3)
    return { columns: layers, scale: 0.72, maxRight, labelRoom: 3 };
  if (layers <= 6) return { columns: 3, scale: 0.6, maxRight, labelRoom: 3 };
  if (layers <= 8) return { columns: 4, scale: 0.5, maxRight, labelRoom: 4.4 };
  return { columns: 6, scale: 0.44, maxRight, labelRoom: 4.4 };
}

// Radius of the largest cluster (every unit drawn), in unit radii.
export const CALM_CELL_RADIUS = CALM_PACKING * Math.sqrt(CALM_MAX_UNITS);
// Space between neighbouring clusters.
export const CALM_CELL_GAP = 1.2;
// Gap between the place's marker and the bottom row.
export const CALM_GRID_LIFT = 3.2;

// Center of the cluster of the layer at `index` (0 = lowest height band).
// Rows fill from the bottom, so lower layers sit nearer the ground; a row
// that is not full is centered on the full rows.
export function calmSlot(index: number, count: number, grid: CalmGrid): Point {
  const row = Math.floor(index / grid.columns);
  const column = index % grid.columns;
  const rows = Math.ceil(count / grid.columns);
  const inRow = row === rows - 1 ? count - row * grid.columns : grid.columns;
  const width = 2 * CALM_CELL_RADIUS * grid.scale + CALM_CELL_GAP;
  const height = 2 * CALM_CELL_RADIUS * grid.scale + grid.labelRoom;
  const widest = Math.min(count, grid.columns);
  const shift = Math.min(0, grid.maxRight - (widest * width) / 2);
  return {
    x: shift + (column - (inRow - 1) / 2) * width,
    y:
      CALM_GRID_LIFT +
      row * height +
      grid.labelRoom +
      CALM_CELL_RADIUS * grid.scale,
  };
}

// Size of the whole display for a camera at `distance` from the Earth's
// center: it shrinks as the camera comes closer, but more slowly than the
// view does, so zooming in still enlarges it on screen.
export const CALM_REFERENCE_DISTANCE = 3.2;
export function calmViewScale(distance: number): number {
  const ratio = (distance - 1) / (CALM_REFERENCE_DISTANCE - 1);
  return Math.pow(Math.min(1.6, Math.max(0.05, ratio)), 0.7);
}

// How fast a cluster drifts, from the layer's own speed multiplier
// (formMapping.ts). Kept in a narrow band: Calm is slow at every value.
export function calmDriftSpeed(speed: number): number {
  const clamped = Math.min(3, Math.max(0.04, speed));
  return 0.25 + 0.2 * (Math.log(clamped / 0.04) / Math.log(3 / 0.04));
}
