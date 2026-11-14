// Geometry and color helpers for the companions. Pure functions: the body
// is a smooth closed curve through a ring of control points, and each kind
// of form bends that ring in its own way.
import { PALETTES } from "../trendmap/trendMapConfig";
import type { CompanionMood } from "./companionData";
import type { CompanionKind, CompanionSpec } from "./companionSpec";

export type Point = [number, number];

// Drawing box of one companion (SVG user units).
export const VIEW_WIDTH = 120;
export const VIEW_HEIGHT = 150;
export const CENTER_X = 60;
// Where a standing companion touches the ground.
export const GROUND_Y = 112;
// Companions of the air hover this far above the ground line.
export const HOVER_GAP = 9;

export const OUTLINE_POINTS = 24;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// A closed Catmull-Rom spline through `points`, written as cubic Béziers.
// Two outlines with the same number of points can be morphed into each
// other, which is how a companion breathes.
export function closedSmoothPath(points: Point[]): string {
  const count = points.length;
  if (count < 3) return "";
  const at = (index: number): Point =>
    points[((index % count) + count) % count] as Point;
  let path = `M${round(at(0)[0])} ${round(at(0)[1])}`;
  for (let index = 0; index < count; index += 1) {
    const [p0, p1, p2, p3] = [
      at(index - 1),
      at(index),
      at(index + 1),
      at(index + 2),
    ];
    const c1: Point = [
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
    ];
    const c2: Point = [
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
    ];
    path += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${path}Z`;
}

export function floats(spec: Pick<CompanionSpec, "kind" | "variant">): boolean {
  if (spec.kind === "gas" || spec.kind === "water" || spec.kind === "aerosol") {
    return true;
  }
  return spec.kind === "vapor" && spec.variant !== "rising";
}

export type BodyBox = {
  points: Point[];
  top: number;
  bottom: number;
  // Vertical middle of the dome, where the eyes and arms attach.
  middle: number;
  halfWidth: number;
};

// How much each posture stretches the body: [width, height].
export const MOOD_STRETCH: Record<CompanionMood, [number, number]> = {
  above: [1.05, 1.14],
  near: [1, 1],
  below: [1.12, 0.8],
};

const KIND_BASE: Record<
  CompanionKind,
  { rx: number; top: number; base: number }
> = {
  water: { rx: 33, top: 36, base: 13 },
  vapor: { rx: 34, top: 34, base: 20 },
  gas: { rx: 33, top: 33, base: 33 },
  energy: { rx: 33, top: 40, base: 14 },
  plant: { rx: 33, top: 34, base: 14 },
  soil: { rx: 38, top: 31, base: 13 },
  aerosol: { rx: 34, top: 33, base: 22 },
};

// How far the ring is pushed out or in at angle `theta` (0 = right, a
// quarter turn = top). `phase` (0 or 1) shifts the bumps a little so the two
// breathing outlines differ.
function bump(kind: CompanionKind, theta: number, phase: number): number {
  const lower = Math.sin(theta) < 0;
  switch (kind) {
    case "water":
      // Three hanging lobes along the lower edge, as water about to drip.
      return lower
        ? 1 +
            (0.42 + 0.1 * phase) *
              (0.5 + 0.5 * Math.cos(6 * (theta - 1.5 * Math.PI))) *
              Math.abs(Math.sin(theta))
        : 1;
    case "vapor":
      return 1 + 0.09 * Math.cos(5 * theta - 0.4 + 0.5 * phase);
    case "aerosol":
      return (
        1 +
        0.07 * Math.sin(3 * theta + 1 + 0.4 * phase) +
        0.05 * Math.sin(7 * theta + 2)
      );
    case "soil":
      return 1 + 0.025 * Math.sin(9 * theta + phase);
    default:
      return 1;
  }
}

export function bodyOutline(
  spec: Pick<CompanionSpec, "kind" | "variant">,
  mood: CompanionMood,
  phase: 0 | 1 = 0,
): BodyBox {
  const base = KIND_BASE[spec.kind];
  const [wide, tall] = MOOD_STRETCH[mood];
  // Breathing out: a little wider and lower.
  const rx = base.rx * wide * (phase === 1 ? 1.035 : 1);
  const top = base.top * tall * (phase === 1 ? 0.955 : 1);
  const bottomRadius = base.base * (spec.kind === "gas" ? tall : 1);
  const raw: Point[] = [];
  for (let index = 0; index < OUTLINE_POINTS; index += 1) {
    const theta = (index / OUTLINE_POINTS) * Math.PI * 2;
    const push = bump(spec.kind, theta, phase);
    const sine = Math.sin(theta);
    raw.push([
      CENTER_X + rx * Math.cos(theta) * (sine < 0 ? 1 : push),
      -(sine >= 0 ? top * push : bottomRadius * push) * sine,
    ]);
  }
  const lowest = Math.max(...raw.map((point) => point[1]));
  const highest = Math.min(...raw.map((point) => point[1]));
  const bottom = GROUND_Y - (floats(spec) ? HOVER_GAP : 0);
  const shift = bottom - lowest;
  return {
    points: raw.map((point) => [point[0], point[1] + shift]),
    top: highest + shift,
    bottom,
    middle: shift,
    halfWidth: rx,
  };
}

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [128, 128, 128];
  const number = Number.parseInt(match[1] as string, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// `amount` 0 gives `from`, 1 gives `to`.
export function mixHex(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const t = Math.min(1, Math.max(0, amount));
  return toHex([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

// Standardized anomaly at which the temperature tint reaches its end color.
export const TINT_FULL_Z = 2;

// Body color of a temperature companion: the blue-white-red scale the trend
// map already uses (ColorBrewer RdBu), read by the month's standardized
// anomaly. Blue is colder than that calendar month's mean, red is warmer.
// Without an anomaly the companion keeps the layer's own color.
export function anomalyTint(z: number | null | undefined, fallback: string) {
  if (z === null || z === undefined || Number.isNaN(z)) return fallback;
  const stops = PALETTES["blue-red"];
  const position =
    ((Math.min(TINT_FULL_Z, Math.max(-TINT_FULL_Z, z)) + TINT_FULL_Z) /
      (2 * TINT_FULL_Z)) *
    (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const from = stops[index] as Rgb;
  const to = stops[index + 1] as Rgb;
  const t = position - index;
  return toHex([
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ]);
}

// Repeatable pseudo-random numbers in 0..1 for grains and specks, so a
// companion looks the same on every render.
export function scatter(seed: number, count: number): number[] {
  const values: number[] = [];
  let state = (seed * 2654435761) >>> 0 || 1;
  for (let index = 0; index < count; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    values.push(state / 4294967296);
  }
  return values;
}

// How many of a counted detail (leaves, drops, grains) to draw.
export function detailCount(amount: number, range: [number, number]): number {
  const t = Math.min(1, Math.max(0, Number.isNaN(amount) ? 0 : amount));
  return Math.round(range[0] + (range[1] - range[0]) * t);
}
