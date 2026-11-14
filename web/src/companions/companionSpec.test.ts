import { describe, expect, it } from "vitest";
import { layerRegistry } from "../layers/registry";
import {
  bandAltitude,
  byAltitude,
  COMPANIONS,
  companionFor,
  companionTitle,
} from "./companionSpec";

describe("companion table", () => {
  it("has exactly one companion for every core layer", () => {
    expect(COMPANIONS.map((item) => item.id).sort()).toEqual(
      layerRegistry.map((layer) => layer.id).sort(),
    );
  });

  it("gives every companion a title of its own", () => {
    const titles = COMPANIONS.map(companionTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("takes the color from the layer's particles", () => {
    expect(companionFor("imerg_precip")?.baseColor).toBe("#8ec8ff");
    expect(companionFor("gldas_soilmoist")?.baseColor).toBe("#2f6fad");
  });

  it("orders companions as their particle bands are ordered", () => {
    for (const a of COMPANIONS) {
      for (const b of COMPANIONS) {
        if (bandAltitude(a.id) > bandAltitude(b.id)) {
          expect(a.altitudeOrder).toBeGreaterThan(b.altitudeOrder);
        }
      }
    }
    expect(new Set(COMPANIONS.map((item) => item.altitudeOrder)).size).toBe(
      COMPANIONS.length,
    );
  });

  it("puts sky above air above surface above ground", () => {
    const rank = { sky: 3, air: 2, surface: 1, ground: 0 };
    const sorted = byAltitude(COMPANIONS.map((item) => item.id));
    expect(sorted[0]?.id).toBe("omi_o3");
    expect(sorted.at(-1)?.id).toBe("gldas_soilmoist");
    const ranks = sorted
      .filter((item) => item.id !== "gldas_evap")
      .map((item) => rank[item.layer]);
    expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
  });

  it("returns undefined for an unknown variable", () => {
    expect(companionFor("nope")).toBeUndefined();
    expect(byAltitude(["nope", "omi_no2"]).map((item) => item.id)).toEqual([
      "omi_no2",
    ]);
  });
});
