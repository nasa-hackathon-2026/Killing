export const EARTH_RADIUS = 1;

export type Vector3Tuple = {
  x: number;
  y: number;
  z: number;
};

const DEG = Math.PI / 180;

// Matches three.js SphereGeometry: north is +Y, longitude 0 is +X,
// and east of Greenwich moves toward -Z. Equirectangular images with
// north at the top and longitude 0 in the center then line up.
export function latLonToVector3(
  latDeg: number,
  lonDeg: number,
  radius = EARTH_RADIUS,
): Vector3Tuple {
  const lat = latDeg * DEG;
  const phi = (lonDeg + 180) * DEG;
  const cosLat = Math.cos(lat);
  return {
    x: -radius * cosLat * Math.cos(phi),
    y: radius * Math.sin(lat),
    z: radius * cosLat * Math.sin(phi),
  };
}

// Inverse of latLonToVector3. Longitude is in (−180, 180].
export function vectorToLatLon(
  x: number,
  y: number,
  z: number,
): { lat: number; lon: number } {
  const radius = Math.hypot(x, y, z);
  const lat = Math.asin(y / radius) / DEG;
  let lon = Math.atan2(z, -x) / DEG - 180;
  if (lon <= -180) lon += 360;
  return { lat, lon };
}
