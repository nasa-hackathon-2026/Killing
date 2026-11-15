import { useMemo, useState } from "react";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import {
  formatChangePerDecade,
  formatChangePlain,
  significanceText,
  type TestResult,
  type TrendEntry,
} from "../analysis/trends";
import { companionFor } from "../companions/companionSpec";
import { formatCount, localNumber, t, useI18n } from "../i18n";
import { variableDefinition } from "../i18n/names";
import { formatMeasurement } from "../snapshot/reading";
import { UnitText } from "../snapshot/UnitText";
import {
  formatTick,
  linearScale,
  linePath,
  nearestIndex,
  niceTicks,
  paddedExtent,
  yearTicks,
} from "./chartGeometry";
import {
  alignAnomalies,
  alignCoverage,
  alignValues,
  calendarAnomalies,
  chartModeLabel,
  CHART_MODES,
  displayUnit,
  displayValue,
  formatAnomaly,
  formatP,
  runningMean,
  trendLine,
  type AnomalySeries,
  type ChartMode,
  type MonthlyPoint,
} from "./seriesMath";
import { useTimeline } from "./TimelineContext";
import { monthNumber } from "./timelineMath";

const WIDTH = 560;
const HEIGHT = 210;
const MARGIN = { top: 8, right: 10, bottom: 22, left: 58 };

type TimeSeriesPanelProps = {
  variableName: string;
  variableId: string;
  locationName: string;
  // Null when the snapshot has no series of this variable at this place.
  series: { unit: string; points: MonthlyPoint[] } | null;
  // The pipeline's anomalies; when missing they are recomputed here.
  anomalies: AnomalySeries | null;
  trend: TrendEntry | undefined;
  alpha: number;
  // Documented step months of this series ("YYYY-MM-01").
  breaks: string[];
  // The series has a documented issue that affects trends
  // (analysis/trendReliability.ts); limits the wording of the t-test line.
  unreliable?: boolean;
  // Link to this place and variable in the "Similar series" section of the
  // mining page.
  similarHref?: string;
  onClose: () => void;
};

function verdict(test: TestResult, alpha: number): string {
  if (test.p === null) return t("chart.stats.pNone");
  if (test.p_fdr === null) return t("chart.stats.p", { p: formatP(test.p) });
  return t("chart.stats.pFdr", {
    p: formatP(test.p),
    fdr: formatP(test.p_fdr),
    verdict: t(
      test.significant_fdr
        ? "chart.stats.significant"
        : "chart.stats.notSignificant",
    ),
    alpha: localNumber(String(alpha)),
  });
}

// The chart of one variable at the current place over the whole record, with
// the linear trend from trends.json. Numbers and method only.
export function TimeSeriesPanel({
  variableName,
  variableId,
  locationName,
  series,
  anomalies,
  trend,
  alpha,
  breaks,
  unreliable = false,
  similarHref,
  onClose,
}: TimeSeriesPanelProps) {
  const { months, monthIndex, setMonthIndex, setPlaying } = useTimeline();
  const { tm, settings, voice } = useI18n();
  const [mode, setMode] = useState<ChartMode>("values");
  const [collapsed, setCollapsed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const unit = series?.unit ?? "";
  const level = Math.round((1 - alpha) * 100);

  const chart = useMemo(() => {
    if (!series || months.length < 2) return null;
    const raw = alignValues(series.points, months);
    const values = raw.map((value) => displayValue(value, unit));
    const departures = anomalies
      ? alignAnomalies(anomalies, months)
      : calendarAnomalies(raw, months);
    const shown =
      mode === "values"
        ? values
        : mode === "anomalies"
          ? departures
          : runningMean(values);
    const line =
      trend?.status === "analyzed"
        ? trendLine(
            trend.ols.slope_per_decade,
            trend.ols.ci_per_decade,
            months,
            departures,
            mode === "anomalies" ? departures : values,
          )
        : null;
    const extent = paddedExtent([shown, line ? [...line.line] : []]);
    if (!extent) return null;
    const first = monthNumber(months[0] ?? "");
    const last = monthNumber(months.at(-1) ?? "");
    const time = linearScale(
      [first, last],
      [MARGIN.left, WIDTH - MARGIN.right],
    );
    const y = linearScale(extent, [HEIGHT - MARGIN.bottom, MARGIN.top]);
    const x = (index: number) => time(monthNumber(months[index] ?? ""));
    const ticks = niceTicks(extent);
    return {
      raw,
      departures,
      coverage: alignCoverage(series.points, months),
      path: linePath(shown, x, y),
      line,
      time,
      x,
      y,
      ticks,
      years: yearTicks(first, last),
      zero: extent[0] < 0 && extent[1] > 0 ? y(0) : null,
    };
  }, [series, anomalies, trend, months, mode, unit]);

  const pointAt = (clientX: number, target: SVGSVGElement) => {
    const box = target.getBoundingClientRect();
    const position = ((clientX - box.left) / box.width) * WIDTH;
    return nearestIndex(
      position,
      MARGIN.left,
      WIDTH - MARGIN.right,
      months.length,
    );
  };
  const focus = hover ?? monthIndex;
  const focusMonth = months[focus];
  const analyzed = trend?.status === "analyzed" ? trend : null;
  const caveat = trendCaveat(variableId, voice);
  const dataKind = companionFor(variableId)?.dataKind;
  const definition = settings.definitions
    ? variableDefinition(variableId, voice)
    : null;
  const axisUnit = displayUnit(unit);
  const unitNote = axisUnit ? ` (${axisUnit})` : "";
  // The full statistics: shown as they are for a researcher, folded under
  // "Details" otherwise.
  const statistics = analyzed ? (
    <>
      <dl className="timeline-stats">
        <dt>{t("chart.stats.change")}</dt>
        <dd>
          <UnitText
            text={formatChangePerDecade(
              analyzed.ols.slope_per_decade,
              analyzed.ols.ci_per_decade,
              analyzed.unit,
              alpha,
            )}
          />
        </dd>
        <dt>{t("chart.stats.ttest")}</dt>
        <dd>
          {verdict(analyzed.ols, alpha)};{" "}
          {significanceText(analyzed.ols, unreliable)}
          {analyzed.ols.n_effective !== undefined
            ? `. ${t("chart.stats.neff", {
                n: formatCount(Math.round(analyzed.ols.n_effective)),
                r:
                  analyzed.ols.lag1_autocorrelation === undefined
                    ? t("common.status.notAvailable")
                    : localNumber(analyzed.ols.lag1_autocorrelation.toFixed(2)),
              })}`
            : ""}
        </dd>
        <dt>{t("chart.stats.mk")}</dt>
        <dd>
          {t("chart.stats.mkLine", {
            hamedRao: verdict(analyzed.mann_kendall.hamed_rao, alpha),
            seasonal: verdict(analyzed.mann_kendall.seasonal, alpha),
          })}
        </dd>
        <dt>{t("chart.stats.sen")}</dt>
        <dd>
          <UnitText
            text={formatChangePerDecade(
              analyzed.sen.slope_per_decade,
              analyzed.sen.ci_per_decade,
              analyzed.unit,
              alpha,
            )}
          />
        </dd>
        <dt>{t("chart.stats.period")}</dt>
        <dd>
          {t("chart.stats.periodLine", {
            first: analyzed.data.first_month.slice(0, 7),
            last: analyzed.data.last_month.slice(0, 7),
            count: formatCount(analyzed.data.n_valid),
          })}
        </dd>
      </dl>
      {!analyzed.ols.significant_fdr ? (
        <p className="timeline-chart-note">{tm("trend.notSignificantNote")}</p>
      ) : null}
      <p className="timeline-chart-note">{t("chart.stats.method")}</p>
    </>
  ) : null;

  return (
    <section
      className={`timeline-chart${collapsed ? " timeline-chart-collapsed" : ""}`}
      aria-label={t("chart.aria", { name: variableName })}
    >
      <header>
        <h2>
          {variableName} <span>{t("chart.at", { place: locationName })}</span>
        </h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {t(collapsed ? "chart.show" : "chart.hide")}
        </button>
        <button type="button" aria-label={t("chart.close")} onClick={onClose}>
          {t("common.action.close")}
        </button>
      </header>
      {collapsed ? null : !series ? (
        <p className="timeline-chart-note">
          {t("chart.noSeries", { place: locationName })}
        </p>
      ) : (
        <>
          <div
            className="timeline-modes"
            role="group"
            aria-label={t("chart.modesAria")}
          >
            {CHART_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                onClick={() => setMode(item.id)}
              >
                {chartModeLabel(item.id)}
              </button>
            ))}
          </div>
          {chart ? (
            <svg
              className="timeline-plot"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={t("chart.plotAria", {
                mode: chartModeLabel(mode),
                name: variableName,
                place: locationName,
                first: months[0]?.slice(0, 7) ?? "",
                last: months.at(-1)?.slice(0, 7) ?? "",
              })}
              onPointerMove={(event) =>
                setHover(pointAt(event.clientX, event.currentTarget))
              }
              onPointerLeave={() => setHover(null)}
              onClick={(event) => {
                setPlaying(false);
                setMonthIndex(pointAt(event.clientX, event.currentTarget));
              }}
            >
              <defs>
                <clipPath id="timeline-plot-area">
                  <rect
                    x={MARGIN.left}
                    y={MARGIN.top}
                    width={WIDTH - MARGIN.left - MARGIN.right}
                    height={HEIGHT - MARGIN.top - MARGIN.bottom}
                  />
                </clipPath>
              </defs>
              {chart.ticks.map((tick) => (
                <g key={tick}>
                  <line
                    className="timeline-grid"
                    x1={MARGIN.left}
                    x2={WIDTH - MARGIN.right}
                    y1={chart.y(tick)}
                    y2={chart.y(tick)}
                  />
                  <text
                    className="timeline-axis"
                    x={MARGIN.left - 6}
                    y={chart.y(tick) + 4}
                    textAnchor="end"
                  >
                    {formatTick(tick, chart.ticks)}
                  </text>
                </g>
              ))}
              {chart.zero !== null ? (
                <line
                  className="timeline-zero"
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={chart.zero}
                  y2={chart.zero}
                />
              ) : null}
              {chart.years.map((year) => (
                <text
                  key={year}
                  className="timeline-axis"
                  x={chart.time(year)}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                >
                  {year / 12}
                </text>
              ))}
              <g clipPath="url(#timeline-plot-area)">
                {breaks.map((month) => (
                  <line
                    key={month}
                    className="timeline-break"
                    x1={chart.time(monthNumber(month))}
                    x2={chart.time(monthNumber(month))}
                    y1={MARGIN.top}
                    y2={HEIGHT - MARGIN.bottom}
                  />
                ))}
                {chart.line ? (
                  <polygon
                    className="timeline-band"
                    points={[
                      [chart.line.start, chart.line.low[0]],
                      [chart.line.end, chart.line.low[1]],
                      [chart.line.end, chart.line.high[1]],
                      [chart.line.start, chart.line.high[0]],
                    ]
                      .map(
                        ([at, value]) =>
                          `${chart.time(at ?? 0).toFixed(1)},${chart.y(value ?? 0).toFixed(1)}`,
                      )
                      .join(" ")}
                  />
                ) : null}
                <path className="timeline-series" d={chart.path} />
                {chart.line ? (
                  <line
                    className="timeline-trend"
                    x1={chart.time(chart.line.start)}
                    x2={chart.time(chart.line.end)}
                    y1={chart.y(chart.line.line[0])}
                    y2={chart.y(chart.line.line[1])}
                  />
                ) : null}
              </g>
              {hover !== null && hover !== monthIndex ? (
                <line
                  className="timeline-hover"
                  x1={chart.x(hover)}
                  x2={chart.x(hover)}
                  y1={MARGIN.top}
                  y2={HEIGHT - MARGIN.bottom}
                />
              ) : null}
              {monthIndex >= 0 ? (
                <line
                  className="timeline-cursor"
                  x1={chart.x(monthIndex)}
                  x2={chart.x(monthIndex)}
                  y1={MARGIN.top}
                  y2={HEIGHT - MARGIN.bottom}
                />
              ) : null}
            </svg>
          ) : (
            <p className="timeline-chart-note">{t("chart.noValues")}</p>
          )}
          {chart && focusMonth ? (
            <p className="timeline-readout">
              <strong>{focusMonth.slice(0, 7)}</strong> ·{" "}
              <UnitText
                text={tm("chart.readout", {
                  value: formatMeasurement(chart.raw[focus] ?? null, unit),
                  anomaly: formatAnomaly(chart.departures[focus] ?? null, unit),
                  coverage:
                    chart.coverage[focus] === null ||
                    chart.coverage[focus] === undefined
                      ? t("common.status.notAvailable")
                      : `${Math.round((chart.coverage[focus] ?? 0) * 100)}%`,
                })}
              />
              {hover === null ? ` ${t("chart.readout.timelineMonth")}` : ""}
            </p>
          ) : null}
          {definition ? (
            <p className="timeline-chart-note">{definition}</p>
          ) : null}
          <p className="timeline-chart-note">
            <i className="timeline-key timeline-key-series" />
            {mode === "values" ? (
              <UnitText text={t("chart.key.values", { unit: unitNote })} />
            ) : (
              <UnitText text={tm(`chart.key.${mode}`, { unit: unitNote })} />
            )}
            {chart?.line ? (
              <>
                {" "}
                <i className="timeline-key timeline-key-trend" />
                {tm("chart.key.trend")}{" "}
                <i className="timeline-key timeline-key-band" />
                {tm("chart.key.band", { level })}
              </>
            ) : null}
            {breaks.length > 0 ? (
              <>
                {" "}
                <i className="timeline-key timeline-key-break" />
                {tm("chart.key.break", {
                  months: breaks.map((month) => month.slice(0, 7)).join(", "),
                })}
              </>
            ) : null}{" "}
            <i className="timeline-key timeline-key-cursor" />
            {t("chart.key.cursor")}
          </p>
          {analyzed && !settings.fullStatistics ? (
            <dl className="timeline-stats timeline-plain">
              <dt>{t("chart.plain.change")}</dt>
              <dd>
                <UnitText
                  text={formatChangePlain(
                    analyzed.ols.slope_per_decade,
                    analyzed.ols.ci_per_decade,
                    analyzed.unit,
                  )}
                />
              </dd>
              <dt>{t("chart.plain.holds")}</dt>
              <dd>{significanceText(analyzed.ols, unreliable, "general")}</dd>
              <dt>{t("chart.plain.reliable")}</dt>
              <dd>
                {unreliable ? t("trend.reliable.bad") : t("trend.reliable.ok")}
                {dataKind && dataKind !== "unknown"
                  ? ` ${t(`common.dataKind.${dataKind}.general`)}`
                  : ""}
              </dd>
            </dl>
          ) : null}
          {analyzed ? (
            settings.fullStatistics ? (
              statistics
            ) : (
              <details className="timeline-details">
                <summary>{t("common.action.details")}</summary>
                {statistics}
              </details>
            )
          ) : trend?.status === "insufficient" ? (
            <p className="timeline-chart-note">
              {t("chart.stats.notAnalyzed", { reason: trend.reason.text_en })}
            </p>
          ) : (
            <p className="timeline-chart-note">{t("chart.stats.none")}</p>
          )}
          {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
          {similarHref && series ? (
            <p className="timeline-chart-note">
              <a href={similarHref}>{t("chart.similar.link")}</a>{" "}
              {tm("chart.similar.text")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
