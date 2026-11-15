// The one sentence a companion says. A template filled with numbers: the
// variable, the place, the month, the value, how far it is from the mean of
// the same calendar month, the change per decade and whether it is
// significant, the known-problem caution if there is one, and what kind of
// data it is.
//
// RULE: facts only. No cause, no conclusion, no feeling. Do not add words
// such as "because", "due to", "worrying" or "healthy" here; the reading of
// the numbers belongs to the team, not to this code.
import type { DataKind } from "../analysis/modelVsObs";
import {
  deltaUnit,
  formatChangePerDecade,
  formatSlope,
  significanceOutcome,
  significanceText,
  type TrendEntry,
} from "../analysis/trends";
import {
  getLocale,
  getVoice,
  localNumber,
  monthName,
  monthYear,
  t,
  type Locale,
  type Voice,
} from "../i18n";
import { formatMeasurement } from "../snapshot/reading";

// "2024-06-01" -> { name: "June", label: "June 2024" } in the active
// language.
export function monthLabel(
  month: string,
  formatLocale: Locale = getLocale(),
): { name: string; label: string } {
  return {
    name: monthName(month, "long", formatLocale),
    label: monthYear(month, "long", formatLocale),
  };
}

export type CompanionLineInput = {
  // The variable's name in the active language, e.g. "Precipitation".
  variableName: string;
  place: string;
  // "YYYY-MM" or "YYYY-MM-DD"; null when no month is selected.
  month: string | null;
  formatLocale?: Locale;
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
  // Set for a significant trend of a series with a documented issue that
  // affects trends: the clause that follows "This trend is not reliable as a
  // climate signal:" (TrendCaveat.reason). It replaces the caution sentence.
  unreliableReason?: string | null;
  dataKind?: DataKind;
};

// A difference in the series' unit: 1 K of difference is 1 °C, and the sign
// is said in words, so the number is shown unsigned.
export function formatDifference(difference: number, unit: string): string {
  const size = Math.abs(difference);
  if (deltaUnit(unit) === "°C") return `${localNumber(size.toFixed(1))} °C`;
  return formatMeasurement(size, unit);
}

// The full sentence with the statistical terms (expert voice).
export function companionLine(input: CompanionLineInput): string {
  return companionLineParts(input).join(" ");
}

function companionLineParts(input: CompanionLineInput): string[] {
  const who = { name: input.variableName, place: input.place };
  if (!input.month) return [t("companions.line.noMonth", who)];
  const { name, label } = monthLabel(input.month, input.formatLocale);
  const parts: string[] = [];
  if (input.value === null) {
    parts.push(t("companions.line.noData", { ...who, month: label }));
  } else {
    parts.push(
      t("companions.line.value", {
        ...who,
        month: label,
        value: formatMeasurement(input.value, input.unit),
      }),
    );
    const anomaly = input.anomaly;
    if (anomaly) {
      const size = formatDifference(anomaly.difference, input.unit);
      const zero = formatDifference(0, input.unit);
      parts.push(
        t(
          `companions.line.${size === zero ? "equal" : anomaly.difference > 0 ? "above" : "below"}`,
          {
            size,
            monthName: name,
            usual: formatMeasurement(anomaly.mean, input.unit),
            first: anomaly.firstYear,
            last: anomaly.lastYear,
          },
        ),
      );
    }
  }
  const trend = input.trend;
  if (trend?.status === "analyzed") {
    parts.push(
      t("companions.line.trend", {
        first: trend.data.first_month.slice(0, 7),
        last: trend.data.last_month.slice(0, 7),
        change: formatChangePerDecade(
          trend.ols.slope_per_decade,
          trend.ols.ci_per_decade,
          trend.unit,
          input.alpha,
        ),
        significance: significanceText(trend.ols),
      }),
    );
  } else if (trend?.status === "insufficient") {
    parts.push(
      t("companions.line.notAnalyzed", { reason: trend.reason.text_en }),
    );
  }
  if (trend?.status === "analyzed" && input.unreliableReason) {
    parts.push(t("caveats.unreliable", { reason: input.unreliableReason }));
  } else if (input.caveatSummary) parts.push(input.caveatSummary);
  if (input.dataKind && input.dataKind !== "unknown") {
    parts.push(t(`common.dataKind.${input.dataKind}.expert`));
  }
  return parts;
}

// ---- Plain short sentences (general voice) --------------------------------
// The same facts, one short sentence each, so a companion can say them one
// at a time: what it is, what it reads now, whether it has changed and
// whether that number can be trusted, and what kind of data it is.

export type CompanionSayInput = CompanionLineInput & {
  // The companion's own name ("Rain").
  companionName: string;
  // The variable's one-sentence definition (general voice).
  definition?: string | null;
};

export type CompanionSentences = {
  who: string;
  now: string;
  // Null when there is no trend result.
  trend: string | null;
  kind: string | null;
};

export function companionSentences(
  input: CompanionSayInput,
): CompanionSentences {
  const who = t("companions.say.who", {
    name: input.companionName,
    definition: input.definition ?? input.variableName,
  });
  let now: string;
  if (!input.month) {
    now = t("companions.say.noMonth");
  } else {
    const { name, label } = monthLabel(input.month, input.formatLocale);
    if (input.value === null) {
      now = t("companions.say.noData", { place: input.place, month: label });
    } else {
      now = t("companions.say.value", {
        place: input.place,
        month: label,
        value: formatMeasurement(input.value, input.unit),
      });
      const anomaly = input.anomaly;
      if (anomaly) {
        const size = formatDifference(anomaly.difference, input.unit);
        const zero = formatDifference(0, input.unit);
        now += ` ${t(
          `companions.say.${size === zero ? "equal" : anomaly.difference > 0 ? "above" : "below"}`,
          { size, monthName: name },
        )}`;
      }
    }
  }
  let trend: string | null = null;
  const entry = input.trend;
  if (entry?.status === "insufficient") {
    trend = t("companions.say.insufficient");
  } else if (entry?.status === "analyzed") {
    const outcome = significanceOutcome(entry.ols, !!input.unreliableReason);
    const rising = entry.ols.slope_per_decade > 0;
    const year = entry.data.first_month.slice(0, 4);
    const size = (sign: boolean) =>
      formatSlope(
        entry.ols.slope_per_decade,
        entry.ols.ci_per_decade,
        entry.unit,
        sign,
      );
    if (outcome === "unreliableFdr" || outcome === "unreliableRawOnly") {
      trend = t("companions.say.unreliable", {
        year,
        change: size(true),
        reason: input.unreliableReason ?? t("caveats.genericReason"),
      });
    } else if (outcome === "fdr" || outcome === "rawOnly") {
      trend = t(
        `companions.say.${rising ? "rising" : "falling"}${outcome === "rawOnly" ? "RawOnly" : ""}`,
        { year, change: size(false) },
      );
    } else if (outcome === "notSignificant") {
      trend = t("companions.say.notSignificant", { year });
    }
  }
  const kind =
    input.dataKind && input.dataKind !== "unknown"
      ? t(`common.dataKind.${input.dataKind}.general`)
      : null;
  return { who, now, trend, kind };
}

// What a companion says when asked for its numbers: the expert sentence, or
// the plain ones in a row.
export function companionSpeech(
  input: CompanionSayInput,
  voice: Voice = getVoice(),
): string {
  return companionSpeechParts(input, voice).join(" ");
}

export function companionSpeechParts(
  input: CompanionSayInput,
  voice: Voice = getVoice(),
): string[] {
  if (voice === "expert") return companionLineParts(input);
  const say = companionSentences(input);
  return [say.now, say.trend, say.kind].filter(
    (part): part is string => !!part,
  );
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
  // The replacements are English words; other languages are read as written.
  if (getLocale() !== "en") return line.replace(/ · /g, ", ");
  return SPOKEN.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    line,
  );
}
