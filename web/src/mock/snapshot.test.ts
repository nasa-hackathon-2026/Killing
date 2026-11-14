import { describe, expect, it } from "vitest";
import {
  mockLocations,
  mockNormalized,
  mockVariables,
  type ColorFamily,
} from "./snapshot";

const colorFamilies: Record<string, ColorFamily> = {
  imerg_precip: "water",
  gldas_soilmoist: "water",
  gldas_evap: "water",
  airs_h2ovap: "water",
  gldas_tair: "warm",
  airs_tsurf: "warm",
  merra2_t2m: "warm",
  modis_lst: "warm",
  omi_no2: "gas",
  omi_o3: "gas",
  omi_aerosol: "aerosol",
  modis_ndvi: "vegetation",
};

const glassColors: Record<string, string> = {
  imerg_precip: "#8ec8ff",
  gldas_soilmoist: "#2f6fad",
  gldas_evap: "#5aa3c4",
  airs_h2ovap: "#b9d7f5",
  gldas_tair: "#ff8a3d",
  airs_tsurf: "#ff6a3d",
  merra2_t2m: "#ffb020",
  modis_lst: "#e85d4c",
  omi_no2: "#a86832",
  omi_o3: "#c4a574",
  omi_aerosol: "#9a948c",
  modis_ndvi: "#2f9e57",
};

describe("mockNormalized", () => {
  it("stays inside 0 to 1 and does not change between calls", () => {
    const first = mockNormalized("imerg_precip", "taichung");
    const second = mockNormalized("imerg_precip", "taichung");
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it("uses the common color of each material family", () => {
    expect(mockVariables).toHaveLength(Object.keys(colorFamilies).length);
    for (const variable of mockVariables) {
      expect(variable.colorFamily).toBe(colorFamilies[variable.id]);
      expect(variable.glassColor).toBe(glassColors[variable.id]);
    }
  });

  it("gives every variable a value at every location", () => {
    for (const variable of mockVariables) {
      for (const location of mockLocations) {
        const value = mockNormalized(variable.id, location.id);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});
