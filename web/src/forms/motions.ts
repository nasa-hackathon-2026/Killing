// Where one particle is at a given time. Pure, so it can be tested without a
// renderer. Directions of flow are illustrative; there is no wind data.

export type MotionKind =
  "fall" | "rise" | "orbit" | "jitter" | "seep" | "sway" | "tumble";

export type ParticleState = {
  x: number;
  y: number;
  z: number;
  // Multiplies the size from the encoding.
  scale: number;
  // Rotation about the particle's own axis, radians.
  spin: number;
  // True: the particle's +y axis points away from the Earth's center.
  // False: it tumbles freely (use `spin` on all three axes).
  radial: boolean;
};

export function createParticleState(): ParticleState {
  return { x: 0, y: 0, z: 0, scale: 1, spin: 0, radial: false };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

// A second pseudo-random number in 0..1 derived from the first.
export function secondPhase(phase: number): number {
  return fract(phase * 97.13 + 0.37);
}

const TAU = Math.PI * 2;

export function particleState(
  motion: MotionKind,
  dx: number,
  dy: number,
  dz: number,
  phase: number,
  time: number,
  band: [number, number],
  out: ParticleState,
): ParticleState {
  const other = secondPhase(phase);
  const [inner, outer] = band;
  const depth = outer - inner;
  let radius = inner + other * depth;
  let x = dx;
  const y = dy;
  let z = dz;
  out.scale = 1;
  out.spin = 0;
  out.radial = false;

  switch (motion) {
    case "fall":
    case "rise": {
      const travel = fract(time * 0.2 + phase);
      const along = motion === "rise" ? travel : 1 - travel;
      radius = inner + along * depth;
      // Appears, grows, and thins out again at the end of its path.
      out.scale = 0.35 + 0.65 * Math.sin(Math.PI * travel);
      out.spin = time * 0.8 + phase * TAU;
      break;
    }
    case "orbit":
    case "tumble": {
      const turn = time * (0.6 + 0.8 * other) + phase * TAU;
      x = dx * Math.cos(turn) - dz * Math.sin(turn);
      z = dx * Math.sin(turn) + dz * Math.cos(turn);
      out.spin = time * (0.5 + other) + phase * TAU;
      if (motion === "tumble") {
        // A broad spread of sizes: most grains small, a few large.
        out.scale = 0.35 + 1.9 * other * other;
        radius += 0.01 * Math.sin(time * 0.7 + phase * TAU);
      }
      break;
    }
    case "jitter": {
      const amplitude = 0.012;
      const a = phase * TAU;
      const b = other * TAU;
      out.x = x * radius + amplitude * Math.sin(time * 7.3 + a);
      out.y = y * radius + amplitude * Math.sin(time * 8.9 + b);
      out.z = z * radius + amplitude * Math.cos(time * 6.1 + a + b);
      return out;
    }
    case "seep": {
      radius = inner + 0.5 * depth;
      out.scale = 0.7 + 0.3 * Math.sin(time + phase * TAU);
      out.spin = phase * TAU;
      out.radial = true;
      break;
    }
    case "sway": {
      out.spin = phase * TAU + 0.5 * Math.sin(time * 1.6 + other * TAU);
      out.radial = true;
      break;
    }
  }

  out.x = x * radius;
  out.y = y * radius;
  out.z = z * radius;
  return out;
}
