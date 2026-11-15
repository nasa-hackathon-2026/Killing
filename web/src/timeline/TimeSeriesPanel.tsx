import { useMemo, useState } from "react";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import {
  formatChangePerDecade,
  significanceText,
  type TestResult,
  type TrendEntry,
} from "../analysis/trends";
import { formatMeasurement } from "../snapshot/reading";
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
  onClose: () => void;
};

function verdict(test: TestResult, alpha: number): string {
  if (test.p === null) return "p not available";
  const fdr =
    test.p_fdr === null
      ? ""
      : `, FDR-adjusted ${formatP(test.p_fdr)} (${
          test.significant_fdr ? "significant" : "not significant"
        } at ${alpha})`;
  return `p ${formatP(test.p)}${fdr}`;
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
  onClose,
}: TimeSeriesPanelProps) {
  const { months, monthIndex, setMonthIndex, setPlaying } = useTimeline();
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
  const caveat = trendCaveat(variableId);
  const axisUnit = displayUnit(unit);

  return (
    <section
      className={`timeline-chart${collapsed ? " timeline-chart-collapsed" : ""}`}
      aria-label={`Time series of ${variableName}`}
    >
      <header>
        <h2>
          {variableName} <span>at {locationName}</span>
        </h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "Show chart" : "Hide chart"}
        </button>
        <button type="button" aria-label="Close chart" onClick={onClose}>
          Close
        </button>
      </header>
      {collapsed ? null : !series ? (
        <p className="timeline-chart-note">
          No data at this place: this variable has no series at {locationName}{" "}
          in the snapshot.
        </p>
      ) : (
        <>
          <div className="timeline-modes" role="group" aria-label="Chart mode">
            {CHART_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {chart ? (
            <svg
              className="timeline-plot"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={`${CHART_MODES.find((item) => item.id === mode)?.label} of ${variableName} at ${locationName}, ${months[0]?.slice(0, 7)} to ${months.at(-1)?.slice(0, 7)}`}
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
            <p className="timeline-chart-note">No values to draw.</p>
          )}
          {chart && focusMonth ? (
            <p className="timeline-readout">
              <strong>{focusMonth.slice(0, 7)}</strong> · value{" "}
              {formatMeasurement(chart.raw[focus] ?? null, unit)} · anomaly{" "}
              {formatAnomaly(chart.departures[focus] ?? null, unit)} · coverage{" "}
              {chart.coverage[focus] === null ||
              chart.coverage[focus] === undefined
                ? "not available"
                : `${Math.round((chart.coverage[focus] ?? 0) * 100)}%`}
              {hover === null ? " (timeline month)" : ""}
            </p>
          ) : null}
          <p className="timeline-chart-note">
            <i className="timeline-key timeline-key-series" />
            {mode === "values"
              ? `Monthly values${axisUnit ? ` (${axisUnit})` : ""}`
              : mode === "anomalies"
                ? `Anomalies${axisUnit ? ` (${axisUnit})` : ""}: value minus the mean of the same calendar month`
                : `Centred 12-month mean${axisUnit ? ` (${axisUnit})` : ""}; needs all 12 months, so gaps stay gaps`}
            {chart?.line ? (
              <>
                {" "}
                <i className="timeline-key timeline-key-trend" />
                Linear trend of the monthly anomalies (slope from the analysis,
                drawn through the mean of the analysed months).{" "}
                <i className="timeline-key timeline-key-band" />
                {level}% CI of the slope, not a prediction interval.
              </>
            ) : null}
            {breaks.length > 0 ? (
              <>
                {" "}
                <i className="timeline-key timeline-key-break" />
                Documented step month (
                {breaks.map((month) => month.slice(0, 7)).join(", ")}).
              </>
            ) : null}{" "}
            <i className="timeline-key timeline-key-cursor" />
            Timeline month; click the chart to jump.
          </p>
          {analyzed ? (
            <dl className="timeline-stats">
              <dt>Change per decade</dt>
              <dd>
                {formatChangePerDecade(
                  analyzed.ols.slope_per_decade,
                  analyzed.ols.ci_per_decade,
                  analyzed.unit,
                  alpha,
                )}
              </dd>
              <dt>t-test of the slope</dt>
              <dd>
                {verdict(analyzed.ols, alpha)}; {significanceText(analyzed.ols)}
                {analyzed.ols.n_effective !== undefined
                  ? `. Effective sample size ${Math.round(analyzed.ols.n_effective)} (lag-1 autocorrelation ${analyzed.ols.lag1_autocorrelation?.toFixed(2) ?? "n/a"})`
                  : ""}
              </dd>
              <dt>Mann-Kendall</dt>
              <dd>
                Hamed-Rao: {verdict(analyzed.mann_kendall.hamed_rao, alpha)}.
                Seasonal: {verdict(analyzed.mann_kendall.seasonal, alpha)}
              </dd>
              <dt>Sen slope</dt>
              <dd>
                {formatChangePerDecade(
                  analyzed.sen.slope_per_decade,
                  analyzed.sen.ci_per_decade,
                  analyzed.unit,
                  alpha,
                )}
              </dd>
              <dt>Period</dt>
              <dd>
                {analyzed.data.first_month.slice(0, 7)} to{" "}
                {analyzed.data.last_month.slice(0, 7)}, {analyzed.data.n_valid}{" "}
                valid months
              </dd>
            </dl>
          ) : trend?.status === "insufficient" ? (
            <p className="timeline-chart-note">
              Trend not analyzed: {trend.reason.text_en}
            </p>
          ) : (
            <p className="timeline-chart-note">
              No trend statistics for this series.
            </p>
          )}
          {analyzed && !analyzed.ols.significant_fdr ? (
            <p className="timeline-chart-note">
              Not significant does not mean no change; the record may be too
              short or too variable to tell.
            </p>
          ) : null}
          {analyzed ? (
            <p className="timeline-chart-note">
              Method: least-squares slope of monthly anomalies; the t-test and
              CI use an effective sample size from the lag-1 autocorrelation of
              the residuals; FDR is Benjamini-Hochberg across the analysed
              series of one family (Taiwan&apos;s series are one family, the
              world cities and the global mean another). The Sen slope CI has no
              autocorrelation correction.
            </p>
          ) : null}
          {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
        </>
      )}
    </section>
  );
}
