// Everything a team member may want to tune about the global distribution
// (the field of glowing dots drawn from data/grid/<id>/monthly_climatology.i16)
// lives here. The pure functions that use these numbers are in fieldMapping.ts.

// Which variable the control starts on: null = off, "auto" = follow the time
// series chart (or the first open layer that has a grid), or a variable id.
// Off until the team lead has seen the screenshots and picks one.
export const DEFAULT_FIELD: FieldMode = null;

export type FieldMode = null | "auto" | string;

export type FieldVariable = {
  // Folder name under data/grid/ and the layer id in layers/registry.ts.
  id: string;
  // Exponent on the normalised value before it becomes density and
  // brightness: below 1 lifts the middle of the range (useful for skewed
  // fields such as rain), 1 is linear.
  gamma: number;
  // Optional display conversion of the values in the legend: shown value =
  // stored value × factor + offset, labelled with `unit`.
  display?: { factor: number; offset: number; unit: string };
};

// The variables with a global grid, in the order of the selector. Layers not
// listed here have no global grid (see fieldText.unavailable).
const CELSIUS = { factor: 1, offset: -273.15, unit: "°C" };

export const FIELD_VARIABLES: FieldVariable[] = [
  {
    id: "imerg_precip",
    gamma: 0.6,
    display: { factor: 24, offset: 0, unit: "mm/day" },
  },
  { id: "gldas_tair", gamma: 1, display: CELSIUS },
  {
    id: "gldas_evap",
    gamma: 0.8,
    display: { factor: 86400, offset: 0, unit: "mm/day" },
  },
  { id: "gldas_soilmoist", gamma: 1 },
  { id: "airs_tsurf", gamma: 1, display: CELSIUS },
  { id: "airs_h2ovap", gamma: 0.9 },
  { id: "merra2_t2m", gamma: 1, display: CELSIUS },
];

export function fieldVariable(id: string | null): FieldVariable | undefined {
  return FIELD_VARIABLES.find((variable) => variable.id === id);
}

// Robust range: the low and high quantiles of all valid cells over all 12
// months (cells equally weighted). One range per variable, so the seasons can
// be compared.
export const RANGE_LOW_QUANTILE = 0.02;
export const RANGE_HIGH_QUANTILE = 0.98;

// Cells with data but a value at or below the low end still get this much
// density, so "low" (a few faint dots) differs from "no data" (none).
export const LEVEL_FLOOR = 0.04;

// Width of the soft edge of each dot's threshold: when the month moves, dots
// fade in and out over this much of the level instead of popping.
export const THRESHOLD_SOFTNESS = 0.08;

// Brightness of a visible dot at the lowest and highest level.
export const MIN_BRIGHTNESS = 0.35;
export const MAX_BRIGHTNESS = 1;
// Share of white mixed into the colour of the densest, brightest dots.
export const HOT_WHITE = 0.35;

// Upper bound on the number of dots (all candidates, lit or not). Phones and
// small screens use the low cap.
export const FIELD_POINT_CAP = 26000;
export const FIELD_POINT_CAP_LOW = 10000;
// Candidates that land on a cell with no data are dropped; give up after
// this many attempts per dot (a grid with very little data then gets fewer).
export const MAX_ATTEMPTS_PER_POINT = 12;

// Radius of the shell the dots lie on (Earth = 1). Just above the trend map
// overlay (1.006), well below the place's particles (1.045 and up).
export const FIELD_RADIUS = 1.009;
// Diameter of one dot's glow, in Earth radii, and its random spread.
export const DOT_SIZE = 0.012;
export const DOT_SIZE_SPREAD = 0.35;

// Twinkle: brightness wobble (share of brightness) and its speed range in
// radians per second. Off with prefers-reduced-motion. No drift: there is no
// wind data, so dots stay where they are.
export const TWINKLE_AMOUNT = 0.22;
export const TWINKLE_SPEED: readonly [number, number] = [0.4, 1.3];

// Hybrid view: by camera distance from the Earth's centre. At FAR and beyond
// the distribution is at full strength and the place's particles are faded
// to LOCAL_FAR_STRENGTH; at NEAR and closer the distribution is at
// FIELD_NEAR_STRENGTH and the particles are full. Smooth in between.
export const BLEND_FAR_DISTANCE = 2.6;
export const BLEND_NEAR_DISTANCE = 1.6;
export const FIELD_NEAR_STRENGTH = 0.1;
export const LOCAL_FAR_STRENGTH = 0.3;

// The dots are part of the trend map (#197) and coloured by its trend. Their
// brightness is scaled by this; 1 = as bright as the dots were on their own.
// A dot on a cell that is not significant or barely changes is dimmed to no
// less than DOT_TREND_DIM_FLOOR of that, so every dot stays easy to see.
export const WITH_TREND_MAP_STRENGTH = 0.7;
export const DOT_TREND_DIM_FLOOR = 0.5;

// How fast the shown calendar month follows the timeline, in months per
// second at playing speed 1 (scaled by the playing speed).
export const MONTH_FOLLOW_RATE = 3;
