import { describe, expect, it } from "vitest";
import { formMapping } from "../forms/formMapping";
import type { SeriesPoint } from "../snapshot/reading";
import {
  BODY_SCALE,
  BREATH_LIMITS,
  companionDrive,
  companionReading,
  MIN_CLIMATOLOGY_YEARS,
  monthlyAnomaly,
  SPEED_RANGE,
  moodFor,
  MOOD_THRESHOLD_Z,
} from "./companionData";

function junes(values: (number | null)[]): SeriesPoint[] {
  return values.flatMap((value, index) => [
    { month: `${2001 + index}-06-01`, value },
    { month: `${2001 + index}-12-01`, value: 100 },
  ]);
}

describe("moodFor", () => {
  it("has three levels around the threshold", () => {
    expect(moodFor(MOOD_THRESHOLD_Z)).toBe("above");
    expect(moodFor(-MOOD_THRESHOLD_Z)).toBe("below");
    expect(moodFor(0.49)).toBe("near");
    expect(moodFor(-0.49)).toBe("near");
  });

  it("reads an unknown anomaly as near usual", () => {
    expect(moodFor(null)).toBe("near");
    expect(moodFor(undefined)).toBe("near");
    expect(moodFor(Number.NaN)).toBe("near");
  });
});

describe("monthlyAnomaly", () => {
  it("compares with the same calendar month only", () => {
    const points = junes([1, 2, 3, 4, 5]);
    const anomaly = monthlyAnomaly(points, "2005-06-01");
    expect(anomaly?.mean).toBe(3);
    expect(anomaly?.difference).toBe(2);
    expect(anomaly?.z).toBeCloseTo(2 / Math.sqrt(2.5), 10);
    expect(anomaly?.years).toBe(5);
    expect(anomaly?.firstYear).toBe("2001");
    expect(anomaly?.lastYear).toBe("2005");
  });

  it("skips missing years and needs enough of them", () => {
    expect(monthlyAnomaly(junes([1, null, 3, 4, 5]), "2005-06-01")).toBeNull();
    expect(MIN_CLIMATOLOGY_YEARS).toBe(5);
    expect(
      monthlyAnomaly(junes([1, null, 3, 4, 5, 6]), "2006-06-01")?.years,
    ).toBe(5);
  });

  it("is null for a month without a value", () => {
    expect(monthlyAnomaly(junes([1, 2, 3, 4, 5, null]), "2006-06-01")).toBe(
      null,
    );
    expect(monthlyAnomaly(junes([1, 2, 3, 4, 5]), "1999-06-01")).toBeNull();
  });

  it("has no z when every year is the same", () => {
    const anomaly = monthlyAnomaly(junes([2, 2, 2, 2, 2]), "2003-06-01");
    expect(anomaly?.difference).toBe(0);
    expect(anomaly?.z).toBeNull();
  });
});

describe("companionDrive", () => {
  it("scales the body between the series' minimum and maximum", () => {
    expect(companionDrive("imerg_precip", 0).scale).toBe(BODY_SCALE[0]);
    expect(companionDrive("imerg_precip", 1).scale).toBe(BODY_SCALE[1]);
    expect(companionDrive("imerg_precip", 5).scale).toBe(BODY_SCALE[1]);
    expect(companionDrive("imerg_precip", null).amount).toBe(0);
  });

  it("breathes faster when the particles move faster", () => {
    for (const id of ["gldas_tair", "gldas_evap", "omi_o3", "modis_ndvi"]) {
      expect(companionDrive(id, 1).period).toBeLessThan(
        companionDrive(id, 0).period,
      );
    }
  });

  it("keeps the period inside its limits", () => {
    for (const id of ["imerg_precip", "gldas_tair", "omi_o3", "unknown"]) {
      for (const value of [0, 0.5, 1]) {
        const { period } = companionDrive(id, value);
        expect(period).toBeGreaterThanOrEqual(BREATH_LIMITS[0]);
        expect(period).toBeLessThanOrEqual(BREATH_LIMITS[1]);
      }
    }
  });
});

describe("SPEED_RANGE", () => {
  it("covers every row of the mapping table", () => {
    const speeds = formMapping.flatMap((row) => row.encoding.speed);
    expect(Math.min(...speeds)).toBe(SPEED_RANGE[0]);
    expect(Math.max(...speeds)).toBe(SPEED_RANGE[1]);
  });
});

describe("companionReading", () => {
  const series = { unit: "K", points: junes([290, 291, 292, 293, 299]) };

  it("joins value, anomaly, posture, trend mark and caution", () => {
    const reading = companionReading(
      "gldas_tair",
      series,
      "2005-06-01",
      undefined,
    );
    expect(reading.raw).toBe(299);
    expect(reading.value).toBe(1);
    expect(reading.mood).toBe("above");
    expect(reading.signal.state).toBe("unavailable");
    expect(reading.caveat?.summary).toMatch(/^Caution:/);
  });

  it("is empty for a month without data or a missing series", () => {
    const empty = companionReading("omi_o3", series, "1990-06-01", undefined);
    expect(empty.raw).toBeNull();
    expect(empty.value).toBeNull();
    expect(empty.mood).toBe("near");
    expect(empty.caveat).toBeNull();
    expect(companionReading("omi_o3", undefined, null, undefined).value).toBe(
      null,
    );
  });
});
