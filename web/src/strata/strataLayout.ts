// Where the platforms of the layer view are. Pure functions; scene units of
// the layer view's own scene (not the globe's). Spacing is exaggerated and
// equal for every stratum: heights are not to scale.
import { strata, type StrataAssignment, type StratumId } from "./strataSpec";

export const PLATFORM_WIDTH = 2.6;
export const PLATFORM_DEPTH = 1.3;
// Height of the box of air (or soil) above one platform that particles use.
export const SLAB_HEIGHT = 0.55;
// Distance between two neighboring platforms when fully pulled apart.
export const LAYER_GAP = 1.25;
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

// Where the companion of the `index`-th of `count` variables of a stratum
// stands on its platform: spread along the front edge. [x, z] on the plate.
export function companionSpot(index: number, count: number): [number, number] {
  const slots = Math.max(1, count);
  const x = ((index + 0.5) / slots - 0.5) * PLATFORM_WIDTH * 0.8;
  return [x, PLATFORM_DEPTH * 0.36];
}
