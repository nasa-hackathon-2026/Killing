import { MAX_FORM_PARTICLES } from "./particleField";

export type ShellSamples = {
  directions: Float32Array;
  phases: Float32Array;
};

export function shellSamples(seed: number): ShellSamples {
  const directions = new Float32Array(MAX_FORM_PARTICLES * 3);
  const phases = new Float32Array(MAX_FORM_PARTICLES);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < MAX_FORM_PARTICLES; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const sinPhi = Math.sin(phi);
    directions[index * 3] = sinPhi * Math.cos(theta);
    directions[index * 3 + 1] = Math.cos(phi);
    directions[index * 3 + 2] = sinPhi * Math.sin(theta);
    phases[index] = random();
  }
  return { directions, phases };
}

export function seedFromId(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
