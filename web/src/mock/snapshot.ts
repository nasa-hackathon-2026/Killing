export type MockLocation = {
  id: string;
  nameEn: string;
  lat: number;
  lon: number;
};

export const mockLocations: MockLocation[] = [
  { id: "taichung", nameEn: "Taichung", lat: 24.15, lon: 120.68 },
  { id: "taipei", nameEn: "Taipei", lat: 25.03, lon: 121.56 },
  { id: "kaohsiung", nameEn: "Kaohsiung", lat: 22.63, lon: 120.3 },
  { id: "hualien", nameEn: "Hualien", lat: 23.99, lon: 121.6 },
  { id: "yushan", nameEn: "Yushan", lat: 23.47, lon: 120.95 },
];

export const taiwanOverview = { lat: 23.7, lon: 121.0 };

export type ParticleMotion = "fall" | "drift";

export type ColorFamily = "water" | "warm" | "gas" | "aerosol" | "vegetation";

export type FormId = "water-droplet" | "round-air";

export type MockVariable = {
  id: string;
  nameEn: string;
  glassColor: string;
  particleColor: string;
  motion: ParticleMotion;
  colorFamily: ColorFamily;
  formId: FormId | null;
};

export const mockVariables: MockVariable[] = [
  {
    id: "imerg_precip",
    nameEn: "Precipitation",
    glassColor: "#8ec8ff",
    particleColor: "#8ec8ff",
    motion: "fall",
    colorFamily: "water",
    formId: "water-droplet",
  },
  {
    id: "gldas_tair",
    nameEn: "Near-surface air temperature",
    glassColor: "#ff8a3d",
    particleColor: "#ffd8bf",
    motion: "drift",
    colorFamily: "warm",
    formId: null,
  },
  {
    id: "gldas_soilmoist",
    nameEn: "Surface soil moisture",
    glassColor: "#2f6fad",
    particleColor: "#d5e6f7",
    motion: "drift",
    colorFamily: "water",
    formId: null,
  },
  {
    id: "gldas_evap",
    nameEn: "Evapotranspiration",
    glassColor: "#5aa3c4",
    particleColor: "#e5f6fb",
    motion: "drift",
    colorFamily: "water",
    formId: null,
  },
  {
    id: "airs_tsurf",
    nameEn: "Surface air temperature",
    glassColor: "#ff6a3d",
    particleColor: "#ffd0c4",
    motion: "drift",
    colorFamily: "warm",
    formId: null,
  },
  {
    id: "airs_h2ovap",
    nameEn: "Total water vapor",
    glassColor: "#b9d7f5",
    particleColor: "#f3f8ff",
    motion: "drift",
    colorFamily: "water",
    formId: null,
  },
  {
    id: "merra2_t2m",
    nameEn: "2 m air temperature",
    glassColor: "#ffb020",
    particleColor: "#ffe8bf",
    motion: "drift",
    colorFamily: "warm",
    formId: null,
  },
  {
    id: "omi_no2",
    nameEn: "Tropospheric NO2",
    glassColor: "#a86832",
    particleColor: "#e0b080",
    motion: "drift",
    colorFamily: "gas",
    formId: "round-air",
  },
  {
    id: "omi_o3",
    nameEn: "Total ozone",
    glassColor: "#c4a574",
    particleColor: "#f0e0cc",
    motion: "drift",
    colorFamily: "gas",
    formId: null,
  },
  {
    id: "omi_aerosol",
    nameEn: "UV aerosol index",
    glassColor: "#9a948c",
    particleColor: "#ece8e3",
    motion: "drift",
    colorFamily: "aerosol",
    formId: null,
  },
  {
    id: "modis_ndvi",
    nameEn: "Vegetation greenness",
    glassColor: "#2f9e57",
    particleColor: "#d9f5e4",
    motion: "drift",
    colorFamily: "vegetation",
    formId: null,
  },
  {
    id: "modis_lst",
    nameEn: "Land surface temperature",
    glassColor: "#e85d4c",
    particleColor: "#ffd2cb",
    motion: "drift",
    colorFamily: "warm",
    formId: null,
  },
];

export function mockNormalized(variableId: string, locationId: string): number {
  let hash = 2166136261;
  const text = `${variableId}:${locationId}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}
