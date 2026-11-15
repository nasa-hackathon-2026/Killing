// The places the main view can show. Taiwan's five points come from the core
// snapshot (data/snapshot); the world cities and the global mean come from
// the published world subset (data/snapshot/world, written by
// `uv run python -m trend_detective.world_export`). Names and coordinates
// are read from the catalogs; nothing here says which country a place is in.

export type PlaceGroup = "taiwan" | "world_city" | "global";

// Order and headings of the place menu.
export const PLACE_GROUPS: { id: PlaceGroup; label: string }[] = [
  { id: "taiwan", label: "Taiwan" },
  { id: "world_city", label: "World cities" },
  { id: "global", label: "Global" },
];

export const DEFAULT_PLACE_ID = "taichung";

export type Place = {
  id: string;
  nameEn: string;
  // null for a place that is not a point (the global mean).
  lat: number | null;
  lon: number | null;
  group: PlaceGroup;
  // Aggregation of this place's series, as in the series keys of
  // trends.json: "point", or "area_mean_grid" for the global mean.
  aggregation: string;
};

export type PointPlace = Place & { lat: number; lon: number };

export function hasCoordinates(
  place: Place | undefined | null,
): place is PointPlace {
  return !!place && place.lat !== null && place.lon !== null;
}

export function isPlaceGroup(value: unknown): value is PlaceGroup {
  return PLACE_GROUPS.some((group) => group.id === value);
}

// The menu: one entry per group that has places, in PLACE_GROUPS order; the
// places keep the order of their catalog.
export function groupedPlaces(
  places: Place[],
): { id: PlaceGroup; label: string; places: Place[] }[] {
  return PLACE_GROUPS.map((group) => ({
    ...group,
    places: places.filter((place) => place.group === group.id),
  })).filter((group) => group.places.length > 0);
}

// The place to show for `?at=<id>`: the asked one when the catalogs list
// it, otherwise the default. Before the catalogs are read (`places` empty)
// the asked id is kept so it can be resolved once they are.
export function resolvePlaceId(asked: string | null, places: Place[]): string {
  if (!asked) return DEFAULT_PLACE_ID;
  if (places.length === 0) return asked;
  return places.some((place) => place.id === asked) ? asked : DEFAULT_PLACE_ID;
}

// A sentence under the place menu for places whose numbers are not a point
// value. States the method only.
export function placeNote(place: Place | undefined): string | null {
  if (place?.aggregation === "area_mean_grid") {
    return "Mean of the whole global grid, weighted by cos(latitude), land and ocean together where the product covers both. Not a point value.";
  }
  return null;
}

export const NO_DATA_AT_PLACE = "No data at this place";
