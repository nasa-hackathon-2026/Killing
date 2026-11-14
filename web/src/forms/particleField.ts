export const MAX_FORM_PARTICLES = 480;

export function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function particleCount(value: number): number {
  return Math.round(clampUnit(value) * MAX_FORM_PARTICLES);
}

export function motionSpeed(value: number): number {
  return 0.04 + clampUnit(value) * 0.96;
}
