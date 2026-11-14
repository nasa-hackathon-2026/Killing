import { describe, expect, it } from "vitest";
import { initialLayerVisibility, layerRegistry } from "./registry";

describe("layerRegistry", () => {
  it("lists twelve variables and only precipitation falls", () => {
    expect(layerRegistry).toHaveLength(12);
    const ids = layerRegistry.map((layer) => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
    const precipitation = layerRegistry.find(
      (layer) => layer.id === "imerg_precip",
    );
    expect(precipitation?.motion).toBe("fall");
    expect(precipitation?.glassColor).toBe("#8ec8ff");
    const others = layerRegistry.filter((layer) => layer.id !== "imerg_precip");
    expect(others.every((layer) => layer.motion === "drift")).toBe(true);
  });

  it("starts with precipitation visible", () => {
    expect(initialLayerVisibility("imerg_precip")).toBe(true);
    expect(initialLayerVisibility("modis_ndvi")).toBe(false);
  });
});
