// ③ How much? Monthly anomalies with the published linear trend and its
// confidence band, the change per decade of OLS and Sen on one number line
// centred on 0, the linear conversion over the period and the numbers.
import { useMemo } from "react";
import { formatChangePerDecade } from "../analysis/trends";
import { formatCount, t, tm, useI18n } from "../i18n";
import { UnitText } from "../snapshot/UnitText";
import { displayUnit, formatP, trendLine } from "../timeline/seriesMath";
import { BarChart, CHART_WIDTH, IntervalChart, TimeChart } from "./charts";
import { Fold, ReadingNote } from "./Fold";
import { formatTotal, recordYears } from "./format";
import type { SeriesModel } from "./InvestigationPanel";
import { annualMeans, intervalScale, periodMonths } from "./stats";

export function HowMuchTab({
  model,
  variableName,
  locationName,
  breaks,
}: {
  model: SeriesModel;
  variableName: string;
  locationName: string;
  breaks: string[];
}) {
  const { settings } = useI18n();
  const analyzed = model.trend?.status === "analyzed" ? model.trend : null;
  const level = Math.round((1 - model.alpha) * 100);
  const line = analyzed
    ? trendLine(
        analyzed.ols.slope_per_decade,
        analyzed.ols.ci_per_decade,
        model.months,
        model.anomalies,
        model.anomalies,
      )
    : null;
  const years = useMemo(
    () => annualMeans(model.anomalies, model.months),
    [model.anomalies, model.months],
  );
  const unit = displayUnit(model.unit);
  const unitNote = unit ? ` (${unit})` : "";
  const chart = (
    <>
      <h4 className="investigation-subtitle">
        {t("investigation.howmuch.anomalyTitle")}
      </h4>
      <TimeChart
        months={model.months}
        values={model.anomalies}
        line={line}
        breaks={breaks}
        height={180}
        ariaLabel={t("investigation.howmuch.anomalyAria", {
          name: variableName,
          place: locationName,
        })}
      />
      <p className="timeline-chart-note">
        <i className="timeline-key timeline-key-series" />
        {tm("chart.key.anomalies", { unit: unitNote })}
        {line ? (
          <>
            {" "}
            <i className="timeline-key timeline-key-trend" />
            {tm("chart.key.trend")}{" "}
            <i className="timeline-key timeline-key-band" />
            {tm("chart.key.band", { level })}
          </>
        ) : null}
        {breaks.length ? (
          <>
            {" "}
            <i className="timeline-key timeline-key-break" />
            {tm("chart.key.break", {
              months: breaks.map((month) => month.slice(0, 7)).join(", "),
            })}
          </>
        ) : null}
      </p>
    </>
  );
  if (!analyzed) return chart;

  const ols = analyzed.ols;
  const sen = analyzed.sen;
  const scale = intervalScale(
    [
      ols.slope_per_decade,
      ...ols.ci_per_decade,
      sen.slope_per_decade,
      ...sen.ci_per_decade,
    ],
    16,
    CHART_WIDTH - 16,
  );
  const months = periodMonths(
    analyzed.data.first_month,
    analyzed.data.last_month,
  );
  return (
    <>
      <h4 className="investigation-subtitle">
        {t("investigation.howmuch.intervalTitle", { level })}
      </h4>
      <IntervalChart
        rows={[
          {
            label: t("investigation.howmuch.ols"),
            estimate: ols.slope_per_decade,
            low: ols.ci_per_decade[0],
            high: ols.ci_per_decade[1],
            text: formatChangePerDecade(
              ols.slope_per_decade,
              ols.ci_per_decade,
              analyzed.unit,
              model.alpha,
            ),
            emphasis: true,
          },
          {
            label: t("investigation.howmuch.sen"),
            estimate: sen.slope_per_decade,
            low: sen.ci_per_decade[0],
            high: sen.ci_per_decade[1],
            text: formatChangePerDecade(
              sen.slope_per_decade,
              sen.ci_per_decade,
              analyzed.unit,
              model.alpha,
            ),
          },
        ]}
        limit={scale.limit}
        x={scale.x}
        ariaLabel={t("investigation.howmuch.intervalAria", {
          ols: formatChangePerDecade(
            ols.slope_per_decade,
            ols.ci_per_decade,
            analyzed.unit,
            model.alpha,
          ),
          sen: formatChangePerDecade(
            sen.slope_per_decade,
            sen.ci_per_decade,
            analyzed.unit,
            model.alpha,
          ),
        })}
      />
      <p className="timeline-chart-note">
        <i className="timeline-key investigation-key-zero" />
        {t("investigation.howmuch.zero")}
      </p>
      <ReadingNote>{t("investigation.howmuch.intervalNote")}</ReadingNote>
      {chart}
      <ReadingNote>
        <UnitText
          text={t("investigation.howmuch.total", {
            first: analyzed.data.first_month.slice(0, 7),
            last: analyzed.data.last_month.slice(0, 7),
            years: recordYears(analyzed),
            total: formatTotal(analyzed),
          })}
        />
      </ReadingNote>
      <ReadingNote>{t("investigation.howmuch.why")}</ReadingNote>
      <Fold summary={t("investigation.howmuch.tableTitle")}>
        <dl className="timeline-stats">
          <dt>{t("investigation.howmuch.table.change")}</dt>
          <dd>
            <UnitText
              text={formatChangePerDecade(
                ols.slope_per_decade,
                ols.ci_per_decade,
                analyzed.unit,
                model.alpha,
              )}
            />
          </dd>
          <dt>{t("investigation.howmuch.table.p")}</dt>
          <dd>{formatP(ols.p)}</dd>
          <dt>{t("investigation.howmuch.table.period")}</dt>
          <dd>
            {t("trend.period", {
              first: analyzed.data.first_month.slice(0, 7),
              last: analyzed.data.last_month.slice(0, 7),
            })}
          </dd>
          <dt>{t("investigation.howmuch.table.valid")}</dt>
          <dd>{formatCount(analyzed.data.n_valid)}</dd>
          <dt>{t("investigation.howmuch.table.missing")}</dt>
          <dd>{formatCount(Math.max(0, months - analyzed.data.n_valid))}</dd>
        </dl>
        {!settings.readingAid ? (
          <p className="timeline-chart-note">
            <UnitText
              text={t("investigation.howmuch.total", {
                first: analyzed.data.first_month.slice(0, 7),
                last: analyzed.data.last_month.slice(0, 7),
                years: recordYears(analyzed),
                total: formatTotal(analyzed),
              })}
            />
          </p>
        ) : null}
      </Fold>
      {settings.fullStatistics ? (
        <>
          <h4 className="investigation-subtitle">
            {t("investigation.diag.annualTitle")}
          </h4>
          <BarChart
            bars={years
              .filter((year) => year.mean !== null)
              .map((year) => ({
                key: year.year,
                value: year.mean ?? 0,
                label: String(year.year),
              }))}
            labelEvery={5}
            ariaLabel={t("investigation.diag.annualAria", {
              first: years.find((year) => year.mean !== null)?.year ?? "",
              last:
                [...years].reverse().find((year) => year.mean !== null)?.year ??
                "",
            })}
          />
          <p className="timeline-chart-note">
            {t("investigation.diag.annualNote")}
          </p>
        </>
      ) : null}
    </>
  );
}
