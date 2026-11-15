// Which result is drawn on the globe. One choice: nothing, the trend at every
// place, model against station, or the places that move alike.

export type GlobeMode = "none" | "trend" | "gap" | "alike";

// What a visitor sees with no ?globe=. The trend at every place is the most
// basic picture of the question ("where is it changing?").
export const DEFAULT_GLOBE_STATS: GlobeMode = "trend";

export const GLOBE_MODE_IDS: GlobeMode[] = ["none", "trend", "gap", "alike"];

// ?globe=trend|gap|alike|none. Anything else (or no parameter) is the default.
export function parseGlobeParam(raw: string | null): GlobeMode {
  if (raw === "none" || raw === "trend" || raw === "gap" || raw === "alike") {
    return raw;
  }
  return DEFAULT_GLOBE_STATS;
}
