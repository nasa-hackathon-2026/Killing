// Every user-visible string of the global distribution (web/src/fields), in
// one object so it can be moved into the site's translations in one place.
// Facts only: variable, unit, range, period, method. No reading of the map.

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const fieldText = {
  controlLabel: "Global distribution",
  off: "Distribution: off",
  auto: "Follow chart / layers",
  // Option text of a layer with no global grid; the reason is its title.
  unavailable: (name: string) => `${name} (no global grid)`,
  unavailableReason:
    "No global grid in this site for this variable: only the 7 variables with files in data/grid/ can be drawn as a distribution.",
  autoNothing:
    "Follow chart / layers: no open layer or chart variable has a global grid.",
  loading: "Loading the global distribution…",
  error: "Could not read the global distribution.",
  // Short line on the collapsed legend and in the particle note.
  typical: (month: string) => `Typical ${month}`,
  period: (start: number, end: number) => `mean of ${start}–${end}`,
  legendToggle: "Legend",
  low: "low",
  high: "high",
  densityCaption: "Dot density and brightness",
  notThisMonth: "Typical month, not this exact month.",
  method: (start: number, end: number) =>
    `Each calendar month is the mean of that month over ${start}–${end} (monthly climatology on a 1° grid). Dot density and brightness follow the value between the 2nd and 98th percentiles of all 12 months; no dots where there is no data.`,
  noWind: "No wind data: motion is not transport.",
  withTrendMap:
    "The trend map remains underneath; distribution dots are dimmed.",
  dataKind: (kind: string) => `Data: ${kind}.`,
  // The sentence added to the line under the timeline.
  particleNote: (month: string, variable: string) =>
    `The glowing dots are a map: typical ${month} ${variable}.`,
} as const;
