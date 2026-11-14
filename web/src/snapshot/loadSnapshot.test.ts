import { describe, expect, it } from "vitest";
import { pointSeriesEntries, type Catalog } from "./loadSnapshot";

const catalog: Catalog = {
  locations: [],
  snapshot: { generated_at: "2026-11-14T09:13:28Z" },
  series: [
    {
      variable_id: "imerg_precip",
      location_id: "taichung",
      aggregation: "point",
      file: "series/imerg_precip__taichung__point.json",
    },
    {
      variable_id: "imerg_precip",
      location_id: "taiwan",
      aggregation: "area_mean",
      file: "series/imerg_precip__taiwan__area_mean.json",
    },
    {
      variable_id: "station_temp",
      location_id: "taichung_station",
      aggregation: "station",
      file: "series/station_temp__taichung_station__station.json",
    },
  ],
};

describe("pointSeriesEntries", () => {
  it("keeps point series for the five places and skips regions and stations", () => {
    expect(pointSeriesEntries(catalog).map((entry) => entry.file)).toEqual([
      "series/imerg_precip__taichung__point.json",
    ]);
  });
});
