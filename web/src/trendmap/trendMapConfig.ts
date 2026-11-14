// Everything a team member may want to tune about the global trend map lives
// here: which variables are offered, the colour ramps, how the colour range is
// chosen and how strongly cells that are not significant are faded.

export type Rgb = readonly [number, number, number];

// Diverging ramps from falling (first stop) through neutral to rising (last
// stop). Both are ColorBrewer 7-class schemes, chosen because they stay
// distinguishable with red-green colour blindness.
export const PALETTES = {
  // RdBu reversed: blue = falling, red = rising.
  "blue-red": [
    [33, 102, 172],
    [103, 169, 207],
    [209, 229, 240],
    [247, 247, 247],
    [253, 219, 199],
    [239, 138, 98],
    [178, 24, 43],
  ],
  // BrBG: brown = falling, teal = rising.
  "brown-teal": [
    [140, 81, 10],
    [216, 179, 101],
    [246, 232, 195],
    [245, 245, 245],
    [199, 234, 229],
    [90, 180, 172],
    [1, 102, 94],
  ],
} as const satisfies Record<string, readonly Rgb[]>;

export type PaletteId = keyof typeof PALETTES;

export type TrendMapVariable = {
  // Folder name under data/grid/.
  id: string;
  // Name in the selector: `name_en` of data/grid/<id>/meta.json, which ends
  // with the product, so the three temperature variables can be told apart.
  // The legend title reads the same field from the file.
  label: string;
  palette: PaletteId;
  // Optional display conversion of the slope: shown value = stored value ×
  // factor, labelled with `unit`. Without it the unit of the file is shown
  // (K differences are labelled °C).
  display?: { factor: number; unit: string; note: string };
};

// The order here is the order of the selector.
export const TREND_MAP_VARIABLES: TrendMapVariable[] = [
  {
    id: "imerg_precip",
    label: "Precipitation (GPM IMERG Final)",
    palette: "brown-teal",
  },
  {
    id: "gldas_tair",
    label: "Near-surface air temperature (GLDAS Noah)",
    palette: "blue-red",
  },
  {
    id: "gldas_evap",
    label: "Evapotranspiration (GLDAS Noah)",
    palette: "brown-teal",
    display: {
      factor: 86400,
      unit: "mm/day",
      note: "Shown as mm/day (kg m-2 s-1 × 86,400).",
    },
  },
  {
    id: "gldas_soilmoist",
    label: "Soil moisture 0-10 cm (GLDAS Noah)",
    palette: "brown-teal",
  },
  {
    id: "airs_tsurf",
    label: "Surface air temperature (AIRS)",
    palette: "blue-red",
  },
  {
    id: "airs_h2ovap",
    label: "Total column water vapor (AIRS)",
    palette: "brown-teal",
  },
  {
    id: "merra2_t2m",
    label: "2 m air temperature (MERRA-2)",
    palette: "blue-red",
  },
];

// The colour range is symmetric, ±L, where L is this quantile of the absolute
// slopes of the analysed cells (cells are counted equally, not by area), so a
// few extreme cells do not flatten the rest of the map. Slopes beyond ±L get
// the end colours.
export const RANGE_QUANTILE = 0.98;

// Opacity of a cell by significance class, before the overlay opacity.
// Classes "not significant" and "significant only before FDR correction" are
// drawn the same way.
export const SIGNIFICANT_ALPHA = 1;
export const NOT_SIGNIFICANT_ALPHA = 0.28;

// Colour strength by size of the trend: a cell's opacity is multiplied by a
// factor that runs from this value at zero change to 1 at ±L and beyond. The
// middle of both ramps is near-white, and the renderer blends in linear light
// (measured in #81: a white cell at opacity 0.4 over dark ocean came out at
// about 185 of 255, where blending the sRGB values would give about 120), so
// without this the pale cells of variables that have a value everywhere hide
// the land. Applied equally to significant and not significant cells, so a
// significant cell is always 1 / NOT_SIGNIFICANT_ALPHA times as opaque as a
// not significant cell with the same trend. Above 0 so that an analysed cell
// with no change is still drawn, unlike a cell with no data.
export const ZERO_CHANGE_STRENGTH = 0.4;

// Overlay opacity: the starting value and the range of the slider. At 0.4
// the coastlines of the surface image still show through variables that have
// a value in every cell (IMERG, AIRS, MERRA-2) and the colours stay readable.
export const DEFAULT_OVERLAY_OPACITY = 0.4;
export const MIN_OVERLAY_OPACITY = 0.2;

// Radius of the overlay shell; the Earth surface is 1 and the closer Taiwan
// image sits at 1.004.
export const OVERLAY_RADIUS = 1.006;

export function trendMapVariable(id: string | null): TrendMapVariable | null {
  return TREND_MAP_VARIABLES.find((item) => item.id === id) ?? null;
}
