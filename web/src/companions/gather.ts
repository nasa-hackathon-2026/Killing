// The "Gather" layout: every companion placed in a composition inspired by
// Raphael's fresco The School of Athens (1509-1511, public domain). Only the
// idea of the composition is borrowed: two figures in the middle, one
// pointing up and one holding a palm towards the ground, the others in
// groups on the steps on both sides. No part of the painting is reproduced.
import { byAltitude, type CompanionSpec } from "./companionSpec";

export const GATHER_CREDIT =
  "Composition inspired by Raphael, The School of Athens (1509–1511), public domain.";

export type GatherPlace = {
  id: string;
  // Centre of the companion's feet, as fractions of the stage (0..1).
  x: number;
  y: number;
  // Multiplier on the base size; figures in front are drawn larger.
  scale: number;
  gesture: "up" | "down" | null;
  gestureSide: "left" | "right";
};

// Feet height of the middle pair and of the two steps (fractions of the
// stage), and how far from the middle the figures on each step stand.
export const CENTRE_Y = 0.52;
export const UPPER_Y = 0.63;
export const LOWER_Y = 0.9;
const UPPER_STEP = [0.19, 0.31, 0.43];
const LOWER_STEP = [0.25, 0.39];

function isUpper(spec: CompanionSpec): boolean {
  return spec.layer === "sky" || spec.layer === "air";
}

// The middle pair: the highest companion of the sky or air points up, the
// lowest of the surface or ground holds its palm down. `preferred` (the
// layers that are switched on) are chosen first when they qualify.
export function gatherCentre(
  specs: CompanionSpec[],
  preferred: string[] = [],
): { up: CompanionSpec | null; down: CompanionSpec | null } {
  const ordered = byAltitude(specs.map((spec) => spec.id));
  const pick = (pool: CompanionSpec[]): CompanionSpec | null =>
    pool.find((spec) => preferred.includes(spec.id)) ?? pool[0] ?? null;
  return {
    up: pick(ordered.filter(isUpper)),
    down: pick(ordered.filter((spec) => !isUpper(spec)).reverse()),
  };
}

export function gatherLayout(
  specs: CompanionSpec[],
  preferred: string[] = [],
): GatherPlace[] {
  const { up, down } = gatherCentre(specs, preferred);
  const places: GatherPlace[] = [];
  if (up) {
    places.push({
      id: up.id,
      x: down ? 0.435 : 0.5,
      y: CENTRE_Y,
      scale: 1.15,
      gesture: "up",
      gestureSide: "right",
    });
  }
  if (down) {
    places.push({
      id: down.id,
      x: up ? 0.565 : 0.5,
      y: CENTRE_Y,
      scale: 1.15,
      gesture: "down",
      gestureSide: "right",
    });
  }
  // The rest stand on the steps: higher forms on the upper steps near the
  // middle, lower forms further down and further out, alternating sides.
  const others = byAltitude(specs.map((spec) => spec.id)).filter(
    (spec) => spec.id !== up?.id && spec.id !== down?.id,
  );
  others.forEach((spec, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const slot = Math.floor(index / 2);
    const upperStep = slot < UPPER_STEP.length;
    const offset = upperStep
      ? UPPER_STEP[slot]
      : LOWER_STEP[(slot - UPPER_STEP.length) % LOWER_STEP.length];
    places.push({
      id: spec.id,
      x: 0.5 + side * (offset ?? 0.3),
      y: upperStep ? UPPER_Y : LOWER_Y,
      scale: upperStep ? 0.85 : 1,
      gesture: null,
      gestureSide: side < 0 ? "left" : "right",
    });
  });
  return places;
}
