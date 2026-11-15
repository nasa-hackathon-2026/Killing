// The places the main view can show. Taiwan's five points come from the core
// snapshot (data/snapshot); the world cities and the global mean come from
// the published world subset (data/snapshot/world, written by
// `uv run python -m trend_detective.world_export`). Names and coordinates
// are read from the catalogs; nothing here says which country a place is in.

import { t, tm, type Voice } from "../i18n";
import { placeName } from "../i18n/names";
import { bboxCenter, formatBbox, type Bbox } from "../geo/regionFrame";

export type PlaceGroup = "taiwan" | "taiwan_region" | "world_city" | "global";

// Order and headings of the place menu.
export const PLACE_GROUPS: { id: PlaceGroup; label: string }[] = [
  { id: "taiwan", label: "Taiwan" },
  { id: "taiwan_region", label: "Taiwan regions (area means)" },
  { id: "world_city", label: "World cities" },
  { id: "global", label: "Global" },
];

export const DEFAULT_PLACE_ID = "taichung";

export type Place = {
  id: string;
  nameEn: string;
  // null for a place that is not a point (the global mean, a region).
  lat: number | null;
  lon: number | null;
  group: PlaceGroup;
  // Aggregation of this place's series, as in the series keys of
  // trends.json: "point", "area_mean" for a Taiwan region, or
  // "area_mean_grid" for the global mean.
  aggregation: string;
  // The data area of a region (catalog bbox); only regions have one.
  bbox?: Bbox;
};

export type PointPlace = Place & { lat: number; lon: number };

export function hasCoordinates(
  place: Place | undefined | null,
): place is PointPlace {
  return !!place && place.lat !== null && place.lon !== null;
}

export function isRegion(
  place: Place | undefined | null,
): place is Place & { bbox: Bbox } {
  return !!place && place.group === "taiwan_region" && !!place.bbox;
}

// Where the camera looks for a place: the point itself, or the middle of a
// region's data area. null for the global mean.
export function placeAnchor(
  place: Place | undefined | null,
): { lat: number; lon: number } | null {
  if (hasCoordinates(place)) return { lat: place.lat, lon: place.lon };
  if (isRegion(place)) return bboxCenter(place.bbox);
  return null;
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
export function placeNote(
  place: Place | undefined,
  voice?: Voice,
): string | null {
  if (place?.aggregation === "area_mean_grid") {
    return tm("places.note.globalMean", undefined, voice);
  }
  if (isRegion(place)) {
    return tm("places.note.region", { bbox: formatBbox(place.bbox) }, voice);
  }
  return null;
}

// The place's name in the active language (the catalog's English name when
// the `places` namespace does not list it).
export function displayPlaceName(place: {
  id: string;
  nameEn: string;
}): string {
  return placeName(place.id, place.nameEn);
}

export function placeGroupLabel(id: PlaceGroup): string {
  return t(`places.groups.${id}`);
}
