import { describe, expect, it } from "vitest";
import { strata } from "../strata/strataSpec";
import { hasMessage } from "../i18n";
import { TOUR_STEPS, speakersMatchStrata, tourLayers } from "./tourScript";

describe("companion tour", () => {
  it("visits every stratum once from top to bottom", () => {
    expect(
      TOUR_STEPS.filter((step) => step.stratum).map((step) => step.stratum),
    ).toEqual(strata.map((stratum) => stratum.id));
    expect(speakersMatchStrata()).toBe(true);
  });

  it("uses existing messages and keeps a visited layer visible", () => {
    for (const step of TOUR_STEPS) {
      for (const key of step.messages) expect(hasMessage(key)).toBe(true);
    }
    const lastLayerStep = TOUR_STEPS.map(
      (step) => step.layer !== null,
    ).lastIndexOf(true);
    expect(tourLayers(lastLayerStep)).toHaveLength(strata.length);
  });
});
