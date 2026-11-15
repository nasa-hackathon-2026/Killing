// ① What is changing? The whole monthly record (values or 12-month running
// mean), the seasonal cycle that anomalies remove, the variable's facts and
// the other variables of the same question group.
import { useMemo, useState } from "react";
import { companionFor } from "../companions/companionSpec";
import { t, useI18n } from "../i18n";
import { variableDefinition, variableName } from "../i18n/names";
import { UnitText } from "../snapshot/UnitText";
import {
  chartModeLabel,
  displayUnit,
  runningMean,
  trendLine,
  type ChartMode,
} from "../timeline/seriesMath";
import { BarChart, SeasonChart, TimeChart } from "./charts";
import { Segmented } from "../ui/segmented";
import { Fold, ReadingNote } from "./Fold";
import type { SeriesModel } from "./InvestigationPanel";
import { groupOf } from "./logic";
import { histogram, latestYear, seasonalCycle } from "./stats";

const MODES: ChartMode[] = ["values", "running"];

export function WhatTab({
  model,
  variableId,
  variableName: name,
  locationName,
  breaks,
  product,
  variables,
  onSelectVariable,
}: {
  model: SeriesModel;
  variableId: string;
  variableName: string;
  locationName: string;
  breaks: string[];
  product: string | undefined;
  variables: { id: string; nameEn: string }[];
  onSelectVariable: (id: string) => void;
}) {
  const { voice, settings } = useI18n();
  const [mode, setMode] = useState<ChartMode>("values");
  const shown = useMemo(
    () => (mode === "values" ? model.values : runningMean(model.values)),
    [mode, model.values],
  );
  const analyzed = model.trend?.status === "analyzed" ? model.trend : null;
  const line = analyzed
    ? trendLine(
        analyzed.ols.slope_per_decade,
        analyzed.ols.ci_per_decade,
        model.months,
        model.anomalies,
        model.values,
      )
    : null;
  const cycle = useMemo(
    () => seasonalCycle(model.values, model.months),
    [model.values, model.months],
  );
  const latest = useMemo(
    () => latestYear(model.values, model.months),
    [model.values, model.months],
  );
  const bins = useMemo(() => histogram(model.anomalies), [model.anomalies]);
  const unit = displayUnit(model.unit);
  const kind = companionFor(variableId)?.dataKind;
  const first =
    model.trend?.status === "analyzed"
      ? model.trend.data.first_month
      : model.months[0];
  const last =
    model.trend?.status === "analyzed"
      ? model.trend.data.last_month
      : model.months.at(-1);
  const place = locationName;
  return (
    <>
      <Segmented
        className="my-2"
        aria-label={t("chart.modesAria")}
        value={mode}
        onValueChange={setMode}
        options={MODES.map((id) => ({
          value: id,
          label: chartModeLabel(id),
        }))}
      />
      <TimeChart
        months={model.months}
        values={shown}
        line={line}
        breaks={breaks}
        ariaLabel={t("chart.plotAria", {
          mode: chartModeLabel(mode),
          name,
          place,
          first: model.months[0]?.slice(0, 7) ?? "",
          last: model.months.at(-1)?.slice(0, 7) ?? "",
        })}
      />
      <p className="timeline-chart-note">
        <i className="timeline-key timeline-key-series" />
        {mode === "values"
          ? t("chart.key.values", { unit: unit ? ` (${unit})` : "" })
          : t(`chart.key.running.${voice}`, { unit: unit ? ` (${unit})` : "" })}
        {line ? (
          <>
            {" "}
            <i className="timeline-key timeline-key-trend" />
            {t(`chart.key.trend.${voice}`)}
          </>
        ) : null}{" "}
        <i className="timeline-key timeline-key-cursor" />
        {t("chart.key.cursor")}
      </p>
      <Fold summary={t("common.action.details")} student>
        <h4 className="investigation-subtitle">
          {t("investigation.what.seasonTitle")}
        </h4>
        <SeasonChart
          mean={cycle.mean}
          min={cycle.min}
          max={cycle.max}
          year={latest?.values ?? null}
          showRange={settings.fullStatistics}
          ariaLabel={t("investigation.what.seasonAria", {
            name,
            place,
            year: latest?.year ?? "",
          })}
        />
        <p className="timeline-chart-note">
          <i className="timeline-key investigation-key-season" />
          {t("investigation.what.seasonKeyMean")}{" "}
          {latest ? (
            <>
              <i className="timeline-key investigation-key-year" />
              {t("investigation.what.seasonKeyYear", { year: latest.year })}
            </>
          ) : null}
          {settings.fullStatistics ? (
            <>
              {" "}
              <i className="timeline-key investigation-key-range" />
              {t("investigation.what.seasonKeyRange")}
            </>
          ) : null}
        </p>
        <ReadingNote>{t("investigation.what.why")}</ReadingNote>
        <dl className="timeline-stats">
          <dt>{t("investigation.what.facts.definition")}</dt>
          <dd>{variableDefinition(variableId, voice) ?? name}</dd>
          <dt>{t("investigation.what.facts.unit")}</dt>
          <dd>
            <UnitText text={unit || "—"} />
          </dd>
          {kind ? (
            <>
              <dt>{t("investigation.what.facts.kind")}</dt>
              <dd>
                {t(`common.dataKind.${kind}.label`)}
                {settings.readingAid
                  ? ` · ${t(`common.dataKind.${kind}.general`)}`
                  : ""}
              </dd>
            </>
          ) : null}
          {product ? (
            <>
              <dt>{t("investigation.what.facts.product")}</dt>
              <dd>{product}</dd>
            </>
          ) : null}
          <dt>{t("investigation.what.facts.period")}</dt>
          <dd>
            {t("investigation.what.facts.periodLine", {
              first: first?.slice(0, 7) ?? "",
              last: last?.slice(0, 7) ?? "",
            })}
          </dd>
        </dl>
      </Fold>
      {settings.fullStatistics ? (
        <>
          <h4 className="investigation-subtitle">
            {t("investigation.diag.histTitle")}
          </h4>
          <BarChart
            bars={bins.counts.map((count, at) => ({
              key: at,
              value: count,
              label:
                at === 0 || at === bins.counts.length - 1
                  ? Number((bins.edges[at] ?? 0).toPrecision(2)).toString()
                  : undefined,
            }))}
            ariaLabel={t("investigation.diag.histAria", {
              n: bins.counts.reduce((sum, count) => sum + count, 0),
            })}
            height={100}
          />
        </>
      ) : null}
      <QuestionGroups
        variableId={variableId}
        variables={variables}
        onSelectVariable={onSelectVariable}
      />
    </>
  );
}

// The variable's question group as chips that switch the chart to another
// variable, and the other groups folded below.
export function QuestionGroups({
  variableId,
  variables,
  onSelectVariable,
}: {
  variableId: string;
  variables: { id: string; nameEn: string }[];
  onSelectVariable: (id: string) => void;
}) {
  const group = groupOf(variableId);
  if (!group) return null;
  return (
    <div className="investigation-groups">
      <h4 className="investigation-subtitle">
        {t("investigation.what.groupsTitle")}
      </h4>
      <p className="investigation-group-question">
        {t(`investigation.groups.${group.id}`)}
      </p>
      <div className="investigation-chips">
        {group.variables.map((id) => {
          const known = variables.find((item) => item.id === id);
          if (!known) return null;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={id === variableId}
              onClick={() => onSelectVariable(id)}
            >
              {variableName(id, known.nameEn)}
            </button>
          );
        })}
      </div>
      <OtherGroups
        current={group.id}
        variables={variables}
        onSelectVariable={onSelectVariable}
      />
    </div>
  );
}

// The other question groups, folded: each question with its variables.
function OtherGroups({
  current,
  variables,
  onSelectVariable,
}: {
  current: string;
  variables: { id: string; nameEn: string }[];
  onSelectVariable: (id: string) => void;
}) {
  return (
    <details className="timeline-details investigation-fold">
      <summary>{t("investigation.what.groupsNote")}</summary>
      {variables.length
        ? ["water", "heat", "air", "other"]
            .filter((id) => id !== current)
            .map((id) => {
              const members = variables.filter(
                (item) => groupOf(item.id)?.id === id,
              );
              return (
                <div key={id}>
                  <p className="investigation-group-question">
                    {t(`investigation.groups.${id}`)}
                  </p>
                  <div className="investigation-chips">
                    {members.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectVariable(item.id)}
                      >
                        {variableName(item.id, item.nameEn)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
        : null}
    </details>
  );
}
