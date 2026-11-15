// Where the platforms of the layer view are. Pure functions; scene units of
// the layer view's own scene (not the globe's). Spacing is exaggerated and
// equal for every stratum: heights are not to scale.
import { strata, type StrataAssignment, type StratumId } from "./strataSpec";

export const PLATFORM_WIDTH = 2.6;
export const PLATFORM_DEPTH = 1.3;
// Height of the box of air (or soil) above one platform that particles use.
export const SLAB_HEIGHT = 0.55;
// Distance between two neighboring platforms when fully pulled apart.
export const LAYER_GAP = 1.0;
// The strata never collapse fully onto one plane (avoids z-fighting).
export const MIN_SPREAD = 0.03;

export type StratumBox = {
  id: StratumId;
  // Height of the platform itself.
  y: number;
  // Top of the slab above it.
  top: number;
};

function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// `spread` 0 = all strata pressed together at the ground, 1 = pulled apart.
// The stack is centered on y = 0; the result is ordered like `strata` (top
// first).
export function layoutStrata(spread: number): StratumBox[] {
  const amount = MIN_SPREAD + (1 - MIN_SPREAD) * clampUnit(spread);
  const count = strata.length;
  return strata.map((item, index) => {
    const fromBottom = count - 1 - index;
    const y = (fromBottom - (count - 1) / 2) * LAYER_GAP * amount;
    return { id: item.id, y, top: y + SLAB_HEIGHT * amount };
  });
}

export function stackExtent(boxes: StratumBox[]): {
  bottom: number;
  top: number;
} {
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    bottom = Math.min(bottom, box.y);
    top = Math.max(top, box.top);
  }
  if (boxes.length === 0) return { bottom: 0, top: 0 };
  return { bottom, top };
}

// Tops (pixels) of the labels of the left column. Each label wants to sit
// centered on the screen height of its stratum (`centers`, top to bottom);
// they are then kept below `floor` (the legend), above `ceiling` (the
// credit or the timeline bar) and `gap` pixels apart. When there is not
// enough room the column starts at `floor` and runs past `ceiling`.
export function stackLabelTops(
  centers: number[],
  heights: number[],
  floor: number,
  ceiling: number,
  gap = 4,
): number[] {
  const tops: number[] = [];
  let next = floor;
  centers.forEach((center, index) => {
    const height = heights[index] ?? 0;
    const top = Math.max(next, center - height / 2);
    tops.push(top);
    next = top + height + gap;
  });
  let limit = ceiling;
  for (let index = tops.length - 1; index >= 0; index -= 1) {
    const height = heights[index] ?? 0;
    const top = Math.min(tops[index] ?? 0, limit - height);
    tops[index] = top;
    limit = top - gap;
  }
  const lift = floor - (tops[0] ?? floor);
  return lift > 0 ? tops.map((top) => top + lift) : tops;
}

export type ParticleRange = {
  // Where a particle starts and ends vertically. For a variable that stays
  // in its stratum, `from` is the platform and `to` the top of its slab.
  from: number;
  to: number;
  // True when the range reaches into another stratum.
  crosses: boolean;
};

// The vertical range the particles of one variable may occupy. A variable
// without `flowsTo` stays inside its own slab. Rain starts at the top of its
// slab and ends on the target platform; a rising flow starts on its own
// platform and ends at the top of the target slab.
export function particleRange(
  assignment: StrataAssignment,
  boxes: StratumBox[],
): ParticleRange | null {
  const home = boxes.find((box) => box.id === assignment.stratum);
  if (!home) return null;
  const target = assignment.flowsTo
    ? boxes.find((box) => box.id === assignment.flowsTo)
    : undefined;
  if (!target) return { from: home.y, to: home.top, crosses: false };
  if (target.y < home.y) return { from: home.top, to: target.y, crosses: true };
  return { from: home.y, to: target.top, crosses: true };
}

// Where the companions of a stratum stand: "beside" in one row outside the
// platform's right edge (wide screens), or "on" the platform, spread along
// its front edge (where there is no room beside the stack).
export type CompanionPlacement = "beside" | "on";

// Beside the stack: from the platform's right edge to the first companion,
// and from one companion to the next (scene units). The row is then kept
// apart and on screen in pixels by companionRowXs.
export const COMPANION_EDGE_GAP = 0.25;
export const COMPANION_SPACING = 0.55;

// Screen centers (pixels) of one row of companions beside the stack.
// `wanted` are the projected centers of their spots, left to right; each
// companion is `width` wide. The row keeps `gap` pixels between
// companions, starts right of `left` (the platform's right edge) and ends
// left of `right` (the Layers panel). Without room for all of them, they
// are spread evenly between the two bounds.
export function companionRowXs(
  wanted: number[],
  width: number,
  gap: number,
  left: number,
  right: number,
): number[] {
  if (wanted.length === 0) return [];
  const first = left + width / 2;
  const last = right - width / 2;
  const step = width + gap;
  const xs: number[] = [];
  wanted.forEach((x, index) => {
    const previous = xs[index - 1];
    xs.push(Math.max(x, previous === undefined ? first : previous + step));
  });
  const overflow = (xs[xs.length - 1] ?? last) - last;
  if (overflow > 0) {
    for (let index = 0; index < xs.length; index += 1) {
      xs[index] = (xs[index] ?? 0) - overflow;
    }
  }
  if ((xs[0] ?? first) >= first) return xs;
  if (xs.length === 1) return [first];
  const even = (last - first) / (xs.length - 1);
  return xs.map((_, index) => first + index * Math.max(0, even));
}

// [x, z] of the companion of the `index`-th of `count` shown variables of a
// stratum, at the height of its platform.
export function companionSpot(
  index: number,
  count: number,
  placement: CompanionPlacement = "on",
): [number, number] {
  if (placement === "beside") {
    return [
      PLATFORM_WIDTH / 2 + COMPANION_EDGE_GAP + index * COMPANION_SPACING,
      0,
    ];
  }
  const slots = Math.max(1, count);
  const x = ((index + 0.5) / slots - 0.5) * PLATFORM_WIDTH * 0.8;
  return [x, PLATFORM_DEPTH * 0.36];
}
