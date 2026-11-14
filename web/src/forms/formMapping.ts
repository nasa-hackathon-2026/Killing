// THE MAPPING TABLE. One row per variable: which form it uses far away, how
// the particles move, what the close-up shows, and how the normalized value
// (0 = this series' own minimum, 1 = its own maximum) becomes count, size and
// speed. These are implementation defaults; the team can change any row.
//
// Colors are not repeated here: `glassColor` and `particleColor` stay in
// src/mock/snapshot.ts, and `formId` there must match this table (tested).
//
// There is no wind data in this project. Every direction of flow below is
// illustrative only.
import type { CloseUpId } from "../closeup/closeUps";
import type { FormId } from "../mock/snapshot";
import type { EncodingSpec } from "./encoding";
import type { MotionKind } from "./motions";

export type VariableFormSpec = {
  variableId: string;
  formId: FormId;
  motion: MotionKind;
  // Inner and outer radius of the band the particles occupy (Earth = 1).
  band: [number, number];
  encoding: EncodingSpec;
  closeUpId: CloseUpId;
  // "legacy": drawn by a component that predates this table and keeps its own
  // numbers (the row describes them but does not drive them).
  engine: "field" | "legacy";
  note: string;
};

const LEGACY_ENCODING: EncodingSpec = {
  maxCount: 480,
  size: [0.85, 1.4],
  speed: [0.04, 1],
  speedLaw: "linear",
};

export const formMapping: VariableFormSpec[] = [
  {
    variableId: "imerg_precip",
    formId: "water-droplet",
    motion: "fall",
    band: [1.06, 1.3],
    encoding: LEGACY_ENCODING,
    closeUpId: "water-precipitation",
    engine: "legacy",
    note: "Teardrops fall towards the surface; more, larger and faster with more precipitation.",
  },
  {
    variableId: "gldas_tair",
    formId: "thermal-motion",
    motion: "jitter",
    band: [1.05, 1.11],
    encoding: {
      maxCount: 360,
      size: [0.8, 1.15],
      speed: [0.5, 3],
      speedLaw: "sqrt",
    },
    closeUpId: "thermal-air",
    engine: "field",
    note: "Points shake in place; warmer months shake faster (speed follows a square root, exaggerated).",
  },
  {
    variableId: "gldas_soilmoist",
    formId: "soil-water",
    motion: "seep",
    band: [1.022, 1.03],
    encoding: {
      maxCount: 320,
      size: [0.6, 1.5],
      speed: [0.3, 1.2],
      speedLaw: "linear",
    },
    closeUpId: "soil-pores",
    engine: "field",
    note: "Flat lenses lie on the surface and swell slowly; wetter months show more and larger lenses.",
  },
  {
    variableId: "gldas_evap",
    formId: "water-vapor",
    motion: "rise",
    band: [1.03, 1.2],
    encoding: {
      maxCount: 360,
      size: [0.8, 1.2],
      speed: [0.15, 1],
      speedLaw: "linear",
    },
    closeUpId: "water-evaporation",
    engine: "field",
    note: "Water molecules leave the surface and rise; a larger flux means more of them, rising faster.",
  },
  {
    variableId: "airs_tsurf",
    formId: "thermal-motion",
    motion: "jitter",
    band: [1.07, 1.14],
    encoding: {
      maxCount: 360,
      size: [0.8, 1.15],
      speed: [0.5, 3],
      speedLaw: "sqrt",
    },
    closeUpId: "thermal-air",
    engine: "field",
    note: "Same form as the other air temperatures; a different height band and color.",
  },
  {
    variableId: "airs_h2ovap",
    formId: "water-vapor",
    motion: "orbit",
    band: [1.1, 1.26],
    encoding: {
      maxCount: 420,
      size: [0.8, 1.25],
      speed: [0.2, 0.6],
      speedLaw: "linear",
    },
    closeUpId: "water-vapor",
    engine: "field",
    note: "Water molecules drift through the whole column; more column water vapor means more of them.",
  },
  {
    variableId: "merra2_t2m",
    formId: "thermal-motion",
    motion: "jitter",
    band: [1.09, 1.16],
    encoding: {
      maxCount: 360,
      size: [0.8, 1.15],
      speed: [0.5, 3],
      speedLaw: "sqrt",
    },
    closeUpId: "thermal-air",
    engine: "field",
    note: "Same form as the other air temperatures; a different height band and color.",
  },
  {
    variableId: "omi_no2",
    formId: "round-air",
    motion: "orbit",
    band: [1.12, 1.3],
    encoding: { ...LEGACY_ENCODING, size: [0.75, 1.45] },
    closeUpId: "no2-photolysis",
    engine: "legacy",
    note: "Round particles circle the globe; more, larger and faster with a larger NO2 column.",
  },
  {
    variableId: "omi_o3",
    formId: "ozone-molecule",
    motion: "orbit",
    band: [1.26, 1.36],
    encoding: {
      maxCount: 300,
      size: [0.85, 1.25],
      speed: [0.1, 0.35],
      speedLaw: "linear",
    },
    closeUpId: "ozone-chapman",
    engine: "field",
    note: "Bent three-atom molecules in a high band (most ozone is in the stratosphere), drifting slowly.",
  },
  {
    variableId: "omi_aerosol",
    formId: "aerosol-grain",
    motion: "tumble",
    band: [1.08, 1.24],
    encoding: {
      maxCount: 300,
      size: [0.7, 1.5],
      speed: [0.15, 0.7],
      speedLaw: "linear",
    },
    closeUpId: "aerosol-scale",
    engine: "field",
    note: "Irregular grains of very different sizes tumble and drift; a higher index means more and larger grains.",
  },
  {
    variableId: "modis_ndvi",
    formId: "leaf",
    motion: "sway",
    band: [1.03, 1.045],
    encoding: {
      maxCount: 320,
      size: [0.6, 1.4],
      speed: [0.4, 1],
      speedLaw: "linear",
    },
    closeUpId: "photosynthesis",
    engine: "field",
    note: "Leaves lie just above the surface and sway in place; greener months show more and larger leaves.",
  },
  {
    variableId: "modis_lst",
    formId: "thermal-motion",
    motion: "jitter",
    band: [1.02, 1.035],
    encoding: {
      maxCount: 360,
      size: [0.8, 1.15],
      speed: [0.5, 3],
      speedLaw: "sqrt",
    },
    closeUpId: "thermal-surface",
    engine: "field",
    note: "Same shaking points, held against the surface because this is the temperature of the ground itself.",
  },
];

export function formSpec(variableId: string): VariableFormSpec | undefined {
  return formMapping.find((row) => row.variableId === variableId);
}

// Upper bound on instances if every layer is switched on at full value.
export const TOTAL_PARTICLE_CAP = formMapping.reduce(
  (sum, row) => sum + row.encoding.maxCount,
  0,
);
