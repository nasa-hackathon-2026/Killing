import { describe, expect, it } from "vitest";
import {
  loadPlaceSeries,
  loadPlaceSnapshot,
  regionPending,
  taiwanRegions,
  type Catalog,
} from "./loadSnapshot";
import {
  groupedPlaces,
  isRegion,
  placeAnchor,
  placeNote,
  resolvePlaceId,
} from "./places";
import { trendKey } from "../analysis/trends";

function region(id: string, name: string, bbox: number[]) {
  return { id, name_en: name, kind: "region", bbox };
}

function entry(variable: string, location: string, aggregation: string) {
  return {
    variable_id: variable,
    location_id: location,
    aggregation,
    file: `series/${variable}__${location}__${aggregation}.json`,
  };
}

// The north has no OMI ozone and a MODIS auxiliary series, as in the
// core catalog.
const core: Catalog = {
  locations: [
    {
      id: "taichung",
      name_en: "Taichung",
      kind: "point",
      lat: 24.15,
      lon: 120.68,
    },
    region("taiwan", "Taiwan", [120.0, 21.8, 122.1, 25.4]),
    region("north", "Northern Taiwan", [121.0, 24.6, 122.1, 25.4]),
    region("central", "Central Taiwan", [120.2, 23.5, 121.3, 24.6]),
    region("south", "Southern Taiwan", [120.0, 21.8, 121.0, 23.5]),
    region("east", "Eastern Taiwan", [121.0, 22.3, 121.8, 24.6]),
  ],
  snapshot: { generated_at: "2026-11-14T09:13:28Z" },
  series: [
    entry("omi_o3", "taichung", "point"),
    entry("imerg_precip", "taichung", "point"),
    entry("imerg_precip", "taiwan", "area_mean"),
    entry("imerg_precip", "north", "area_mean"),
    entry("omi_o3", "taiwan", "area_mean"),
    entry("modis_ndvi_pc", "north", "area_mean"),
    entry("power_t2m", "north", "area_mean"),
  ],
};

const empty = { unit: "mm/day", points: [] };

describe("taiwanRegions", () => {
  it("lists the regions in menu order as area means without a point", () => {
    const regions = taiwanRegions(core);
    // central, south and east have no series in this catalog.
    expect(regions.map((place) => place.id)).toEqual(["taiwan", "north"]);
    const taiwan = regions[0];
    expect(taiwan.group).toBe("taiwan_region");
    expect(taiwan.aggregation).toBe("area_mean");
    expect(taiwan.lat).toBeNull();
    expect(taiwan.bbox).toEqual([120.0, 21.8, 122.1, 25.4]);
    expect(isRegion(taiwan)).toBe(true);
  });

  it("leaves out a region without a series or a valid bbox", () => {
    const ids = taiwanRegions({
      ...core,
      locations: [
        ...core.locations,
        { id: "broken", name_en: "Broken", kind: "region", bbox: [1, 2, 3] },
      ],
    }).map((place) => place.id);
    expect(ids).toEqual(["taiwan", "north"]);
  });

  it("anchors a region at the middle of its data area", () => {
    const anchor = placeAnchor(taiwanRegions(core)[0]);
    expect(anchor?.lat).toBeCloseTo(23.6, 6);
    expect(anchor?.lon).toBeCloseTo(121.05, 6);
  });
});

describe("regionPending", () => {
  it("reads each region's area-mean series of the layer variables only", () => {
    const pending = regionPending(core, taiwanRegions(core));
    // power_t2m has no point series and modis_ndvi_pc is an auxiliary
    // variant: neither is a layer.
    expect(pending.map((item) => [item.locationId, item.variableId])).toEqual([
      ["taiwan", "imerg_precip"],
      ["north", "imerg_precip"],
      ["taiwan", "omi_o3"],
    ]);
    expect(pending[0].url).toContain(
      "data/snapshot/series/imerg_precip__taiwan__area_mean.json",
    );
  });

  it("selects the area-mean trend key for the region", () => {
    const [taiwan] = taiwanRegions(core);
    expect(trendKey("imerg_precip", taiwan.id, taiwan.aggregation)).toBe(
      "imerg_precip__taiwan__area_mean",
    );
  });
});

describe("regions in the place menu", () => {
  const files: Record<string, unknown> = {
    "catalog.json": core,
    "series/omi_o3__taichung__point.json": empty,
    "series/imerg_precip__taichung__point.json": empty,
    "series/imerg_precip__taiwan__area_mean.json": {
      unit: "mm/day",
      points: [{ month: "2001-01-01", value: 3 }],
    },
    "series/imerg_precip__north__area_mean.json": empty,
    "series/omi_o3__taiwan__area_mean.json": empty,
  };
  const fetchJson = async <T>(url: string): Promise<T> => {
    const key = url.slice(url.indexOf("data/snapshot/") + 14);
    if (!(key in files)) throw new Error(`404 ${url}`);
    return files[key] as T;
  };

  it("puts the regions after the Taiwan points and before the world cities", async () => {
    const snapshot = await loadPlaceSnapshot(fetchJson);
    expect(
      groupedPlaces(snapshot.places).map((group) => [
        group.label,
        group.places.map((place) => place.id),
      ]),
    ).toEqual([
      ["Taiwan", ["taichung"]],
      ["Taiwan regions (area means)", ["taiwan", "north"]],
    ]);
    // Regions are read when picked, not at the start.
    expect(snapshot.loaded).toEqual(["taichung"]);
    expect(snapshot.series.some((item) => item.locationId === "taiwan")).toBe(
      false,
    );
  });

  it("reads the picked region's series and says nothing for a variable it lacks", async () => {
    const snapshot = await loadPlaceSnapshot(fetchJson);
    const next = await loadPlaceSeries(snapshot, "taiwan", fetchJson);
    expect(next.loaded).toContain("taiwan");
    const here = next.series.filter((item) => item.locationId === "taiwan");
    expect(here.map((item) => item.variableId)).toEqual([
      "imerg_precip",
      "omi_o3",
    ]);
    // No series of this place for the variable: the layers show "No data at
    // this place".
    expect(here.find((item) => item.variableId === "gldas_tair")).toBe(
      undefined,
    );
  });

  it("opens a region with ?at= once the catalogs list it", async () => {
    const snapshot = await loadPlaceSnapshot(fetchJson);
    expect(resolvePlaceId("north", snapshot.places)).toBe("north");
    expect(resolvePlaceId("east", snapshot.places)).toBe("taichung");
    expect(resolvePlaceId("north", [])).toBe("north");
  });

  it("states the data area under the menu", async () => {
    const snapshot = await loadPlaceSnapshot(fetchJson);
    const north = snapshot.places.find((place) => place.id === "north");
    expect(placeNote(north, "expert")).toContain("121.0–122.1°E, 24.6–25.4°N");
    expect(placeNote(north, "general")).toMatch(/not the value at one place/);
    expect(placeNote(snapshot.places[0])).toBeNull();
  });
});
