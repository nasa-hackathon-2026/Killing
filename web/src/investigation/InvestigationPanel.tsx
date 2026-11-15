// The investigation panel: what the Chart button (or ?chart=) opens. Four
// numbered tabs follow the four questions of the challenge; each starts
// with a one-sentence answer generated from the data and the existing
// trend rules (trendSignal, trendReliability), then a chart. Statistics are
// read from trends.json only.
import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { trendSignal, type TrendSignal } from "../forms/encoding";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import { trendCaveat } from "../analysis/trendCaveats";
import { trendUnreliable } from "../analysis/trendReliability";
import { trendKey, type TrendEntry, type TrendsFile } from "../analysis/trends";
import { useAnalysisFile } from "../analysis/useAnalysisFile";
import { compareLinksFor, loadModelVsObs } from "../analysis/modelVsObs";
import { carryChoices, t, tm, useI18n } from "../i18n";
import { variableDefinition } from "../i18n/names";
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
import { nextTab, TABS, type TabId } from "./logic";
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
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTab(tab, event.key);
    if (!next) return;
    event.preventDefault();
    onTab(next);
    tabRefs.current[next]?.focus();
  };

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
      <header>
        <h2>
          {variableName} <span>{t("chart.at", { place: locationName })}</span>
        </h2>
        <button
          type="button"
          className="investigation-expand"
          aria-pressed={wide}
          aria-label={t("investigation.panel.expandAria")}
          onClick={() => onWide(!wide)}
        >
          {t(
            wide ? "investigation.panel.narrow" : "investigation.panel.expand",
          )}
        </button>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onCollapsed(!collapsed)}
        >
          {t(collapsed ? "chart.show" : "chart.hide")}
        </button>
        <button type="button" aria-label={t("chart.close")} onClick={onClose}>
          {t("common.action.close")}
        </button>
      </header>
      {collapsed ? null : (
        <>
          {definition ? (
            <p className="investigation-definition" title={definition}>
              <TrendMarkIcon signal={signal} /> {definition}
            </p>
          ) : null}
          <div
            className="investigation-tabs"
            role="tablist"
            aria-label={t("investigation.panel.tabsAria")}
          >
            {TABS.map((id, index) => (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current[id] = node;
                }}
                type="button"
                role="tab"
                id={`investigation-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`investigation-page-${id}`}
                tabIndex={tab === id ? 0 : -1}
                title={t(`investigation.tabs.${id}.question`)}
                onClick={() => onTab(id)}
                onKeyDown={onTabKey}
              >
                <span className="investigation-tab-number">{index + 1}</span>
                {t(`investigation.tabs.${id}.short`)}
              </button>
            ))}
          </div>
          <div
            className="investigation-page"
            role="tabpanel"
            id={`investigation-page-${tab}`}
            aria-labelledby={`investigation-tab-${tab}`}
          >
            <h3 className="investigation-question">
              {TABS.indexOf(tab) + 1}. {t(`investigation.tabs.${tab}.question`)}
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
          </div>
        </>
      )}
    </section>
  );
}
