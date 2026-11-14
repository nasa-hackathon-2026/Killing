import { describe, expect, it } from "vitest";
import { TREND_MAP_VARIABLES } from "../trendmap/trendMapConfig";
import { TREND_CAVEATS, trendCaveat } from "./trendCaveats";

describe("trendCaveat", () => {
  it("flags the GLDAS air temperature trend with its sources", () => {
    const caveat = trendCaveat("gldas_tair");
    expect(caveat?.summary).toContain("should not be read as a climate signal");
    expect(caveat?.details).toContain("July 2017");
    expect(caveat?.sources).toContain("GLDAS-2 README");
  });

  it("flags the GLDAS evapotranspiration step of 2024–2025 with its sources", () => {
    const caveat = trendCaveat("gldas_evap");
    expect(caveat?.details).toContain("July 2024 to May 2025");
    expect(caveat?.sources).toContain("FLDAS README");
  });

  // Numbers from docs/data/gldas-water-check.md (#79).
  it("flags that GLDAS and FLDAS soil moisture trends have opposite signs, without calling either wrong", () => {
    const caveat = trendCaveat("gldas_soilmoist");
    expect(caveat?.summary).toContain("disagree on the sign");
    expect(caveat?.details).toContain("−0.43 kg m⁻² per decade");
    expect(caveat?.details).toContain("+0.16 in FLDAS");
    expect(caveat?.details).toContain("correlate at only 0.08");
    expect(caveat?.details).toContain("cannot tell which");
    expect(caveat?.details).toContain("No clear step");
    expect(caveat?.sources).toContain("FLDAS README");
    expect(caveat?.sources).toContain("#79");
  });

  it("keeps the always-visible part to one sentence that starts with Caution", () => {
    for (const caveat of Object.values(TREND_CAVEATS)) {
      expect(caveat.summary.startsWith("Caution: ")).toBe(true);
      expect(caveat.summary.match(/\./g)).toHaveLength(1);
      expect(caveat.summary.length).toBeLessThan(120);
      expect(caveat.details.length).toBeGreaterThan(0);
      expect(caveat.sources.length).toBeGreaterThan(0);
    }
  });

  it("returns null for variables without a checked problem", () => {
    expect(trendCaveat("merra2_t2m")).toBeNull();
  });

  it("only names variables the trend map knows", () => {
    const ids = TREND_MAP_VARIABLES.map((item) => item.id);
    for (const id of Object.keys(TREND_CAVEATS)) expect(ids).toContain(id);
  });
});
