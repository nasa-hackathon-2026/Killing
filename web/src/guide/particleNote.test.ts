import { describe, expect, it } from "vitest";
import { particleNote } from "./particleNote";

describe("particleNote", () => {
  it("names the one layer, the place and the month", () => {
    expect(
      particleNote({
        layerNames: ["Precipitation"],
        place: "Taichung",
        month: "2025-06-01",
        trendMap: false,
      }),
    ).toBe(
      "Particles show one value: Precipitation at Taichung, Jun 2025. They are not a map.",
    );
  });

  it("says the selected layers when several are on", () => {
    expect(
      particleNote({
        layerNames: ["Precipitation", "2 m air temperature"],
        place: "Tokyo",
        month: "2024-12",
        trendMap: false,
      }),
    ).toBe(
      "Particles show one value per layer: the selected layers at Tokyo, Dec 2024. They are not a map.",
    );
  });

  it("tells the trend map apart from the particles when it is open", () => {
    expect(
      particleNote({
        layerNames: ["2 m air temperature"],
        place: "Taichung",
        month: "2025-06",
        trendMap: true,
      }),
    ).toBe(
      "Particles show one value: 2 m air temperature at Taichung, Jun 2025. They are not a map. " +
        "The coloured map is a map: per-grid-cell trend.",
    );
  });

  it("leaves the month out when none is selected and says nothing without layers", () => {
    expect(
      particleNote({
        layerNames: ["Precipitation"],
        place: "Taichung",
        month: null,
        trendMap: false,
      }),
    ).toBe(
      "Particles show one value: Precipitation at Taichung. They are not a map.",
    );
    expect(
      particleNote({
        layerNames: [],
        place: "Taichung",
        month: "2025-06",
        trendMap: true,
      }),
    ).toBeNull();
  });
});
