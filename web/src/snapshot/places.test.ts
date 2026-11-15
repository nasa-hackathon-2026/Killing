import { describe, expect, it } from "vitest";
import {
  loadPlaceSeries,
  loadPlaceSnapshot,
  worldPlaces,
  type Catalog,
} from "./loadSnapshot";
import {
  DEFAULT_PLACE_ID,
  groupedPlaces,
  hasCoordinates,
  nearestPlace,
  placeNote,
  resolvePlaceId,
  type Place,
} from "./places";

const core: Catalog = {
  locations: [
    { id: "taichung", name_en: "Taichung", lat: 24.15, lon: 120.68 },
    { id: "taipei", name_en: "Taipei", lat: 25.03, lon: 121.56 },
    { id: "taiwan", name_en: "Taiwan" },
  ],
  snapshot: { generated_at: "2026-11-14T09:13:28Z" },
  series: [
    {
      variable_id: "omi_no2",
      location_id: "taichung",
      aggregation: "point",
      file: "series/omi_no2__taichung__point.json",
    },
  ],
};

const world: Catalog = {
  locations: [
    { id: "global", name_en: "Global", group: "global" },
    { id: "europe", name_en: "Europe", group: "world_region" },
    {
      id: "tokyo",
      name_en: "Tokyo",
      group: "world_city",
      lat: 35.68,
      lon: 139.69,
    },
    {
      id: "sydney",
      name_en: "Sydney",
      group: "world_city",
      lat: -33.87,
      lon: 151.21,
    },
    { id: "cairo", name_en: "Cairo", group: "world_city", lat: 30, lon: 31 },
  ],
  snapshot: { generated_at: "2026-11-15T00:00:00Z" },
  series: [
    {
      variable_id: "omi_no2",
      location_id: "tokyo",
      aggregation: "point",
      file: "series/omi_no2__tokyo__point.json",
    },
    {
      variable_id: "omi_no2",
      location_id: "sydney",
      aggregation: "point",
      file: "series/omi_no2__sydney__point.json",
    },
    {
      variable_id: "omi_no2",
      location_id: "global",
      aggregation: "area_mean_grid",
      file: "series/omi_no2__global__area_mean_grid.json",
    },
    {
      variable_id: "omi_no2",
      location_id: "europe",
      aggregation: "area_mean_grid",
      file: "series/omi_no2__europe__area_mean_grid.json",
    },
  ],
};

const base = `${import.meta.env.BASE_URL}data/snapshot/`;

function fetcher(files: Record<string, unknown>, asked: string[] = []) {
  return async <T>(url: string): Promise<T> => {
    asked.push(url);
    const key = url.slice(url.indexOf("data/snapshot/") + 14);
    if (!(key in files)) throw new Error(`404 ${url}`);
    return files[key] as T;
  };
}

const point = { unit: "molecules/cm^2", points: [] };
const files = {
  "catalog.json": core,
  "world/catalog.json": world,
  "series/omi_no2__taichung__point.json": point,
  "world/series/omi_no2__tokyo__point.json": point,
  "world/series/omi_no2__global__area_mean_grid.json": point,
};

describe("worldPlaces", () => {
  it("lists cities and the global mean that have series, in catalog order", () => {
    expect(worldPlaces(world).map((place) => place.id)).toEqual([
      "global",
      "tokyo",
      "sydney",
    ]);
  });

  it("reads the global mean as a grid area mean without coordinates", () => {
    const global = worldPlaces(world).find((place) => place.id === "global");
    expect(global?.aggregation).toBe("area_mean_grid");
    expect(hasCoordinates(global)).toBe(false);
    expect(placeNote(global, "expert")).toMatch(/Not a point value/);
    expect(placeNote(global, "general")).toMatch(/not the value at one place/);
    expect(placeNote(worldPlaces(world)[1])).toBeNull();
  });
});

describe("loadPlaceSnapshot", () => {
  it("lists every place but reads only Taiwan's series at the start", async () => {
    const asked: string[] = [];
    const snapshot = await loadPlaceSnapshot(fetcher(files, asked));
    expect(snapshot.places.map((place) => place.id)).toEqual([
      "taichung",
      "taipei",
      "global",
      "tokyo",
      "sydney",
    ]);
    expect(snapshot.loaded).toEqual(["taichung", "taipei"]);
    expect(snapshot.series.map((item) => item.locationId)).toEqual([
      "taichung",
    ]);
    expect(asked.some((url) => url.includes("tokyo"))).toBe(false);
    expect(snapshot.pending.map((entry) => entry.url)).toContain(
      `${base}world/series/omi_no2__tokyo__point.json`,
    );
  });

  it("shows Taiwan only when the world subset is not published", async () => {
    const snapshot = await loadPlaceSnapshot(
      fetcher({
        "catalog.json": core,
        "series/omi_no2__taichung__point.json": point,
      }),
    );
    expect(snapshot.places.map((place) => place.id)).toEqual([
      "taichung",
      "taipei",
    ]);
    expect(snapshot.pending).toEqual([]);
  });
});

describe("loadPlaceSeries", () => {
  it("adds the series of a world place once it is picked", async () => {
    const snapshot = await loadPlaceSnapshot(fetcher(files));
    const next = await loadPlaceSeries(snapshot, "tokyo", fetcher(files));
    expect(next.loaded).toContain("tokyo");
    expect(
      next.series.filter((item) => item.locationId === "tokyo"),
    ).toHaveLength(1);
    expect(next.pending.some((entry) => entry.locationId === "tokyo")).toBe(
      false,
    );
    // Already loaded and unknown places change nothing.
    expect(await loadPlaceSeries(next, "tokyo", fetcher({}))).toBe(next);
    expect(await loadPlaceSeries(next, "atlantis", fetcher({}))).toBe(next);
  });

  it("reads the global mean from its grid area mean file", async () => {
    const asked: string[] = [];
    const snapshot = await loadPlaceSnapshot(fetcher(files));
    await loadPlaceSeries(snapshot, "global", fetcher(files, asked));
    expect(asked).toEqual([
      `${base}world/series/omi_no2__global__area_mean_grid.json`,
    ]);
  });
});

describe("place menu", () => {
  it("groups places under Taiwan, World cities and Global", async () => {
    const snapshot = await loadPlaceSnapshot(fetcher(files));
    expect(
      groupedPlaces(snapshot.places).map((group) => [
        group.label,
        group.places.map((place) => place.nameEn),
      ]),
    ).toEqual([
      ["Taiwan", ["Taichung", "Taipei"]],
      ["World cities", ["Tokyo", "Sydney"]],
      ["Global", ["Global"]],
    ]);
  });

  it("leaves out a group that has no places", () => {
    expect(groupedPlaces([]).length).toBe(0);
  });
});

describe("resolvePlaceId (?at=)", () => {
  const places = worldPlaces(world);
  it("keeps an id the catalogs list", () => {
    expect(resolvePlaceId("tokyo", places)).toBe("tokyo");
    expect(resolvePlaceId("global", places)).toBe("global");
  });
  it("falls back to the default for an unknown or missing id", () => {
    expect(resolvePlaceId("atlantis", places)).toBe(DEFAULT_PLACE_ID);
    expect(resolvePlaceId("europe", places)).toBe(DEFAULT_PLACE_ID);
    expect(resolvePlaceId(null, places)).toBe(DEFAULT_PLACE_ID);
  });
  it("keeps the asked id until the catalogs are read", () => {
    expect(resolvePlaceId("tokyo", [])).toBe("tokyo");
  });
});

describe("nearestPlace (Fly near me)", () => {
  const point = (
    id: string,
    lat: number,
    lon: number,
    group: Place["group"],
  ): Place => ({ id, nameEn: id, lat, lon, group, aggregation: "point" });
  const places: Place[] = [
    point("taichung", 24.15, 120.68, "taiwan"),
    point("taipei", 25.03, 121.56, "taiwan"),
    point("kaohsiung", 22.63, 120.3, "taiwan"),
    point("tokyo", 35.68, 139.69, "world_city"),
    point("los_angeles", 34.05, -118.24, "world_city"),
    point("sydney", -33.87, 151.21, "world_city"),
    {
      id: "central",
      nameEn: "Central",
      lat: null,
      lon: null,
      group: "taiwan_region",
      aggregation: "area_mean",
      bbox: [120.2, 23.5, 121.3, 24.6],
    },
    {
      id: "global",
      nameEn: "Global",
      lat: null,
      lon: null,
      group: "global",
      aggregation: "area_mean_grid",
    },
  ];

  it("picks the closest Taiwan point", () => {
    // Tunghai University, Taichung.
    expect(nearestPlace(24.18, 120.6, places)?.id).toBe("taichung");
    expect(nearestPlace(25.1, 121.5, places)?.id).toBe("taipei");
    expect(nearestPlace(22.7, 120.35, places)?.id).toBe("kaohsiung");
  });

  it("picks the closest world city, across the date line too", () => {
    expect(nearestPlace(35.0, 135.8, places)?.id).toBe("tokyo");
    // Honolulu: Los Angeles is closer than Tokyo or Sydney.
    expect(nearestPlace(21.3, -157.86, places)?.id).toBe("los_angeles");
    // Auckland: Sydney, not Los Angeles on the far side of the date line.
    expect(nearestPlace(-36.85, 174.76, places)?.id).toBe("sydney");
  });

  it("never picks a region or the global mean", () => {
    expect(nearestPlace(24.0, 120.8, places)?.group).toBe("taiwan");
    expect(nearestPlace(0, 0, places.slice(6))).toBeNull();
    expect(nearestPlace(0, 0, [])).toBeNull();
  });
});
