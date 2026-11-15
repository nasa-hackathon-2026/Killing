// Which result is drawn on the globe. One choice: nothing, the trend at every
// place, model against station, or the places that move alike.

export type GlobeMode = "none" | "trend" | "gap" | "alike";

// What a visitor sees with no ?globe=. The trend at every place is the most
// basic picture of the question ("where is it changing?").
export const DEFAULT_GLOBE_STATS: GlobeMode = "trend";

// The modes offered in the selector. "alike" is left out: its arcs mostly
// join a place to other variables at the same place, or to Taiwan places a
// few pixels away, so nothing is visible from the global view. The code
// stays; ?globe=alike falls back to the default.
export const GLOBE_MODE_IDS: GlobeMode[] = ["none", "trend", "gap"];

// ?globe=trend|gap|none. Anything else (or no parameter) is the default.
export function parseGlobeParam(raw: string | null): GlobeMode {
  if (raw === "none" || raw === "trend" || raw === "gap") {
    return raw;
  }
  return DEFAULT_GLOBE_STATS;
}
