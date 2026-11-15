import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GlobeStatsSection } from "./GlobeStatsSection";
import type { GlobeStatsState } from "./useGlobeStats";

const noop = () => {};

const state: GlobeStatsState = {
  hidden: false,
  mode: "trend",
  setMode: noop,
  selectedVariableId: "imerg_precip",
  selectedVariableName: "Precipitation",
  selectedLocationId: "taichung",
  selectedLocationName: "Taichung",
  modelVariableId: "merra2_t2m",
  setModelVariableId: noop,
  modelVariables: [],
  trends: { status: "loading" },
  modelVsObs: { status: "loading" },
  similarSeries: { status: "loading" },
  trendGlyphs: [],
  gapGlyphs: [],
  alikeArcs: [],
  places: [],
  onSelectLocation: noop,
};

function render(open: boolean, overrides: Partial<GlobeStatsState> = {}) {
  return renderToStaticMarkup(
    createElement(GlobeStatsSection, {
      state: { ...state, ...overrides },
      defaultOpen: open,
    }),
  );
}

describe("the statistics section of the drawer", () => {
  it("names the shown mode in its title while folded", () => {
    const html = render(false);
    expect(html).toContain("On the globe: Trend at every place");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<select");
  });

  it("shows the mode menu and the legend and table buttons while open", () => {
    const html = render(true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<select");
    expect(html).toContain("Hide legend");
    expect(html).toContain("Show as table");
  });

  it("is not drawn while the statistics are hidden (layer view, close-up)", () => {
    expect(render(true, { hidden: true })).toBe("");
  });
});
