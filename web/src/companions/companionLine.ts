// The one sentence a companion says. A template filled with numbers: the
// variable, the place, the month, the value, how far it is from the mean of
// the same calendar month, the change per decade and whether it is
// significant, the known-problem caution if there is one, and what kind of
// data it is.
//
// RULE: facts only. No cause, no conclusion, no feeling. Do not add words
// such as "because", "due to", "worrying" or "healthy" here; the reading of
// the numbers belongs to the team, not to this code.
import { DATA_KIND_LABELS, type DataKind } from "../analysis/modelVsObs";
import {
  deltaUnit,
  formatChangePerDecade,
  significanceText,
  type TrendEntry,
} from "../analysis/trends";
import { formatMeasurement } from "../snapshot/reading";

const MONTH_NAMES = [
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
];

// "2024-06-01" -> { name: "June", label: "June 2024" }.
export function monthLabel(month: string): { name: string; label: string } {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7);
  return { name, label: `${name} ${month.slice(0, 4)}` };
}

export type CompanionLineInput = {
  // The variable's English name, e.g. "Precipitation".
  variableName: string;
  place: string;
  // "YYYY-MM" or "YYYY-MM-DD"; null when no month is selected.
  month: string | null;
  // Raw value in `unit`; null for a month without data.
  value: number | null;
  unit: string;
  // Against the mean of the same calendar month; null when not computed.
  anomaly?: {
    difference: number;
    mean: number;
    firstYear: string;
    lastYear: string;
  } | null;
  trend?: TrendEntry;
  alpha?: number;
  // The always-shown caution sentence of a known problem.
  caveatSummary?: string | null;
  dataKind?: DataKind;
};

// A difference in the series' unit: 1 K of difference is 1 °C, and the sign
// is said in words, so the number is shown unsigned.
export function formatDifference(difference: number, unit: string): string {
  const size = Math.abs(difference);
  if (deltaUnit(unit) === "°C") return `${size.toFixed(1)} °C`;
  return formatMeasurement(size, unit);
}

export function companionLine(input: CompanionLineInput): string {
  const where = `${input.variableName} at ${input.place}`;
  if (!input.month) return `${where}: no month selected.`;
  const { name, label } = monthLabel(input.month);
  const parts: string[] = [];
  if (input.value === null) {
    parts.push(`${where}, ${label}: no data for this month.`);
  } else {
    parts.push(
      `${where}, ${label}: ${formatMeasurement(input.value, input.unit)}.`,
    );
    const anomaly = input.anomaly;
    if (anomaly) {
      const size = formatDifference(anomaly.difference, input.unit);
      const usual = formatMeasurement(anomaly.mean, input.unit);
      const record = `${anomaly.firstYear} to ${anomaly.lastYear}`;
      const zero = formatDifference(0, input.unit);
      parts.push(
        size === zero
          ? `That equals the ${name} mean of this record (${usual}, ${record}).`
          : `That is ${size} ${anomaly.difference > 0 ? "above" : "below"} the ${name} mean of this record (${usual}, ${record}).`,
      );
    }
  }
  const trend = input.trend;
  if (trend?.status === "analyzed") {
    parts.push(
      `Trend ${trend.data.first_month.slice(0, 7)} to ${trend.data.last_month.slice(0, 7)}: ` +
        `${formatChangePerDecade(trend.ols.slope_per_decade, trend.ols.ci_per_decade, trend.unit, input.alpha)}, ` +
        `${significanceText(trend.ols)}.`,
    );
  } else if (trend?.status === "insufficient") {
    parts.push(`Trend not analyzed: ${trend.reason.text_en}`);
  }
  if (input.caveatSummary) parts.push(input.caveatSummary);
  if (input.dataKind && input.dataKind !== "unknown") {
    parts.push(`Data kind: ${DATA_KIND_LABELS[input.dataKind].toLowerCase()}.`);
  }
  return parts.join(" ");
}

const SPOKEN: [RegExp, string][] = [
  [/°C/g, "degrees Celsius"],
  [/NO₂|NO2/g, "N O 2"],
  [/⁻²/g, " to the minus 2"],
  [/⁻¹/g, " to the minus 1"],
  [/(\d)e([+-]?\d+)/g, "$1 times ten to the $2"],
  [/95% CI/g, "95 percent confidence interval"],
  [/\bFDR\b/g, "F D R"],
  [/ · /g, ", "],
];

// The same sentence with symbols spelled out for the browser's voice. It
// changes how the text is read aloud, never what it says.
export function spokenLine(line: string): string {
  return SPOKEN.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    line,
  );
}
