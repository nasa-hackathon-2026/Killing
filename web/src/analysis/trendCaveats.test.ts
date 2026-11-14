import { describe, expect, it } from "vitest";
import { TREND_MAP_VARIABLES } from "../trendmap/trendMapConfig";
import { TREND_CAVEATS, trendCaveat } from "./trendCaveats";

describe("trendCaveat", () => {
  it("flags the GLDAS air temperature trend with its sources", () => {
    const caveat = trendCaveat("gldas_tair");
    expect(caveat?.text).toContain("should not be read as a climate signal");
    expect(caveat?.sources).toContain("GLDAS-2 README");
  });

  it("returns null for variables without a checked problem", () => {
    expect(trendCaveat("merra2_t2m")).toBeNull();
  });

  it("only names variables the trend map knows", () => {
    const ids = TREND_MAP_VARIABLES.map((item) => item.id);
    for (const id of Object.keys(TREND_CAVEATS)) expect(ids).toContain(id);
  });
});
