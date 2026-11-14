// Where one particle of the layer view is at a given time: the same kinds of
// motion as forms/motions.ts, but inside the flat box above a platform
// instead of a shell around the globe. Pure. Directions of flow are
// illustrative; there is no wind data.
import type { MotionKind } from "../forms/motions";
import { secondPhase } from "../forms/motions";

export type SlabSamples = {
  // Per particle: u and v in -1..1 across the platform, and a phase in 0..1.
  u: Float32Array;
  v: Float32Array;
  phases: Float32Array;
};

export function slabSamples(seed: number, count: number): SlabSamples {
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  const phases = new Float32Array(count);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < count; index += 1) {
    u[index] = random() * 2 - 1;
    v[index] = random() * 2 - 1;
    phases[index] = random();
  }
  return { u, v, phases };
}

export type SlabBox = {
  halfWidth: number;
  halfDepth: number;
  // Vertical range; `from` is where a falling or rising particle starts.
  from: number;
  to: number;
};

export type SlabParticle = {
  x: number;
  y: number;
  z: number;
  scale: number;
  spin: number;
  // True: lies flat on the platform (turn about the vertical axis only).
  flat: boolean;
};

export function createSlabParticle(): SlabParticle {
  return { x: 0, y: 0, z: 0, scale: 1, spin: 0, flat: false };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

// Wraps a coordinate into -1..1.
function wrapUnit(value: number): number {
  return fract((value + 1) / 2) * 2 - 1;
}

const TAU = Math.PI * 2;
// How far in from the platform's edge particles stay (share of half-size).
const INSET = 0.92;

export function slabParticleState(
  motion: MotionKind,
  u: number,
  v: number,
  phase: number,
  time: number,
  box: SlabBox,
  // Size of a jitter step, scene units.
  jitter: number,
  out: SlabParticle,
): SlabParticle {
  const other = secondPhase(phase);
  const low = Math.min(box.from, box.to);
  const high = Math.max(box.from, box.to);
  const depth = high - low;
  let x = u;
  let y = low + other * depth;
  const z = v;
  out.scale = 1;
  out.spin = 0;
  out.flat = false;

  switch (motion) {
    case "fall":
    case "rise": {
      // Both travel from `from` to `to`; the box says which way that is.
      const travel = fract(time * 0.2 + phase);
      y = box.from + travel * (box.to - box.from);
      out.scale = 0.35 + 0.65 * Math.sin(Math.PI * travel);
      out.spin = time * 0.8 + phase * TAU;
      break;
    }
    case "orbit":
    case "tumble": {
      x = wrapUnit(u + time * (0.12 + 0.16 * other));
      out.spin = time * (0.5 + other) + phase * TAU;
      if (motion === "tumble") {
        out.scale = 0.35 + 1.9 * other * other;
        y += 0.03 * depth * Math.sin(time * 0.7 + phase * TAU);
      }
      break;
    }
    case "jitter": {
      const a = phase * TAU;
      const b = other * TAU;
      out.x = u * box.halfWidth * INSET + jitter * Math.sin(time * 7.3 + a);
      out.y = clampTo(y + jitter * Math.sin(time * 8.9 + b), low, high);
      out.z = v * box.halfDepth * INSET + jitter * Math.cos(time * 6.1 + a + b);
      return out;
    }
    case "seep": {
      y = low + 0.06 * depth;
      out.scale = 0.7 + 0.3 * Math.sin(time + phase * TAU);
      out.spin = phase * TAU;
      out.flat = true;
      break;
    }
    case "sway": {
      y = low + 0.1 * depth;
      out.spin = phase * TAU + 0.5 * Math.sin(time * 1.6 + other * TAU);
      out.flat = true;
      break;
    }
  }

  out.x = x * box.halfWidth * INSET;
  out.y = clampTo(y, low, high);
  out.z = z * box.halfDepth * INSET;
  return out;
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
