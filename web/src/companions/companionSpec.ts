// THE COMPANION TABLE. One row per core layer variable: which original
// character stands for it, what it is called, and where it stands. The
// characters are drawn by code in Companion.tsx; nothing here refers to an
// image file.
//
// Names are the plain English word for the form (Rain, Vapor, Leaf ...).
// Colors are not a new palette: `baseColor` is the same color the particles
// of that layer use (formColor over src/mock/snapshot.ts).
import type { DataKind } from "../analysis/modelVsObs";
import { formColor } from "../forms/formColor";
import { formSpec } from "../forms/formMapping";
import { mockVariables } from "../mock/snapshot";

export type CompanionKind =
  "water" | "vapor" | "gas" | "energy" | "plant" | "soil" | "aerosol";

// Where the companion stands when several are shown together.
export type CompanionLayer = "sky" | "air" | "surface" | "ground";

export type CompanionSpec = {
  // The variable id, e.g. "imerg_precip".
  id: string;
  // The character's name: the form itself, in English.
  name: string;
  // Tells apart companions that share a body (the four temperatures).
  tag: string | null;
  kind: CompanionKind;
  // Body variant within a kind; see Companion.tsx.
  variant: "column" | "rising" | "NO2" | "O3" | "air" | "land" | null;
  baseColor: string;
  // The variable's other existing color, used for accents.
  accentColor: string;
  layer: CompanionLayer;
  // Larger is higher. Follows the middle of the layer's particle band in
  // formMapping.ts (tested); equal bands are ordered by hand.
  altitudeOrder: number;
  // In situ / satellite retrieval / model, as in data/analysis/cleaning.json
  // (`data_kinds.variables`).
  dataKind: DataKind;
  // The variable's English name, as in the layer panel.
  variableName: string;
};

type Row = Pick<
  CompanionSpec,
  "id" | "name" | "tag" | "kind" | "variant" | "layer" | "dataKind"
> & { tieBreak?: number };

const ROWS: Row[] = [
  {
    id: "omi_o3",
    name: "Ozone",
    tag: null,
    kind: "gas",
    variant: "O3",
    layer: "sky",
    dataKind: "satellite_retrieval",
  },
  {
    id: "omi_no2",
    name: "NO₂",
    tag: null,
    kind: "gas",
    variant: "NO2",
    layer: "air",
    dataKind: "satellite_retrieval",
  },
  {
    id: "airs_h2ovap",
    name: "Vapor",
    tag: null,
    kind: "vapor",
    variant: "column",
    layer: "air",
    dataKind: "satellite_retrieval",
    // Same band middle as precipitation; vapor is listed above rain.
    tieBreak: 1,
  },
  {
    id: "imerg_precip",
    name: "Rain",
    tag: null,
    kind: "water",
    variant: null,
    layer: "air",
    dataKind: "satellite_retrieval",
  },
  {
    id: "omi_aerosol",
    name: "Haze",
    tag: null,
    kind: "aerosol",
    variant: null,
    layer: "air",
    dataKind: "satellite_retrieval",
  },
  {
    id: "merra2_t2m",
    name: "Warmth",
    tag: "MERRA-2",
    kind: "energy",
    variant: "air",
    layer: "air",
    dataKind: "model",
  },
  {
    id: "airs_tsurf",
    name: "Warmth",
    tag: "AIRS",
    kind: "energy",
    variant: "air",
    layer: "air",
    dataKind: "satellite_retrieval",
  },
  {
    id: "gldas_tair",
    name: "Warmth",
    tag: "GLDAS",
    kind: "energy",
    variant: "air",
    layer: "air",
    dataKind: "model",
  },
  {
    id: "gldas_evap",
    name: "Evaporation",
    tag: null,
    kind: "vapor",
    variant: "rising",
    layer: "surface",
    dataKind: "model",
  },
  {
    id: "modis_ndvi",
    name: "Leaf",
    tag: null,
    kind: "plant",
    variant: null,
    layer: "surface",
    dataKind: "satellite_retrieval",
  },
  {
    id: "modis_lst",
    name: "Ground heat",
    tag: "MODIS",
    kind: "energy",
    variant: "land",
    layer: "surface",
    dataKind: "satellite_retrieval",
  },
  {
    id: "gldas_soilmoist",
    name: "Soil",
    tag: null,
    kind: "soil",
    variant: null,
    layer: "ground",
    dataKind: "model",
  },
];

// Middle of the particle band, in thousandths of an Earth radius above the
// surface, plus the hand-set tie break.
export function bandAltitude(variableId: string): number {
  const band = formSpec(variableId)?.band;
  if (!band) return 0;
  return Math.round(((band[0] + band[1]) / 2 - 1) * 1000);
}

export const COMPANIONS: CompanionSpec[] = ROWS.map((row) => {
  const variable = mockVariables.find((item) => item.id === row.id);
  const colors = variable ?? {
    glassColor: "#9aa7b8",
    particleColor: "#9aa7b8",
  };
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    kind: row.kind,
    variant: row.variant,
    baseColor: formColor(colors),
    accentColor: colors.particleColor,
    layer: row.layer,
    altitudeOrder: bandAltitude(row.id) + (row.tieBreak ?? 0),
    dataKind: row.dataKind,
    variableName: variable?.nameEn ?? row.id,
  };
});

export function companionFor(variableId: string): CompanionSpec | undefined {
  return COMPANIONS.find((item) => item.id === variableId);
}

// "Warmth · AIRS" for companions that share a body, else just the name.
export function companionTitle(spec: CompanionSpec): string {
  return spec.tag ? `${spec.name} · ${spec.tag}` : spec.name;
}

// Highest first; equal heights keep the table order.
export function byAltitude(ids: string[]): CompanionSpec[] {
  return ids
    .map((id) => companionFor(id))
    .filter((spec): spec is CompanionSpec => spec !== undefined)
    .sort((a, b) => b.altitudeOrder - a.altitudeOrder);
}

// Short label under a companion's feet.
export const DATA_KIND_SHORT: Record<DataKind, string> = {
  in_situ: "In situ",
  satellite_retrieval: "Satellite",
  model: "Model",
  unknown: "Unclassified",
};
