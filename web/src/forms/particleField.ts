export const MAX_FORM_PARTICLES = 480;

// Particles drawn on the whole globe, shared by every open layer. With up to
// three layers open each one keeps its own maximum; from four layers on, the
// budget is split evenly so the Earth stays visible.
export const TOTAL_PARTICLE_BUDGET = 1440;

// A month that has data never draws fewer than this share of the layer's
// cap, so the series' own minimum does not look like "No data" (0 particles).
export const MIN_COUNT_FRACTION = 0.08;

export function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// The most particles one layer may draw when `openLayers` layers are open.
// `maxCount` is the layer's own maximum (its row of formMapping.ts).
export function layerParticleCap(maxCount: number, openLayers: number): number {
  const layers = Math.max(1, Math.floor(openLayers) || 1);
  const share = Math.floor(TOTAL_PARTICLE_BUDGET / layers);
  return Math.max(0, Math.min(MAX_FORM_PARTICLES, Math.floor(maxCount), share));
}

// `value` is the normalized reading (0 = the series' own minimum). A month
// without data (or a value that is not a number) draws nothing; a month with data draws at least the floor.
export function particleCount(
  value: number,
  cap: number = MAX_FORM_PARTICLES,
  hasData = true,
): number {
  if (!hasData || cap <= 0 || Number.isNaN(value)) return 0;
  const floor = Math.ceil(cap * MIN_COUNT_FRACTION);
  return Math.max(floor, Math.round(clampUnit(value) * cap));
}

// Opacity of one glass shell when `openLayers` shells are stacked: chosen so
// that all of them together cover the Earth about as much as one shell alone.
export function sharedShellOpacity(single: number, openLayers: number): number {
  const layers = Math.max(1, Math.floor(openLayers) || 1);
  return 1 - Math.pow(1 - clampUnit(single), 1 / layers);
}

export function motionSpeed(value: number): number {
  return 0.04 + clampUnit(value) * 0.96;
}
