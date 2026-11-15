import { isPlaceGroup, type Place, type PlaceGroup } from "./places";
import type { SeriesPoint } from "./reading";

export const placeIds = [
  "taichung",
  "taipei",
  "kaohsiung",
  "hualien",
  "yushan",
] as const;

export type Catalog = {
  locations: {
    id: string;
    name_en: string;
    // Present in the world subset's catalog (data/seed/locations.world.json).
    group?: string;
    lat?: number | null;
    lon?: number | null;
  }[];
  series: {
    variable_id: string;
    location_id: string;
    aggregation: string;
    file: string;
  }[];
  snapshot: { generated_at: string };
};

export type LoadedSeries = {
  variableId: string;
  locationId: string;
  unit: string;
  points: SeriesPoint[];
};

export type { Place };

// One series file still to be read: the world subset is read one place at a
// time, when that place is picked.
export type PendingSeries = {
  variableId: string;
  locationId: string;
  url: string;
};

export type PlaceSnapshot = {
  generatedAt: string;
  places: Place[];
  // Series read so far: Taiwan's from the start, a world place's once it
  // has been picked (`loaded` lists the places whose series are all here).
  series: LoadedSeries[];
  loaded: string[];
  pending: PendingSeries[];
};

type SeriesFile = {
  unit: string;
  points: SeriesPoint[];
};

type FetchJson = <T>(url: string) => Promise<T>;

// Aggregation the main view reads for each group of world places.
const WORLD_AGGREGATION: Partial<Record<PlaceGroup, string>> = {
  world_city: "point",
  global: "area_mean_grid",
};

export function snapshotUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/snapshot/${file}`;
}

export function worldSnapshotUrl(file: string): string {
  return snapshotUrl(`world/${file}`);
}

export function pointSeriesEntries(catalog: Catalog): Catalog["series"] {
  return catalog.series.filter(
    (entry) =>
      entry.aggregation === "point" &&
      (placeIds as readonly string[]).includes(entry.location_id),
  );
}

export function taiwanPlaces(catalog: Catalog): Place[] {
  return placeIds.flatMap((id) => {
    const location = catalog.locations.find((item) => item.id === id);
    if (!location || location.lat == null || location.lon == null) return [];
    return [
      {
        id: location.id,
        nameEn: location.name_en,
        lat: location.lat,
        lon: location.lon,
        group: "taiwan" as const,
        aggregation: "point",
      },
    ];
  });
}

// World cities and the global mean, in the order of the world catalog. A
// place is listed only when the catalog has at least one series for it in
// the aggregation the main view reads.
export function worldPlaces(catalog: Catalog): Place[] {
  return catalog.locations.flatMap((location) => {
    if (!isPlaceGroup(location.group)) return [];
    const aggregation = WORLD_AGGREGATION[location.group];
    if (!aggregation) return [];
    const hasSeries = catalog.series.some(
      (entry) =>
        entry.location_id === location.id && entry.aggregation === aggregation,
    );
    if (!hasSeries) return [];
    return [
      {
        id: location.id,
        nameEn: location.name_en,
        lat: location.lat ?? null,
        lon: location.lon ?? null,
        group: location.group,
        aggregation,
      },
    ];
  });
}

export function worldPending(
  catalog: Catalog,
  places: Place[],
): PendingSeries[] {
  return catalog.series.flatMap((entry) => {
    const place = places.find((item) => item.id === entry.location_id);
    if (!place || place.aggregation !== entry.aggregation) return [];
    return [
      {
        variableId: entry.variable_id,
        locationId: entry.location_id,
        url: worldSnapshotUrl(entry.file),
      },
    ];
  });
}

export async function loadPlaceSnapshot(
  fetchJson: FetchJson = defaultFetch,
): Promise<PlaceSnapshot> {
  const [catalog, world] = await Promise.all([
    fetchJson<Catalog>(snapshotUrl("catalog.json")),
    // The world subset is optional: without it the site shows Taiwan only.
    fetchJson<Catalog>(worldSnapshotUrl("catalog.json")).catch(() => null),
  ]);
  const taiwan = taiwanPlaces(catalog);
  const elsewhere = world
    ? worldPlaces(world).filter(
        (place) => !taiwan.some((item) => item.id === place.id),
      )
    : [];
  const series = await Promise.all(
    pointSeriesEntries(catalog).map(async (entry) => {
      const file = await fetchJson<SeriesFile>(snapshotUrl(entry.file));
      return {
        variableId: entry.variable_id,
        locationId: entry.location_id,
        unit: file.unit,
        points: file.points,
      };
    }),
  );
  return {
    generatedAt: catalog.snapshot.generated_at,
    places: [...taiwan, ...elsewhere],
    series,
    loaded: taiwan.map((place) => place.id),
    pending: world ? worldPending(world, elsewhere) : [],
  };
}

// Reads the series of one place that is not loaded yet and returns the
// snapshot with them added. A place that is already loaded (or unknown)
// returns the same object.
export async function loadPlaceSeries(
  snapshot: PlaceSnapshot,
  locationId: string,
  fetchJson: FetchJson = defaultFetch,
): Promise<PlaceSnapshot> {
  if (snapshot.loaded.includes(locationId)) return snapshot;
  if (!snapshot.places.some((place) => place.id === locationId)) {
    return snapshot;
  }
  const wanted = snapshot.pending.filter(
    (entry) => entry.locationId === locationId,
  );
  const added = await Promise.all(
    wanted.map(async (entry) => {
      const file = await fetchJson<SeriesFile>(entry.url);
      return {
        variableId: entry.variableId,
        locationId: entry.locationId,
        unit: file.unit,
        points: file.points,
      };
    }),
  );
  return {
    ...snapshot,
    series: [...snapshot.series, ...added],
    loaded: [...snapshot.loaded, locationId],
    pending: snapshot.pending.filter(
      (entry) => entry.locationId !== locationId,
    ),
  };
}

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}
