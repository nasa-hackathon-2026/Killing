// The investigation panel: what the Chart button (or ?chart=) opens. Four
// numbered tabs follow the four questions of the challenge; each starts
// with a one-sentence answer generated from the data and the existing
// trend rules (trendSignal, trendReliability), then a chart. Statistics are
// read from trends.json only.
import * as Tabs from "@radix-ui/react-tabs";
import { useMemo, type ReactNode } from "react";
import { trendSignal, type TrendSignal } from "../forms/encoding";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import { trendCaveat } from "../analysis/trendCaveats";
import { trendUnreliable } from "../analysis/trendReliability";
import { trendKey, type TrendEntry, type TrendsFile } from "../analysis/trends";
import { useAnalysisFile } from "../analysis/useAnalysisFile";
import { compareLinksFor, loadModelVsObs } from "../analysis/modelVsObs";
import { carryChoices, t, tm, useI18n } from "../i18n";
import { variableDefinition } from "../i18n/names";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import type { LoadedSeries } from "../snapshot/loadSnapshot";
import type { Place } from "../snapshot/places";
import {
  alignAnomalies,
  alignCoverage,
  alignValues,
  calendarAnomalies,
  displayValue,
  type AnomalySeries,
} from "../timeline/seriesMath";
import { useTimeline } from "../timeline/TimelineContext";
import { loadPanelFacts } from "./data";
import { TABS, type TabId } from "./logic";
import { QuestionGroups, WhatTab } from "./WhatTab";
import { WhereTab } from "./WhereTab";
import { HowMuchTab } from "./HowMuchTab";
import { SignificantTab } from "./SignificantTab";
import { answerFor, whereCounts } from "./answers";
import "./investigation.css";

export type InvestigationPanelProps = {
  variableId: string;
  variableName: string;
  locationId: string;
  locationName: string;
  aggregation: string;
  series: LoadedSeries | null;
  // Every series' anomalies (core and world subset), by trend key.
  anomalies: Record<string, AnomalySeries> | null;
  trends: TrendsFile | null;
  breaks: string[];
  similarHref?: string;
  places: Place[];
  variables: { id: string; nameEn: string }[];
  tab: TabId;
  onTab: (tab: TabId) => void;
  wide: boolean;
  onWide: (wide: boolean) => void;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  onSelectVariable: (id: string) => void;
  onSelectLocation?: (id: string) => void;
  onClose: () => void;
};

// Everything the tabs read about the charted series, computed once.
export type SeriesModel = {
  key: string;
  unit: string;
  months: string[];
  // Values in display units (K shown as °C), raw values, anomalies.
  values: (number | null)[];
  raw: (number | null)[];
  anomalies: (number | null)[];
  coverage: (number | null)[];
  trend: TrendEntry | undefined;
  signal: TrendSignal;
  unreliable: boolean;
  alpha: number;
};

export function InvestigationPanel(props: InvestigationPanelProps) {
  const {
    variableId,
    variableName,
    locationId,
    locationName,
    aggregation,
    series,
    anomalies,
    trends,
    tab,
    onTab,
    wide,
    onWide,
    collapsed,
    onCollapsed,
    onClose,
  } = props;
  const { months } = useTimeline();
  const { voice } = useI18n();
  const facts = useAnalysisFile(loadPanelFacts);
  const pairs = useAnalysisFile(loadModelVsObs);

  const key = trendKey(variableId, locationId, aggregation);
  const model = useMemo<SeriesModel | null>(() => {
    if (!series || months.length < 2) return null;
    const raw = alignValues(series.points, months);
    const known = anomalies?.[key];
    const trend = trends?.series[key];
    return {
      key,
      unit: series.unit,
      months,
      raw,
      values: raw.map((value) => displayValue(value, series.unit)),
      anomalies: known
        ? alignAnomalies(known, months)
        : calendarAnomalies(raw, months),
      coverage: alignCoverage(series.points, months),
      trend,
      signal: trendSignal(trend, trends?.known_issues),
      unreliable: trendUnreliable(trend, trends?.known_issues),
      alpha: trends?.parameters.alpha ?? 0.05,
    };
  }, [series, months, anomalies, key, trends]);

  const trend = trends?.series[key];
  const answer = answerFor(tab, {
    variableName,
    locationName,
    trend,
    signal: trendSignal(trend, trends?.known_issues),
    alpha: trends?.parameters.alpha ?? 0.05,
    hasSeries: !!series,
    whereCounts: whereCounts(variableId, props.places, trends),
    voice,
  });

  const compare =
    pairs.status === "ready"
      ? compareLinksFor(
          pairs.data.pairs,
          locationId,
          `${import.meta.env.BASE_URL}compare/`,
        )[variableId]
      : undefined;

  const definition = variableDefinition(variableId, voice);
  const caveat = trendCaveat(variableId, voice);
  const signal = trendSignal(trend, trends?.known_issues);
  let body: ReactNode;
  if (tab === "where") {
    body = (
      <WhereTab
        variableId={variableId}
        locationId={locationId}
        places={props.places}
        anomalies={anomalies}
        trends={trends}
        onSelectLocation={props.onSelectLocation}
      />
    );
  } else if (!series || !model) {
    // The answer line already says there is no data; the groups offer
    // other variables to look at.
    body = (
      <QuestionGroups
        variableId={variableId}
        variables={props.variables}
        onSelectVariable={props.onSelectVariable}
      />
    );
  } else if (tab === "what") {
    body = (
      <WhatTab
        model={model}
        variableId={variableId}
        variableName={variableName}
        locationName={locationName}
        breaks={props.breaks}
        product={
          facts.status === "ready" ? facts.data.products[variableId] : undefined
        }
        variables={props.variables}
        onSelectVariable={props.onSelectVariable}
      />
    );
  } else if (tab === "howmuch") {
    body = (
      <HowMuchTab
        model={model}
        variableName={variableName}
        locationName={locationName}
        breaks={props.breaks}
      />
    );
  } else {
    body = (
      <SignificantTab
        model={model}
        variableId={variableId}
        variableName={variableName}
        locationName={locationName}
        family={
          facts.status === "ready"
            ? facts.data.worldKeys.has(key)
              ? { scope: "world", size: facts.data.familySizes.world }
              : { scope: "core", size: facts.data.familySizes.core }
            : null
        }
      />
    );
  }

  return (
    <section
      className={`timeline-chart investigation${
        collapsed ? " timeline-chart-collapsed" : ""
      }${wide ? " investigation-wide" : ""}`}
      aria-label={t("investigation.panel.aria", {
        name: variableName,
        place: locationName,
      })}
    >
      <header className="flex items-start gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-[15px] leading-tight font-semibold">
          {variableName}{" "}
          <span className="font-normal text-muted">
            {t("chart.at", { place: locationName })}
          </span>
        </h2>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Button
            variant={wide ? "pressed" : "outline"}
            className="investigation-expand whitespace-nowrap"
            aria-pressed={wide}
            aria-label={t("investigation.panel.expandAria")}
            onClick={() => onWide(!wide)}
          >
            {t(
              wide
                ? "investigation.panel.narrow"
                : "investigation.panel.expand",
            )}
          </Button>
          <Button
            className="whitespace-nowrap"
            aria-expanded={!collapsed}
            onClick={() => onCollapsed(!collapsed)}
          >
            {t(collapsed ? "chart.show" : "chart.hide")}
          </Button>
          <Button
            className="whitespace-nowrap"
            aria-label={t("chart.close")}
            onClick={onClose}
          >
            {t("common.action.close")}
          </Button>
        </div>
      </header>
      {collapsed ? null : (
        <>
          {definition ? (
            <p className="investigation-definition" title={definition}>
              <TrendMarkIcon signal={signal} /> {definition}
            </p>
          ) : null}
          <Tabs.Root value={tab} onValueChange={(next) => onTab(next as TabId)}>
            <Tabs.List
              aria-label={t("investigation.panel.tabsAria")}
              className="mt-2 mb-3 grid shrink-0 grid-cols-4 gap-1 rounded-lg border border-line bg-white/5 p-1"
            >
              {TABS.map((id, index) => (
                <Tabs.Trigger
                  key={id}
                  value={id}
                  title={t(`investigation.tabs.${id}.question`)}
                  className={cn(
                    "investigation-tab flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1 py-1.5 text-[11.5px] leading-none whitespace-nowrap text-muted",
                    "hover:text-ink data-[state=active]:border-accent-strong data-[state=active]:bg-accent-strong data-[state=active]:font-semibold data-[state=active]:text-on-accent",
                  )}
                >
                  <span className="investigation-tab-number grid size-[17px] flex-none place-items-center rounded-full border border-current text-[11px]">
                    {index + 1}
                  </span>
                  {t(`investigation.tabs.${id}.short`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content
              value={tab}
              className="min-h-0 flex-1 overflow-y-auto pr-1 outline-none [scrollbar-gutter:stable]"
            >
              <h3 className="investigation-question">
                {TABS.indexOf(tab) + 1}.{" "}
                {t(`investigation.tabs.${tab}.question`)}
              </h3>
              <p
                className={`investigation-answer${
                  signal.unreliable && tab !== "where"
                    ? " investigation-answer-unreliable"
                    : ""
                }`}
                aria-live="polite"
              >
                {answer}
              </p>
              {caveat && tab !== "significant" ? (
                <p className="trend-caveat-line" role="note">
                  {caveat.summary}
                </p>
              ) : null}
              {body}
              {compare || props.similarHref ? (
                <p className="timeline-chart-note investigation-links">
                  {compare ? (
                    <a href={carryChoices(compare.href)}>
                      {t(
                        compare.label === "Compare with station"
                          ? "layers.compareStation"
                          : "layers.compareObservations",
                      )}
                    </a>
                  ) : null}
                  {compare && props.similarHref ? " · " : null}
                  {props.similarHref && series ? (
                    <>
                      <a href={props.similarHref}>{t("chart.similar.link")}</a>{" "}
                      {tm("chart.similar.text")}
                    </>
                  ) : null}
                </p>
              ) : null}
            </Tabs.Content>
          </Tabs.Root>
        </>
      )}
    </section>
  );
}
