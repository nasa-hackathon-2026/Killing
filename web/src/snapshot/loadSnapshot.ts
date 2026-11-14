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
    lat: number | null;
    lon: number | null;
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

export type Place = {
  id: string;
  nameEn: string;
  lat: number;
  lon: number;
};

export type PlaceSnapshot = {
  generatedAt: string;
  places: Place[];
  series: LoadedSeries[];
};

type SeriesFile = {
  unit: string;
  points: SeriesPoint[];
};

export function snapshotUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/snapshot/${file}`;
}

export function pointSeriesEntries(catalog: Catalog): Catalog["series"] {
  return catalog.series.filter(
    (entry) =>
      entry.aggregation === "point" &&
      (placeIds as readonly string[]).includes(entry.location_id),
  );
}

export async function loadPlaceSnapshot(
  fetchJson: <T>(url: string) => Promise<T> = defaultFetch,
): Promise<PlaceSnapshot> {
  const catalog = await fetchJson<Catalog>(snapshotUrl("catalog.json"));
  const places = placeIds.flatMap((id) => {
    const location = catalog.locations.find((item) => item.id === id);
    if (!location || location.lat === null || location.lon === null) return [];
    return [
      {
        id: location.id,
        nameEn: location.name_en,
        lat: location.lat,
        lon: location.lon,
      },
    ];
  });
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
  return { generatedAt: catalog.snapshot.generated_at, places, series };
}

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}
