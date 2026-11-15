import { describe, expect, it } from "vitest";
import {
  NO_VIEW,
  chartIdOf,
  chooseView,
  choiceOf,
  closeUpIdOf,
  initialLeftView,
  leftContent,
  withChart,
  withCloseUp,
} from "./leftView";

const chart = { kind: "chart", id: "gldas_tair" } as const;
const closeup = { kind: "closeup", id: "imerg_precip" } as const;

describe("the left view is one slot", () => {
  it("opening the chart replaces a close-up, and the other way round", () => {
    expect(withChart(closeup, "gldas_tair")).toEqual(chart);
    expect(withCloseUp(chart, "imerg_precip")).toEqual(closeup);
  });

  it("closing the chart leaves a close-up alone, and the other way round", () => {
    expect(withChart(chart, null)).toEqual(NO_VIEW);
    expect(withChart(closeup, null)).toEqual(closeup);
    expect(withCloseUp(closeup, null)).toEqual(NO_VIEW);
    expect(withCloseUp(chart, null)).toEqual(chart);
  });

  it("holds a chart or a close-up, never both", () => {
    for (const view of [NO_VIEW, chart, closeup]) {
      expect(
        [chartIdOf(view), closeUpIdOf(view)].filter(Boolean).length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("takes the close-up when the address gives both", () => {
    expect(initialLeftView("gldas_tair", "imerg_precip")).toEqual(closeup);
    expect(initialLeftView("gldas_tair", null)).toEqual(chart);
    expect(initialLeftView(null, null)).toEqual(NO_VIEW);
  });
});

describe("the radio group of a layer", () => {
  it("is off for every layer but the one in the slot", () => {
    expect(choiceOf(chart, "gldas_tair")).toBe("chart");
    expect(choiceOf(chart, "imerg_precip")).toBe("off");
    expect(choiceOf(closeup, "imerg_precip")).toBe("closeup");
    expect(choiceOf(NO_VIEW, "imerg_precip")).toBe("off");
  });

  it("choosing in one layer takes the slot from another", () => {
    const next = chooseView(chart, "imerg_precip", "closeup");
    expect(next).toEqual(closeup);
    expect(choiceOf(next, "gldas_tair")).toBe("off");
  });

  it("'Off' empties the slot only for the layer that holds it", () => {
    expect(chooseView(chart, "gldas_tair", "off")).toEqual(NO_VIEW);
    expect(chooseView(chart, "imerg_precip", "off")).toEqual(chart);
  });

  it("switches between the two views of one layer", () => {
    expect(chooseView(chart, "gldas_tair", "closeup")).toEqual({
      kind: "closeup",
      id: "gldas_tair",
    });
  });
});

describe("what the left side shows", () => {
  const base = {
    view: NO_VIEW,
    guideOpen: false,
    tourActive: false,
    strataOn: false,
  };

  it("shows the legends when nothing is open", () => {
    expect(leftContent(base)).toEqual({ primary: "none", legends: "full" });
  });

  it("shows the start card in place of the legends", () => {
    expect(leftContent({ ...base, guideOpen: true })).toEqual({
      primary: "guide",
      legends: "hidden",
    });
  });

  it("a chart leaves a short window of legends; a close-up takes the room", () => {
    expect(leftContent({ ...base, view: chart })).toEqual({
      primary: "chart",
      legends: "compact",
    });
    expect(leftContent({ ...base, view: closeup })).toEqual({
      primary: "closeup",
      legends: "hidden",
    });
  });

  it("a view gives way to nothing but the tour and the layer view", () => {
    expect(leftContent({ ...base, view: chart, guideOpen: true }).primary).toBe(
      "chart",
    );
    expect(leftContent({ ...base, view: chart, tourActive: true })).toEqual({
      primary: "none",
      legends: "hidden",
    });
    expect(leftContent({ ...base, view: closeup, strataOn: true })).toEqual({
      primary: "none",
      legends: "hidden",
    });
    expect(leftContent({ ...base, view: chart, strataOn: true }).primary).toBe(
      "chart",
    );
  });
});
