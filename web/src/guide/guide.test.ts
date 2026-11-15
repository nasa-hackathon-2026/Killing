import { describe, expect, it } from "vitest";
import { layerRegistry } from "../layers/registry";
import { mockLocations } from "../mock/snapshot";
import { TREND_MAP_VARIABLES } from "../trendmap/trendMapConfig";
import { exampleHref, GUIDE_EXAMPLES, viewQuery } from "./examples";
import {
  DEFAULT_LAYERS,
  guideDismissed,
  GUIDE_STORAGE_KEY,
  hasViewParams,
  rememberGuideDismissed,
  showGuideAtStart,
  startingLayers,
} from "./firstVisit";

const BASE = "/earth-system-trend-detective/";
const layerIds = layerRegistry.map((layer) => layer.id);

describe("guide examples", () => {
  it("has three or four examples with distinct ids", () => {
    expect(GUIDE_EXAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(GUIDE_EXAMPLES.length).toBeLessThanOrEqual(4);
    expect(new Set(GUIDE_EXAMPLES.map((item) => item.id)).size).toBe(
      GUIDE_EXAMPLES.length,
    );
  });

  it("titles every example with a question", () => {
    for (const example of GUIDE_EXAMPLES) {
      expect(example.question.endsWith("?")).toBe(true);
    }
  });

  it("only refers to layers, places and trend maps that exist", () => {
    for (const example of GUIDE_EXAMPLES) {
      if (!("view" in example)) continue;
      const { layers = [], place, chart, trendmap } = example.view;
      for (const id of layers) expect(layerIds).toContain(id);
      if (chart) expect(layerIds).toContain(chart);
      if (place) {
        expect(mockLocations.map((item) => item.id)).toContain(place);
      }
      if (trendmap) {
        expect(TREND_MAP_VARIABLES.map((item) => item.id)).toContain(trendmap);
      }
    }
  });

  it("builds the query of a view from the existing parameters", () => {
    expect(
      viewQuery({
        layers: ["imerg_precip", "merra2_t2m"],
        place: "taipei",
        chart: "imerg_precip",
        strata: true,
        trendmap: "merra2_t2m",
      }),
    ).toBe(
      "layers=imerg_precip,merra2_t2m&at=taipei&chart=imerg_precip&strata=1&trendmap=merra2_t2m",
    );
    expect(viewQuery({})).toBe("");
  });

  it("links a view example to the main page and a page example to its page", () => {
    const href = (id: string) => {
      const example = GUIDE_EXAMPLES.find((item) => item.id === id);
      if (!example) throw new Error(id);
      return exampleHref(example, BASE);
    };
    expect(href("rainfall-taichung")).toBe(
      `${BASE}?layers=imerg_precip&at=taichung&chart=imerg_precip`,
    );
    expect(href("model-vs-station")).toBe(
      `${BASE}compare/?pair=merra2_t2m__station_temp__taichung_station`,
    );
    expect(href("global-trend-map")).toBe(
      `${BASE}?layers=merra2_t2m&trendmap=merra2_t2m`,
    );
  });

  it("makes links that do not count as a first visit", () => {
    for (const example of GUIDE_EXAMPLES) {
      if (!("view" in example)) continue;
      const search = exampleHref(example, BASE).slice(BASE.length);
      expect(hasViewParams(search)).toBe(true);
    }
  });
});

describe("first visit", () => {
  it("treats an address with no view parameter as a first visit", () => {
    expect(hasViewParams("")).toBe(false);
    expect(hasViewParams("?utm_source=x")).toBe(false);
    expect(hasViewParams("?layers=omi_no2")).toBe(true);
    expect(hasViewParams("?strata=1&at=taipei")).toBe(true);
    expect(hasViewParams("?companions=gather")).toBe(true);
  });

  it("switches the default layers on only when the address sets nothing", () => {
    expect(startingLayers("")).toEqual(DEFAULT_LAYERS);
    expect(startingLayers("?layers=omi_no2,omi_o3")).toEqual([
      "omi_no2",
      "omi_o3",
    ]);
    expect(startingLayers("?layers=")).toEqual([]);
    expect(startingLayers("?trendmap=merra2_t2m")).toBeNull();
  });

  it("uses default layers that exist and avoids the series with known steps", () => {
    for (const id of DEFAULT_LAYERS) expect(layerIds).toContain(id);
    expect(DEFAULT_LAYERS).not.toContain("gldas_tair");
    expect(DEFAULT_LAYERS.length).toBeLessThanOrEqual(2);
  });

  it("shows the card by itself only on a first visit that has not dismissed it", () => {
    expect(showGuideAtStart("", false)).toBe(true);
    expect(showGuideAtStart("", true)).toBe(false);
    expect(showGuideAtStart("?chart=imerg_precip", false)).toBe(false);
  });

  it("remembers the dismissal and survives a storage that throws", () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(guideDismissed(store)).toBe(false);
    rememberGuideDismissed(store);
    expect(values.get(GUIDE_STORAGE_KEY)).toBe("1");
    expect(guideDismissed(store)).toBe(true);

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(guideDismissed(broken)).toBe(false);
    expect(() => rememberGuideDismissed(broken)).not.toThrow();
    expect(guideDismissed(null)).toBe(false);
  });
});
