import { describe, expect, it } from "vitest";
import { nextExpanded } from "./layerAccordion";

describe("layer accordion", () => {
  it("opens a layer when none is open", () => {
    expect(nextExpanded(null, "imerg_precip")).toBe("imerg_precip");
  });

  it("closes the other layer when a second one opens", () => {
    expect(nextExpanded("imerg_precip", "gldas_tair")).toBe("gldas_tair");
  });

  it("closes the open layer when it is chosen again", () => {
    expect(nextExpanded("gldas_tair", "gldas_tair")).toBeNull();
  });
});
