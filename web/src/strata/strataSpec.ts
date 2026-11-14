// THE STRATA TABLE of the layer view: which platform ("stratum") each layer
// variable is drawn on, top to bottom, and which processes cross from one
// stratum to another. Change a row here to move a variable; the test checks
// that every layer variable sits on exactly one stratum.
//
// Heights are common, rounded ranges and only given where they are certain;
// `heightEn: null` means no number is shown. The platforms are NOT drawn to
// scale (the legend says so).

export type StratumId =
  | "stratosphere"
  | "troposphere-air"
  | "troposphere-water"
  | "near-surface"
  | "land-surface"
  | "top-soil";

export type Stratum = {
  id: StratumId;
  nameEn: string;
  // Rough real height range, or null when no number is shown.
  heightEn: string | null;
  // Tint of the platform and of the label's edge.
  color: string;
};

// Top of the atmosphere first, soil last.
export const strata: Stratum[] = [
  {
    id: "stratosphere",
    nameEn: "Stratosphere",
    heightEn: "roughly 15–50 km up",
    color: "#c4a574",
  },
  {
    id: "troposphere-air",
    nameEn: "Troposphere: gases and aerosols",
    heightEn: "ground to roughly 10–15 km",
    color: "#a8a29a",
  },
  {
    id: "troposphere-water",
    nameEn: "Troposphere: water vapor and rain",
    heightEn: "ground to roughly 10–15 km",
    color: "#8ec8ff",
  },
  {
    id: "near-surface",
    nameEn: "Near-surface air",
    heightEn: "about 2 m above the ground",
    color: "#ffb020",
  },
  {
    id: "land-surface",
    nameEn: "Land surface",
    heightEn: null,
    color: "#2f9e57",
  },
  {
    id: "top-soil",
    nameEn: "Top soil",
    heightEn: "0–10 cm below the ground",
    color: "#2f6fad",
  },
];

export type StrataAssignment = {
  variableId: string;
  // The one stratum the variable belongs to (where its label, its companion
  // and the start of its particles are).
  stratum: StratumId;
  // A process that crosses strata: the particles travel from `stratum` to
  // this one (rain falls to the land surface, evapotranspiration rises).
  flowsTo?: StratumId;
  // True for a total over the whole air column; it is drawn in the stratum
  // where most of the gas sits.
  columnTotal?: boolean;
};

export const strataAssignments: StrataAssignment[] = [
  { variableId: "omi_o3", stratum: "stratosphere", columnTotal: true },
  { variableId: "omi_no2", stratum: "troposphere-air", columnTotal: true },
  { variableId: "omi_aerosol", stratum: "troposphere-air" },
  {
    variableId: "airs_h2ovap",
    stratum: "troposphere-water",
    columnTotal: true,
  },
  {
    variableId: "imerg_precip",
    stratum: "troposphere-water",
    flowsTo: "land-surface",
  },
  { variableId: "gldas_tair", stratum: "near-surface" },
  { variableId: "airs_tsurf", stratum: "near-surface" },
  { variableId: "merra2_t2m", stratum: "near-surface" },
  { variableId: "modis_lst", stratum: "land-surface" },
  { variableId: "modis_ndvi", stratum: "land-surface" },
  {
    variableId: "gldas_evap",
    stratum: "land-surface",
    flowsTo: "near-surface",
  },
  { variableId: "gldas_soilmoist", stratum: "top-soil" },
];

export function strataAssignment(
  variableId: string,
): StrataAssignment | undefined {
  return strataAssignments.find((row) => row.variableId === variableId);
}

export function stratum(id: StratumId): Stratum | undefined {
  return strata.find((item) => item.id === id);
}

// Variables of one stratum, in table order.
export function variablesOf(id: StratumId): string[] {
  return strataAssignments
    .filter((row) => row.stratum === id)
    .map((row) => row.variableId);
}

// Shown in the legend of the layer view. Method notes only, no conclusions.
export const STRATA_NOTES = [
  "Heights are not to scale.",
  "Column totals are shown in the layer where most of the gas sits.",
  "Flow directions are illustrative; there is no wind data.",
] as const;

export const COLUMN_TOTAL_NOTE =
  "A total over the whole air column, shown in the layer where most of the gas sits.";

export function flowNote(from: StratumId, to: StratumId): string {
  const a = stratum(from)?.nameEn ?? from;
  const b = stratum(to)?.nameEn ?? to;
  return `Particles travel from "${a}" to "${b}"; the path is illustrative.`;
}
