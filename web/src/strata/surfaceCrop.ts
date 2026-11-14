// Which part of a surface image the ground platform shows. Pure.
import { detailCovers, TAIWAN_DETAIL } from "../geo/detailCoverage";

export type Bounds = {
  south: number;
  north: number;
  west: number;
  east: number;
};

export type TextureCrop = {
  // three.js texture.offset and texture.repeat.
  offset: [number, number];
  repeat: [number, number];
};

const WORLD: Bounds = { south: -90, north: 90, west: -180, east: 180 };

// A window of `lonSpan` × `latSpan` degrees centered on the place, moved
// inward where it would leave the image.
export function cropAround(
  lat: number,
  lon: number,
  lonSpan: number,
  latSpan: number,
  bounds: Bounds,
): TextureCrop {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  const repeatU = Math.min(1, lonSpan / width);
  const repeatV = Math.min(1, latSpan / height);
  const centerU = (lon - bounds.west) / width;
  const centerV = (lat - bounds.south) / height;
  const offsetU = Math.min(1 - repeatU, Math.max(0, centerU - repeatU / 2));
  const offsetV = Math.min(1 - repeatV, Math.max(0, centerV - repeatV / 2));
  return { offset: [offsetU, offsetV], repeat: [repeatU, repeatV] };
}

export type SurfaceImage = TextureCrop & {
  // Path under the site's base URL.
  file: string;
  lonSpan: number;
  latSpan: number;
};

// The closer Taiwan image where it covers the place, Blue Marble elsewhere
// (a wider window, because that image is much coarser).
export function surfaceImage(lat: number, lon: number): SurfaceImage {
  if (detailCovers(lat, lon)) {
    const lonSpan = 3;
    const latSpan = 1.5;
    return {
      file: "textures/taiwan-detail.png",
      lonSpan,
      latSpan,
      ...cropAround(lat, lon, lonSpan, latSpan, TAIWAN_DETAIL),
    };
  }
  const lonSpan = 24;
  const latSpan = 12;
  return {
    file: "textures/blue-marble.jpg",
    lonSpan,
    latSpan,
    ...cropAround(lat, lon, lonSpan, latSpan, WORLD),
  };
}
