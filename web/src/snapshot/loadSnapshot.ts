import { isBbox } from "../geo/regionFrame";
import { isPlaceGroup, type Place, type PlaceGroup } from "./places";
import type { SeriesPoint } from "./reading";

export const placeIds = [
  "taichung",
  "taipei",
  "kaohsiung",
  "hualien",
  "yushan",
] as const;

// The five regions of the core catalog (`kind = "region"`), in menu order:
// the whole island, then north to south, then east.
export const regionIds = [
  "taiwan",
  "north",
  "central",
  "south",
  "east",
] as const;

export type Catalog = {
  locations: {
    id: string;
    name_en: string;
    // Present in the world subset's catalog (data/seed/locations.world.json).
    group?: string;
    lat?: number | null;
    lon?: number | null;
    // Core catalog: "point" or "region"; a region has a bbox
    // [west, south, east, north].
    kind?: string;
    bbox?: number[];
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
  // Series read so far: the Taiwan points' from the start, a region's or a
  // world place's once it has been picked (`loaded` lists the places whose series are all here).
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

// The Taiwan regions that have a bbox and at least one area-mean series.
// Each is read as the area mean of its data area; it has no single point
// (lat and lon stay null), the bbox is kept for the globe.
export function taiwanRegions(catalog: Catalog): Place[] {
  return regionIds.flatMap((id) => {
    const location = catalog.locations.find((item) => item.id === id);
    if (!location || location.kind !== "region" || !isBbox(location.bbox)) {
      return [];
    }
    const hasSeries = catalog.series.some(
      (entry) => entry.location_id === id && entry.aggregation === "area_mean",
    );
    if (!hasSeries) return [];
    return [
      {
        id: location.id,
        nameEn: location.name_en,
        lat: null,
        lon: null,
        group: "taiwan_region" as const,
        aggregation: "area_mean",
        bbox: location.bbox,
      },
    ];
  });
}

// Area-mean series of the regions, for the variables the points have too
// (the layers). The auxiliary variants (`modis_*_pc`) are left out so the
// month range of a region is that of the layers. Read when a region is
// picked, like the world places.
export function regionPending(
  catalog: Catalog,
  regions: Place[],
): PendingSeries[] {
  const layerVariables = new Set(
    pointSeriesEntries(catalog).map((entry) => entry.variable_id),
  );
  return catalog.series.flatMap((entry) => {
    const region = regions.find((item) => item.id === entry.location_id);
    if (
      !region ||
      entry.aggregation !== region.aggregation ||
      !layerVariables.has(entry.variable_id)
    ) {
      return [];
    }
    return [
      {
        variableId: entry.variable_id,
        locationId: entry.location_id,
        url: snapshotUrl(entry.file),
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
  const regions = taiwanRegions(catalog);
  const elsewhere = world
    ? worldPlaces(world).filter(
        (place) =>
          ![...taiwan, ...regions].some((item) => item.id === place.id),
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
    places: [...taiwan, ...regions, ...elsewhere],
    series,
    loaded: taiwan.map((place) => place.id),
    pending: [
      ...regionPending(catalog, regions),
      ...(world ? worldPending(world, elsewhere) : []),
    ],
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
