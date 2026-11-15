import { describe, expect, it } from "vitest";
import { layerRegistry } from "../layers/registry";
import { strataAssignments } from "../strata/strataSpec";
import {
  bandAltitude,
  byAltitude,
  COMPANIONS,
  companionCount,
  companionFor,
  companionTitle,
  othersByAltitude,
  STRATUM_LAYER,
  stratumRank,
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

  it("orders companions by stratum, then by particle band", () => {
    for (const a of COMPANIONS) {
      for (const b of COMPANIONS) {
        if (stratumRank(a.id) > stratumRank(b.id)) {
          expect(a.altitudeOrder).toBeGreaterThan(b.altitudeOrder);
        }
        if (
          stratumRank(a.id) === stratumRank(b.id) &&
          bandAltitude(a.id) > bandAltitude(b.id)
        ) {
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
    const ranks = sorted.map((item) => rank[item.layer]);
    expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
  });

  it("stands every companion on the stratum the layer view gives it", () => {
    for (const row of strataAssignments) {
      expect(companionFor(row.variableId)?.layer).toBe(
        STRATUM_LAYER[row.stratum],
      );
    }
    expect(strataAssignments).toHaveLength(COMPANIONS.length);
  });

  it("returns undefined for an unknown variable", () => {
    expect(companionFor("nope")).toBeUndefined();
    expect(byAltitude(["nope", "omi_no2"]).map((item) => item.id)).toEqual([
      "omi_no2",
    ]);
  });
});

describe("companions that are off", () => {
  const open = ["imerg_precip", "merra2_t2m"];

  it("lists exactly the ones whose layer is off, so all twelve show up", () => {
    const rest = othersByAltitude(open).map((spec) => spec.id);
    expect(rest).toHaveLength(COMPANIONS.length - open.length);
    expect(rest.some((id) => open.includes(id))).toBe(false);
    expect([...rest, ...open].sort()).toEqual(
      COMPANIONS.map((spec) => spec.id).sort(),
    );
  });

  it("orders them from the highest down, like the open ones", () => {
    const rest = othersByAltitude(open);
    const heights = rest.map((spec) => spec.altitudeOrder);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
  });

  it("is empty when every layer is on and full when none is", () => {
    const all = COMPANIONS.map((spec) => spec.id);
    expect(othersByAltitude(all)).toEqual([]);
    expect(othersByAltitude([])).toHaveLength(COMPANIONS.length);
  });

  it("ignores ids that are not a companion", () => {
    expect(companionCount(["imerg_precip", "nonsense"])).toEqual({
      shown: 1,
      total: COMPANIONS.length,
    });
  });
});
