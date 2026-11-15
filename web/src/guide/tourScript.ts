// THE TOUR SCRIPT. The guided tour is data: a list of steps, each naming
// who speaks, what is said (message keys, or which template sentences of a
// companion), and the state the page is put in (globe or layer view, which
// stratum is expanded, which layer is switched on). The page applies a step
// with the state and actions it already has; nothing here draws anything.
//
// The middle of the tour follows the layer view's strata from top to bottom
// (strata/strataSpec.ts), one step per stratum. Wording is in the message
// files: `guide.tour.*` for the fixed lines, `companions.say.*` for the
// template sentences filled with the place's numbers.
import { strata, strataAssignment, type StratumId } from "../strata/strataSpec";

// The companion that leads the opening and closing steps.
export const TOUR_GUIDE = "imerg_precip";

// Which companion speaks on each stratum (one of the variables drawn there).
export const STRATUM_SPEAKER: Record<StratumId, string> = {
  stratosphere: "omi_o3",
  "troposphere-air": "omi_no2",
  "troposphere-water": "imerg_precip",
  "near-surface": "merra2_t2m",
  "land-surface": "modis_ndvi",
  "top-soil": "gldas_soilmoist",
};

// The template sentences a companion can say (companionLine.ts).
export type TourLine = "who" | "now" | "trend";

export type TourStep = {
  id: string;
  // Variable id of the companion that speaks.
  speaker: string;
  // Fixed lines: message keys.
  messages: string[];
  // Template sentences of the speaker, said after the fixed lines.
  lines: TourLine[];
  // The state the page is in during this step.
  view: "globe" | "strata";
  // The stratum expanded in the layer view (null: none).
  stratum: StratumId | null;
  // A layer switched on for this step (it stays on until the tour ends).
  layer: string | null;
};

function fixed(id: string, view: TourStep["view"]): TourStep {
  return {
    id,
    speaker: TOUR_GUIDE,
    messages: [`guide.tour.${id}`],
    lines: [],
    view,
    stratum: null,
    layer: null,
  };
}

export const TOUR_STEPS: TourStep[] = [
  fixed("welcome", "globe"),
  fixed("place", "globe"),
  fixed("particles", "globe"),
  fixed("enter", "strata"),
  ...strata.map((item): TourStep => ({
    id: `stratum:${item.id}`,
    speaker: STRATUM_SPEAKER[item.id],
    messages: [],
    lines: ["who", "now", "trend"],
    view: "strata",
    stratum: item.id,
    layer: STRATUM_SPEAKER[item.id],
  })),
  fixed("trendMap", "globe"),
  fixed("research", "globe"),
];

// The layers a step needs on: every layer the tour has switched on so far.
export function tourLayers(stepIndex: number): string[] {
  return TOUR_STEPS.slice(0, stepIndex + 1)
    .map((step) => step.layer)
    .filter((id): id is string => id !== null);
}

// True when every speaker stands on the stratum of its step.
export function speakersMatchStrata(): boolean {
  return strata.every(
    (item) => strataAssignment(STRATUM_SPEAKER[item.id])?.stratum === item.id,
  );
}
