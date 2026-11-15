// Drag rotation of the globe. OrbitControls turns by a fixed angle per
// pixel, so the surface crosses the screen faster once the camera is close.
// Below the default viewing distance the angle scales with
// (distance / default)^2: 1 at that distance, much smaller when closer.
// Squaring keeps continuity at the default view while slowing near-field
// drag more than a linear scale. At the default distance and farther it
// stays at the control's own speed. Wheel zoom, flights, and the layer
// view do not use this.

// Camera distance at which the globe is first shown (EarthCanvas).
export const DEFAULT_ORBIT_DISTANCE = 3.2;
// OrbitControls' own rotateSpeed, kept for the default view and beyond.
export const BASE_ROTATE_SPEED = 1;

export function orbitRotateSpeed(
  distance: number,
  referenceDistance = DEFAULT_ORBIT_DISTANCE,
): number {
  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    !Number.isFinite(referenceDistance) ||
    referenceDistance <= 0
  ) {
    return BASE_ROTATE_SPEED;
  }
  if (distance >= referenceDistance) return BASE_ROTATE_SPEED;
  const ratio = distance / referenceDistance;
  return BASE_ROTATE_SPEED * ratio * ratio;
}
