// Screen size of a place marker. A scale that grew in step with
// (distance − 1) would stay the same size on screen. The power above 1
// makes the marker smaller as the camera comes closer.
export const MARKER_REFERENCE_DISTANCE = 3.2;
const SPAN = MARKER_REFERENCE_DISTANCE - 1;

export function markerScale(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const height = Math.max(0, distance - 1);
  return Math.min(1.6, (height / SPAN) ** 1.7);
}
