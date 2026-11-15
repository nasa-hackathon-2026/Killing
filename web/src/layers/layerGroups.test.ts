import { describe, expect, it } from "vitest";
import { groupLayers } from "./layerGroups";
import { layerRegistry } from "./registry";

describe("groupLayers", () => {
  it("puts every layer in exactly one group, top of the atmosphere first", () => {
    const groups = groupLayers(layerRegistry);
    const ids = groups.flatMap((group) => group.layers.map((l) => l.id));
    expect([...ids].sort()).toEqual(layerRegistry.map((l) => l.id).sort());
    expect(groups[0]?.id).toBe("stratosphere");
    expect(groups.at(-1)?.id).toBe("top-soil");
  });

  it("collects a layer the strata table does not list in a last group", () => {
    const stray = { ...layerRegistry[0]!, id: "not_in_table" };
    const groups = groupLayers([...layerRegistry, stray]);
    expect(groups.at(-1)).toMatchObject({ id: "other" });
    expect(groups.at(-1)?.layers.map((l) => l.id)).toEqual(["not_in_table"]);
  });
});
