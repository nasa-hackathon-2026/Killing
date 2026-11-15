import { describe, expect, it } from "vitest";
import { DEFAULT_GLOBE_STATS, parseGlobeParam } from "./globeStatsMode";

describe("globe statistics mode", () => {
  it("defaults to the trend view and accepts the explicit none choice", () => {
    expect(parseGlobeParam(null)).toBe(DEFAULT_GLOBE_STATS);
    expect(DEFAULT_GLOBE_STATS).toBe("trend");
    expect(parseGlobeParam("none")).toBe("none");
  });

  it("accepts each named data view and falls back on unknown parameters", () => {
    expect(parseGlobeParam("trend")).toBe("trend");
    expect(parseGlobeParam("gap")).toBe("gap");
    expect(parseGlobeParam("alike")).toBe("alike");
    expect(parseGlobeParam("unknown")).toBe("trend");
  });
});
