import { describe, expect, it } from "vitest";
import { byAltitude, COMPANIONS } from "./companionSpec";
import { gatherCentre, gatherLayout } from "./gather";
import { INTERACTION_RULES, interactionsFor } from "./interactions";

describe("interactionsFor", () => {
  it("passes a drop from Vapor down to Rain", () => {
    expect(
      interactionsFor(byAltitude(["imerg_precip", "airs_h2ovap"])),
    ).toEqual([
      {
        upperId: "airs_h2ovap",
        lowerId: "imerg_precip",
        effect: "drip",
        litId: null,
        note: "Vapor above Rain: a drop passes down.",
      },
    ]);
  });

  it("lights the neighbour of a temperature companion, not the pair", () => {
    const lit = interactionsFor(byAltitude(["merra2_t2m", "modis_ndvi"]));
    expect(lit).toHaveLength(1);
    expect(lit[0]?.effect).toBe("glow");
    expect(lit[0]?.litId).toBe("modis_ndvi");
    const above = interactionsFor(byAltitude(["omi_o3", "merra2_t2m"]));
    expect(above[0]?.litId).toBe("omi_o3");
    expect(interactionsFor(byAltitude(["merra2_t2m", "airs_tsurf"]))).toEqual(
      [],
    );
  });

  it("has nothing to show for one companion or an unrelated pair", () => {
    expect(interactionsFor(byAltitude(["omi_o3"]))).toEqual([]);
    expect(interactionsFor(byAltitude(["omi_o3", "omi_no2"]))).toEqual([]);
  });

  it("only looks at neighbours", () => {
    const all = interactionsFor(byAltitude(COMPANIONS.map((item) => item.id)));
    const order = byAltitude(COMPANIONS.map((item) => item.id)).map(
      (item) => item.id,
    );
    for (const item of all) {
      expect(order.indexOf(item.lowerId) - order.indexOf(item.upperId)).toBe(1);
    }
  });

  it("describes what is drawn without claiming a cause", () => {
    for (const rule of INTERACTION_RULES) {
      expect(rule.note).not.toMatch(/because|cause|leads|makes|drives/i);
    }
  });
});

describe("gather layout", () => {
  it("puts an upper form pointing up beside a lower form palm down", () => {
    const { up, down } = gatherCentre(COMPANIONS);
    expect(up?.id).toBe("omi_o3");
    expect(down?.id).toBe("gldas_soilmoist");
    const places = gatherLayout(COMPANIONS);
    expect(places).toHaveLength(COMPANIONS.length);
    expect(places[0]).toMatchObject({ id: "omi_o3", gesture: "up" });
    expect(places[1]).toMatchObject({ id: "gldas_soilmoist", gesture: "down" });
    expect(places[0]?.x).toBeLessThan(places[1]?.x ?? 0);
    expect(places.filter((place) => place.gesture !== null)).toHaveLength(2);
  });

  it("prefers the layers that are switched on for the middle", () => {
    const { up, down } = gatherCentre(COMPANIONS, [
      "imerg_precip",
      "modis_ndvi",
    ]);
    expect(up?.id).toBe("imerg_precip");
    expect(down?.id).toBe("modis_ndvi");
  });

  it("keeps everyone on the stage, on both sides", () => {
    const places = gatherLayout(COMPANIONS);
    for (const place of places) {
      expect(place.x).toBeGreaterThan(0.04);
      expect(place.x).toBeLessThan(0.96);
      expect(place.y).toBeGreaterThan(0.3);
      expect(place.y).toBeLessThanOrEqual(1);
    }
    expect(places.filter((place) => place.x < 0.4).length).toBe(5);
    expect(places.filter((place) => place.x > 0.6).length).toBe(5);
  });

  it("works with a single companion", () => {
    const one = COMPANIONS.filter((item) => item.id === "omi_no2");
    expect(gatherLayout(one)).toEqual([
      {
        id: "omi_no2",
        x: 0.5,
        y: 0.52,
        scale: 1.15,
        gesture: "up",
        gestureSide: "right",
      },
    ]);
  });
});
