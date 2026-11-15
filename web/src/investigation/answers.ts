// The one-sentence answer at the top of each tab, built from the data and
// the existing trend rules (trendSignal, significanceOutcome). It states
// results only: no causes, and "not significant" is never "no change".
import { trendLabel, trendSignal, type TrendSignal } from "../forms/encoding";
import {
  significanceOutcome,
  trendKey,
  type TrendEntry,
  type TrendsFile,
} from "../analysis/trends";
import { localNumber, t, tm } from "../i18n";
import type { Place } from "../snapshot/places";
import { formatP } from "../timeline/seriesMath";
import { formatChange, formatTotal, recordYears } from "./format";
import type { TabId } from "./logic";

type WhereCounts = {
  total: number;
  up: number;
  down: number;
  flat: number;
  bad: number;
};

// How the places with this variable split by the panel's own marks.
export function whereCounts(
  variableId: string,
  places: Place[],
  trends: TrendsFile | null,
): WhereCounts {
  const counts = { total: 0, up: 0, down: 0, flat: 0, bad: 0 };
  for (const place of places) {
    const entry =
      trends?.series[trendKey(variableId, place.id, place.aggregation)];
    if (!entry) continue;
    counts.total += 1;
    const signal = trendSignal(entry, trends?.known_issues);
    if (signal.unreliable) counts.bad += 1;
    else if (signal.state === "rising") counts.up += 1;
    else if (signal.state === "falling") counts.down += 1;
    else counts.flat += 1;
  }
  return counts;
}

export function answerFor(
  tab: TabId,
  input: {
    variableName: string;
    locationName: string;
    trend: TrendEntry | undefined;
    signal: TrendSignal;
    alpha: number;
    hasSeries: boolean;
    whereCounts: WhereCounts;
    voice: "general" | "expert";
  },
): string {
  const { trend, signal, voice } = input;
  const label = trendLabel(signal, voice);
  if (tab === "where") {
    return tm("investigation.answer.where", {
      label,
      ...input.whereCounts,
      alpha: localNumber(String(input.alpha)),
    });
  }
  if (!input.hasSeries) {
    return t("investigation.answer.noSeries", { place: input.locationName });
  }
  if (!trend) return t("investigation.answer.noTrend");
  if (trend.status === "insufficient") {
    return t("investigation.answer.notAnalyzed", {
      reason: trend.reason.text_en,
    });
  }
  const first = trend.data.first_month.slice(0, 7);
  const last = trend.data.last_month.slice(0, 7);
  if (tab === "what") {
    return t("investigation.answer.what", {
      name: input.variableName,
      place: input.locationName,
      first,
      last,
      label,
    });
  }
  if (tab === "howmuch") {
    const text = tm("investigation.answer.howmuch", {
      slope: formatChange(trend, false),
      change: formatChange(trend, true, input.alpha),
      total: formatTotal(trend),
      years: recordYears(trend),
    });
    return input.signal.unreliable
      ? `${text} ${tm("investigation.answer.unreliableSuffix")}`
      : text;
  }
  const outcome = significanceOutcome(trend.ols, input.signal.unreliable);
  return tm(`investigation.answer.significant.${outcome}`, {
    p: withOperator(trend.ols.p),
    q: withOperator(trend.ols.p_fdr),
  });
}

// "= 0.012" or "< 0.001", so a sentence reads "p = 0.012" and "p < 0.001".
export function withOperator(p: number | null): string {
  const text = formatP(p);
  return p !== null && p < 0.001 ? text : `= ${text}`;
}
