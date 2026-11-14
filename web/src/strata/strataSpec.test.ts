import { describe, expect, it } from "vitest";
import { formMapping } from "../forms/formMapping";
import { layerRegistry } from "../layers/registry";
import {
  strata,
  strataAssignment,
  strataAssignments,
  STRATA_NOTES,
  variablesOf,
} from "./strataSpec";

describe("strata table", () => {
  it("puts every layer variable on exactly one stratum", () => {
    for (const layer of layerRegistry) {
      const rows = strataAssignments.filter(
        (row) => row.variableId === layer.id,
      );
      expect(rows, layer.id).toHaveLength(1);
    }
    expect(strataAssignments).toHaveLength(layerRegistry.length);
  });

  it("only names strata and variables that exist", () => {
    const ids = strata.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of strataAssignments) {
      expect(ids).toContain(row.stratum);
      if (row.flowsTo) {
        expect(ids).toContain(row.flowsTo);
        expect(row.flowsTo).not.toBe(row.stratum);
      }
      expect(layerRegistry.some((layer) => layer.id === row.variableId)).toBe(
        true,
      );
    }
  });

  it("has five or six strata and none is empty", () => {
    expect(strata.length).toBeGreaterThanOrEqual(5);
    expect(strata.length).toBeLessThanOrEqual(6);
    for (const item of strata) {
      expect(variablesOf(item.id).length, item.id).toBeGreaterThan(0);
    }
  });

  it("lets only falling and rising forms cross strata, in their direction", () => {
    const order = strata.map((item) => item.id);
    for (const row of strataAssignments) {
      const motion = formMapping.find(
        (spec) => spec.variableId === row.variableId,
      )?.motion;
      if (!row.flowsTo) {
        expect(motion === "fall" || motion === "rise", row.variableId).toBe(
          false,
        );
        continue;
      }
      // `strata` is ordered top first: a larger index is lower down.
      const down = order.indexOf(row.flowsTo) > order.indexOf(row.stratum);
      expect(motion, row.variableId).toBe(down ? "fall" : "rise");
    }
  });

  it("keeps the agreed assignment", () => {
    expect(strataAssignment("omi_o3")?.stratum).toBe("stratosphere");
    expect(strataAssignment("omi_no2")?.stratum).toBe("troposphere-air");
    expect(strataAssignment("imerg_precip")?.flowsTo).toBe("land-surface");
    expect(strataAssignment("gldas_evap")?.flowsTo).toBe("near-surface");
    expect(strataAssignment("gldas_soilmoist")?.stratum).toBe("top-soil");
    expect(variablesOf("near-surface")).toEqual([
      "gldas_tair",
      "airs_tsurf",
      "merra2_t2m",
    ]);
  });

  it("marks the three column totals and says so in the legend", () => {
    const totals = strataAssignments
      .filter((row) => row.columnTotal)
      .map((row) => row.variableId)
      .sort();
    expect(totals).toEqual(["airs_h2ovap", "omi_no2", "omi_o3"]);
    const legend = STRATA_NOTES.join(" ");
    expect(legend).toContain("Heights are not to scale");
    expect(legend.toLowerCase()).toContain(
      "column totals are shown in the layer where most of the gas sits",
    );
    expect(legend).toContain("illustrative");
  });
});
