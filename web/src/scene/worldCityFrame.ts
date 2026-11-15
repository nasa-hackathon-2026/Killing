// Where the globe camera goes when the selected place is one of the 12
// world cities. The city stays on the viewing axis (the center of the
// globe): latitude and longitude are the city's own, with no panel offset.
// `distance` is the caller's slight zoom, closer than the whole-Earth view.
// Taiwan places and the global mean return null and keep their own flights.

export type WorldCityFrame = {
  lat: number;
  lon: number;
  distance: number;
};

export function worldCityFrame(
  place:
    | { group: string; lat: number | null; lon: number | null }
    | null
    | undefined,
  distance: number,
): WorldCityFrame | null {
  if (!place || place.group !== "world_city") return null;
  if (
    place.lat === null ||
    place.lon === null ||
    !Number.isFinite(place.lat) ||
    !Number.isFinite(place.lon) ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return null;
  }
  return { lat: place.lat, lon: place.lon, distance };
}
