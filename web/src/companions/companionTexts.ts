// Each companion's reading of the month and its sentence of data facts, for
// the companion panel and the layer view alike (one source for both).
import { trendKey, type TrendsFile } from "../analysis/trends";
import { t, type Locale, type Voice } from "../i18n";
import { variableDefinition } from "../i18n/names";
import type { LoadedSeries } from "../snapshot/loadSnapshot";
import { companionReading, type CompanionReading } from "./companionData";
import { companionSpeechParts } from "./companionLine";
import { COMPANIONS, companionName, companionVariable } from "./companionSpec";

export type CompanionTextsInput = {
  series: LoadedSeries[];
  month: string | null;
  locationId: string;
  locationName: string;
  aggregation: string;
  trends: TrendsFile | null;
  voice: Voice;
  // Locale for the numbers in the spoken sentence (the language of the
  // companion text that is actually shown); the displayed parts use the
  // interface's own formatting.
  speechLocale?: Locale;
};

export type CompanionTexts = {
  readings: Record<string, CompanionReading>;
  // The sentence in parts (the panel shows them as separate lines) and
  // joined for speech.
  displayParts: Record<string, string[]>;
  lines: Record<string, string>;
};

export function companionTexts({
  series,
  month,
  locationId,
  locationName,
  aggregation,
  trends,
  voice,
  speechLocale,
}: CompanionTextsInput): CompanionTexts {
  const readings: Record<string, CompanionReading> = {};
  const lines: Record<string, string> = {};
  const displayParts: Record<string, string[]> = {};
  for (const spec of COMPANIONS) {
    const found = series.find((item) => item.variableId === spec.id);
    const trend = trends?.series[trendKey(spec.id, locationId, aggregation)];
    const reading = companionReading(
      spec.id,
      found,
      month,
      trend,
      trends?.known_issues,
    );
    readings[spec.id] = reading;
    const lineInput = {
      companionName: companionName(spec),
      definition: variableDefinition(spec.id, "general"),
      variableName: companionVariable(spec),
      place: locationName,
      month,
      value: reading.raw,
      unit: reading.unit,
      anomaly: reading.anomaly,
      trend,
      alpha: trends?.parameters.alpha,
      caveatSummary: reading.caveat?.summary,
      unreliableReason: reading.signal.unreliable
        ? (reading.caveat?.reason ?? t("caveats.genericReason"))
        : null,
      dataKind: spec.dataKind,
    };
    displayParts[spec.id] = companionSpeechParts(lineInput, voice);
    lines[spec.id] = companionSpeechParts(
      { ...lineInput, formatLocale: speechLocale },
      voice,
    ).join(" ");
  }
  return { readings, displayParts, lines };
}
