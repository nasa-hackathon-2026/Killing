// Nine NASA GIBS 500 m tiles (level 7), stitched into one image.
// Tile columns 132–134 and rows 28–30. Each tile is 2.25 degrees.
export const TAIWAN_DETAIL = {
  south: 20.25,
  north: 27,
  west: 117,
  east: 123.75,
  tileCount: 9,
  tileLimit: 12,
} as const;

// Camera distance (globe radius 1) below which the close-up images start
// loading: the Taiwan detail (scene/TaiwanDetail.tsx) and the 8K Blue Marble
// (scene/earthTexture.ts). A little farther than where the detail fades in.
export const DETAIL_LOAD_DISTANCE = 1.7;

const FAR_DISTANCE = 1.6;
const NEAR_DISTANCE = 1.28;

export function detailOpacity(distance: number): number {
  if (!Number.isFinite(distance) || distance >= FAR_DISTANCE) return 0;
  if (distance <= NEAR_DISTANCE) return 1;
  const t = (FAR_DISTANCE - distance) / (FAR_DISTANCE - NEAR_DISTANCE);
  return t * t * (3 - 2 * t);
}

export function detailCovers(lat: number, lon: number): boolean {
  return (
    lat >= TAIWAN_DETAIL.south &&
    lat <= TAIWAN_DETAIL.north &&
    lon >= TAIWAN_DETAIL.west &&
    lon <= TAIWAN_DETAIL.east
  );
}
