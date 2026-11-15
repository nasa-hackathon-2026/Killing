import { describe, expect, it } from "vitest";
import { toggleExpanded } from "./layerAccordion";

describe("layer accordion", () => {
  it("opens a layer", () => {
    expect([...toggleExpanded(new Set(), "imerg_precip")]).toEqual([
      "imerg_precip",
    ]);
  });

  it("keeps the other open layers open when another opens", () => {
    const next = toggleExpanded(new Set(["imerg_precip"]), "gldas_tair");
    expect([...next].sort()).toEqual(["gldas_tair", "imerg_precip"]);
  });

  it("closes only the layer that is chosen again", () => {
    const next = toggleExpanded(new Set(["a", "b"]), "a");
    expect([...next]).toEqual(["b"]);
  });

  it("does not change the set it is given", () => {
    const open = new Set(["a"]);
    toggleExpanded(open, "b");
    expect([...open]).toEqual(["a"]);
  });
});
