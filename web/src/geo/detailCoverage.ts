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

// One GIBS 500 m tile at level 7. The 12 world cities each use the single
// tile that contains them; they are not stitched into a global image.
export const GIBS_TILE_DEGREES = 2.25;
export const GIBS_LEVEL = 7;
// A click on a world city stops here: closer than the old 2.3 frame, still
// wider than the sharp close-up.
export const CITY_FRAME_DISTANCE = 2.05;
// A double-click stops here: the close-up image is already fully faded in.
export const CLEAR_DISTANCE = 1.3;
export const CITY_FLY_SECONDS = 1.15;

const FAR_DISTANCE = 1.6;
const NEAR_DISTANCE = 1.28;
// Start the download slightly before the fade, so the image is ready.
export const LOAD_DISTANCE = 1.7;

export type LonLatBounds = {
  south: number;
  north: number;
  west: number;
  east: number;
};

export type GibsTile = LonLatBounds & { col: number; row: number };

// The 12 world cities (data/seed/locations.world.json, group world_city).
export const WORLD_CITIES = [
  { id: "tokyo", lat: 35.68, lon: 139.69 },
  { id: "delhi", lat: 28.61, lon: 77.21 },
  { id: "beijing", lat: 39.9, lon: 116.41 },
  { id: "jakarta", lat: -6.21, lon: 106.85 },
  { id: "cairo", lat: 30.04, lon: 31.24 },
  { id: "lagos", lat: 6.52, lon: 3.38 },
  { id: "london", lat: 51.51, lon: -0.13 },
  { id: "moscow", lat: 55.76, lon: 37.62 },
  { id: "new_york", lat: 40.71, lon: -74.01 },
  { id: "los_angeles", lat: 34.05, lon: -118.24 },
  { id: "sao_paulo", lat: -23.55, lon: -46.63 },
  { id: "sydney", lat: -33.87, lon: 151.21 },
] as const;

export function gibsTile(lat: number, lon: number): GibsTile {
  const col = Math.floor((lon + 180) / GIBS_TILE_DEGREES);
  const row = Math.floor((90 - lat) / GIBS_TILE_DEGREES);
  const west = col * GIBS_TILE_DEGREES - 180;
  const north = 90 - row * GIBS_TILE_DEGREES;
  return {
    col,
    row,
    west,
    east: west + GIBS_TILE_DEGREES,
    south: north - GIBS_TILE_DEGREES,
    north,
  };
}

export function gibsTileUrl(col: number, row: number): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/${GIBS_LEVEL}/${row}/${col}.jpg`;
}

// A square around the city, not around the GIBS grid, so the marker sits in
// the middle of the sharp image.
export function centeredWindow(
  lat: number,
  lon: number,
  span = GIBS_TILE_DEGREES,
): LonLatBounds {
  const half = span / 2;
  return {
    west: lon - half,
    east: lon + half,
    south: lat - half,
    north: lat + half,
  };
}

// Every GIBS tile that the window overlaps. A city near a tile corner needs
// the neighbours, or the sharp image stops beside the marker.
export function tilesCovering(frame: LonLatBounds): GibsTile[] {
  const deg = GIBS_TILE_DEGREES;
  const col0 = Math.floor((frame.west + 180) / deg);
  const col1 = Math.floor((frame.east - 1e-6 + 180) / deg);
  const row0 = Math.floor((90 - frame.north) / deg);
  const row1 = Math.floor((90 - frame.south - 1e-6) / deg);
  const tiles: GibsTile[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const west = col * deg - 180;
      const north = 90 - row * deg;
      tiles.push({
        col,
        row,
        west,
        east: west + deg,
        north,
        south: north - deg,
      });
    }
  }
  return tiles;
}

// Where one tile is drawn on a square canvas of the centered window.
// Image y grows downward, so north is y = 0.
export function blitRect(
  tile: LonLatBounds,
  frame: LonLatBounds,
  size: number,
): { x: number; y: number; w: number; h: number } {
  const lonSpan = frame.east - frame.west;
  const latSpan = frame.north - frame.south;
  return {
    x: ((tile.west - frame.west) / lonSpan) * size,
    y: ((frame.north - tile.north) / latSpan) * size,
    w: ((tile.east - tile.west) / lonSpan) * size,
    h: ((tile.north - tile.south) / latSpan) * size,
  };
}

export function contains(
  bounds: LonLatBounds,
  lat: number,
  lon: number,
): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lon >= bounds.west &&
    lon <= bounds.east
  );
}

export type DetailImage = LonLatBounds & {
  id: string;
  file: string;
  // Set for a world city: the sharp image is these tiles drawn into `file`'s
  // window, with the city at the centre.
  tiles?: GibsTile[];
};

export const TAIWAN_IMAGE: DetailImage = {
  id: "taiwan",
  file: "textures/taiwan-detail.png",
  south: TAIWAN_DETAIL.south,
  north: TAIWAN_DETAIL.north,
  west: TAIWAN_DETAIL.west,
  east: TAIWAN_DETAIL.east,
};

export function cityImage(city: {
  id: string;
  lat: number;
  lon: number;
}): DetailImage {
  const frame = centeredWindow(city.lat, city.lon);
  const tiles = tilesCovering(frame);
  const own = gibsTile(city.lat, city.lon);
  return {
    id: city.id,
    file: gibsTileUrl(own.col, own.row),
    ...frame,
    tiles,
  };
}

export const CITY_IMAGES: DetailImage[] = WORLD_CITIES.map(cityImage);

// Taiwan's stitched image wins inside its box. Otherwise the one city tile
// that contains the point, if any.
export function detailImageAt(lat: number, lon: number): DetailImage | null {
  if (detailCovers(lat, lon)) return TAIWAN_IMAGE;
  return CITY_IMAGES.find((image) => contains(image, lat, lon)) ?? null;
}

export function shouldLoadDetail(distance: number, inside: boolean): boolean {
  return inside && Number.isFinite(distance) && distance < LOAD_DISTANCE;
}

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
