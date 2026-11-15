// Size of a place's dot for a camera at `distance` from the Earth's centre,
// as a multiple of its size at the starting distance. A thing of world size s
// looks s / (distance - 1) across, so an exponent of 1 would keep the dot the
// same size on screen; above 1 it gets smaller on screen as the camera comes
// closer (#197) instead of growing into a blob. Kept gentle (1.25) and
// floored, so the dot never becomes too small to click.
export const MARKER_REFERENCE_DISTANCE = 3.2;
export const MARKER_EXPONENT = 1.25;
export const MARKER_MIN_RATIO = 0.05;

export function markerScale(distance: number): number {
  const ratio = (distance - 1) / (MARKER_REFERENCE_DISTANCE - 1);
  return Math.pow(
    Math.min(1.6, Math.max(MARKER_MIN_RATIO, ratio)),
    MARKER_EXPONENT,
  );
}
