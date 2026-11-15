// Where the camera starts so the selected place is not behind a panel.
// Above 1180 px and on phones the middle of the window is free and the
// camera sits straight over the place. Between 701 and 1180 px the
// Companions and Layers panels take the right 514 px and reach the middle,
// so the camera starts a little east of the place: the place then shows
// left of the middle, in the free part of the globe. Pure, tested.
const DEG = Math.PI / 180;
// Vertical field of view of the scene camera (EarthCanvas).
export const CAMERA_FOV = 45;
// The free strip lies between the start card (ends near 400 px) and the
// Companions panel (starts 514 px from the right edge). Its middle is 57 px
// left of the window's middle at every width; 30 px more leave room for the
// place's name label right of the marker.
export const MEDIUM_SHIFT_PX = 87;

// Degrees to add to the camera's longitude at the start.
export function startLongitudeShift(
  width: number,
  height: number,
  distance: number,
  latDeg: number,
): number {
  if (width <= 700 || width > 1180 || height <= 0) return 0;
  const shift = MEDIUM_SHIFT_PX;
  // A point at angle t from the point under the camera is drawn
  // f * sin(t) / (distance - cos(t)) pixels from the middle.
  const focal = height / 2 / Math.tan((CAMERA_FOV / 2) * DEG);
  const k = shift / focal;
  const reach = (k * distance) / Math.sqrt(1 + k * k);
  if (reach >= 1) return 0;
  const angle = Math.asin(reach) - Math.atan(k);
  return angle / DEG / Math.max(0.2, Math.cos(latDeg * DEG));
}
