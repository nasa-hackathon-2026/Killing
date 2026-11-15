// Hand-drawn SVG charts of the investigation panel, in the style of the
// original time series chart (timeline/ classes). Each chart has an
// aria-label summary; the numbers come from the caller.
import { useId, useState } from "react";
import { monthName } from "../i18n";
import {
  formatTick,
  linearScale,
  linePath,
  nearestIndex,
  niceTicks,
  paddedExtent,
  yearTicks,
} from "../timeline/chartGeometry";
import type { TrendLine } from "../timeline/seriesMath";
import { useTimeline } from "../timeline/TimelineContext";
import { monthNumber } from "../timeline/timelineMath";

export const CHART_WIDTH = 420;
const MARGIN = { top: 8, right: 8, bottom: 20, left: 48 };

function Ticks({
  ticks,
  y,
  left,
  right,
}: {
  ticks: number[];
  y: (value: number) => number;
  left: number;
  right: number;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            className="timeline-grid"
            x1={left}
            x2={right}
            y1={y(tick)}
            y2={y(tick)}
          />
          <text
            className="timeline-axis"
            x={left - 5}
            y={y(tick) + 4}
            textAnchor="end"
          >
            {formatTick(tick, ticks)}
          </text>
        </g>
      ))}
    </>
  );
}

type TimeChartProps = {
  // The timeline's months; `values` is laid out on them.
  months: string[];
  values: (number | null)[];
  line?: TrendLine | null;
  breaks?: string[];
  // Indices drawn as dots (months beyond the outlier limit).
  marks?: number[];
  height?: number;
  ariaLabel: string;
  // Draw the series as a thin line plus dots instead of a line only.
  dots?: boolean;
  // Extra horizontal reference lines (e.g. ±3 robust SD).
  guides?: number[];
};

// A series over the whole record, with the timeline's cursor and a click
// that moves the timeline to the clicked month (the original chart's
// behaviour).
export function TimeChart({
  months,
  values,
  line = null,
  breaks = [],
  marks = [],
  height = 190,
  ariaLabel,
  guides = [],
}: TimeChartProps) {
  const { monthIndex, setMonthIndex, setPlaying } = useTimeline();
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const extent = paddedExtent([values, line ? [...line.line] : [], guides]);
  if (!extent || months.length < 2) return null;
  const first = monthNumber(months[0] ?? "");
  const last = monthNumber(months.at(-1) ?? "");
  const right = CHART_WIDTH - MARGIN.right;
  const bottom = height - MARGIN.bottom;
  const time = linearScale([first, last], [MARGIN.left, right]);
  const y = linearScale(extent, [bottom, MARGIN.top]);
  const x = (index: number) => time(monthNumber(months[index] ?? ""));
  const ticks = niceTicks(extent);
  const pointAt = (clientX: number, target: SVGSVGElement) => {
    const box = target.getBoundingClientRect();
    const position = ((clientX - box.left) / box.width) * CHART_WIDTH;
    return nearestIndex(position, MARGIN.left, right, months.length);
  };
  return (
    <svg
      className="timeline-plot"
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      role="img"
      aria-label={ariaLabel}
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
        <clipPath id={clip}>
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={right - MARGIN.left}
            height={bottom - MARGIN.top}
          />
        </clipPath>
      </defs>
      <Ticks ticks={ticks} y={y} left={MARGIN.left} right={right} />
      {extent[0] < 0 && extent[1] > 0 ? (
        <line
          className="timeline-zero"
          x1={MARGIN.left}
          x2={right}
          y1={y(0)}
          y2={y(0)}
        />
      ) : null}
      {yearTicks(first, last).map((year) => (
        <text
          key={year}
          className="timeline-axis"
          x={time(year)}
          y={height - 5}
          textAnchor="middle"
        >
          {year / 12}
        </text>
      ))}
      <g clipPath={`url(#${clip})`}>
        {guides.map((value) => (
          <line
            key={value}
            className="investigation-guide"
            x1={MARGIN.left}
            x2={right}
            y1={y(value)}
            y2={y(value)}
          />
        ))}
        {breaks.map((month) => (
          <line
            key={month}
            className="timeline-break"
            x1={time(monthNumber(month))}
            x2={time(monthNumber(month))}
            y1={MARGIN.top}
            y2={bottom}
          />
        ))}
        {line ? (
          <polygon
            className="timeline-band"
            points={[
              [line.start, line.low[0]],
              [line.end, line.low[1]],
              [line.end, line.high[1]],
              [line.start, line.high[0]],
            ]
              .map(
                ([at, value]) =>
                  `${time(at ?? 0).toFixed(1)},${y(value ?? 0).toFixed(1)}`,
              )
              .join(" ")}
          />
        ) : null}
        <path className="timeline-series" d={linePath(values, x, y)} />
        {marks.map((index) => {
          const value = values[index];
          if (value === null || value === undefined) return null;
          return (
            <circle
              key={index}
              className="investigation-mark"
              cx={x(index)}
              cy={y(value)}
              r={3}
            />
          );
        })}
        {line ? (
          <line
            className="timeline-trend"
            x1={time(line.start)}
            x2={time(line.end)}
            y1={y(line.line[0])}
            y2={y(line.line[1])}
          />
        ) : null}
      </g>
      {hover !== null && hover !== monthIndex ? (
        <line
          className="timeline-hover"
          x1={x(hover)}
          x2={x(hover)}
          y1={MARGIN.top}
          y2={bottom}
        />
      ) : null}
      {monthIndex >= 0 && monthIndex < months.length ? (
        <line
          className="timeline-cursor"
          x1={x(monthIndex)}
          x2={x(monthIndex)}
          y1={MARGIN.top}
          y2={bottom}
        />
      ) : null}
    </svg>
  );
}

const MONTH_DATES = Array.from(
  { length: 12 },
  (_, at) => `2001-${String(at + 1).padStart(2, "0")}-01`,
);

// Twelve calendar months: the record's average (line), the range of each
// month (band, optional) and one year on top (dots and line). The month of
// the timeline is highlighted.
export function SeasonChart({
  mean,
  min,
  max,
  year,
  ariaLabel,
  height = 130,
  showRange = false,
}: {
  mean: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  year: (number | null)[] | null;
  ariaLabel: string;
  height?: number;
  showRange?: boolean;
}) {
  const { month } = useTimeline();
  const extent = paddedExtent([
    mean,
    year ?? [],
    showRange ? min : [],
    showRange ? max : [],
  ]);
  if (!extent) return null;
  const right = CHART_WIDTH - MARGIN.right;
  const bottom = height - MARGIN.bottom;
  const x = linearScale([0, 11], [MARGIN.left + 10, right - 10]);
  const y = linearScale(extent, [bottom, MARGIN.top]);
  const ticks = niceTicks(extent, 3);
  const current = month ? monthNumber(month) % 12 : -1;
  return (
    <svg
      className="timeline-plot investigation-static"
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      <Ticks ticks={ticks} y={y} left={MARGIN.left} right={right} />
      {current >= 0 ? (
        <rect
          className="investigation-now"
          x={x(current) - 9}
          y={MARGIN.top}
          width={18}
          height={bottom - MARGIN.top}
        />
      ) : null}
      {MONTH_DATES.map((date, at) => (
        <text
          key={date}
          className="timeline-axis"
          x={x(at)}
          y={height - 5}
          textAnchor="middle"
        >
          {monthName(date, "short")}
        </text>
      ))}
      {showRange
        ? min.map((low, at) => {
            const high = max[at];
            if (low === null || high === null || high === undefined)
              return null;
            return (
              <line
                key={at}
                className="investigation-range"
                x1={x(at)}
                x2={x(at)}
                y1={y(low)}
                y2={y(high)}
              />
            );
          })
        : null}
      <path
        className="investigation-season"
        d={linePath(mean, (at) => x(at), y)}
      />
      {year ? (
        <>
          <path
            className="investigation-year"
            d={linePath(year, (at) => x(at), y)}
          />
          {year.map((value, at) =>
            value === null ? null : (
              <circle
                key={at}
                className="investigation-year-dot"
                cx={x(at)}
                cy={y(value)}
                r={2.6}
              />
            ),
          )}
        </>
      ) : null}
    </svg>
  );
}

export type IntervalRow = {
  label: string;
  estimate: number;
  low: number;
  high: number;
  text: string;
  emphasis?: boolean;
};

// Estimates with their intervals on one number line centred on 0.
export function IntervalChart({
  rows,
  limit,
  x,
  ariaLabel,
}: {
  rows: IntervalRow[];
  limit: number;
  x: (value: number) => number;
  ariaLabel: string;
}) {
  const rowHeight = 30;
  const top = 6;
  const height = top + rows.length * rowHeight + 18;
  const ticks = niceTicks([-limit, limit], 4);
  return (
    <svg
      className="timeline-plot investigation-static"
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            className="timeline-grid"
            x1={x(tick)}
            x2={x(tick)}
            y1={top}
            y2={height - 18}
          />
          <text
            className="timeline-axis"
            x={x(tick)}
            y={height - 5}
            textAnchor="middle"
          >
            {formatTick(tick, ticks)}
          </text>
        </g>
      ))}
      <line
        className="investigation-zero"
        x1={x(0)}
        x2={x(0)}
        y1={top}
        y2={height - 18}
      />
      {rows.map((row, at) => {
        const middle = top + at * rowHeight + rowHeight / 2 + 4;
        return (
          <g
            key={row.label}
            className={row.emphasis ? "investigation-interval-main" : ""}
          >
            <line
              className="investigation-interval"
              x1={x(row.low)}
              x2={x(row.high)}
              y1={middle}
              y2={middle}
            />
            <line
              className="investigation-interval"
              x1={x(row.low)}
              x2={x(row.low)}
              y1={middle - 5}
              y2={middle + 5}
            />
            <line
              className="investigation-interval"
              x1={x(row.high)}
              x2={x(row.high)}
              y1={middle - 5}
              y2={middle + 5}
            />
            <circle
              className="investigation-estimate"
              cx={x(row.estimate)}
              cy={middle}
              r={4.5}
            />
            <text
              className="timeline-axis investigation-interval-label"
              x={8}
              y={middle - 8}
            >
              {row.label}: {row.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export type Bar = { key: string | number; value: number; label?: string };

// Vertical bars from 0 (autocorrelation, histogram counts, yearly means),
// with optional dashed horizontal limits and one highlighted reference.
export function BarChart({
  bars,
  ariaLabel,
  height = 120,
  limits = [],
  reference,
  labelEvery = 1,
  fromZero = true,
}: {
  bars: Bar[];
  ariaLabel: string;
  height?: number;
  limits?: number[];
  reference?: { at: number; value: number } | null;
  labelEvery?: number;
  fromZero?: boolean;
}) {
  if (bars.length === 0) return null;
  const values = bars.map((bar) => bar.value);
  const extent = paddedExtent([
    values,
    limits,
    fromZero ? [0] : [],
    reference ? [reference.value] : [],
  ]);
  if (!extent) return null;
  const right = CHART_WIDTH - MARGIN.right;
  const bottom = height - MARGIN.bottom;
  const y = linearScale(extent, [bottom, MARGIN.top]);
  const step = (right - MARGIN.left) / bars.length;
  const base = fromZero ? y(0) : bottom;
  const ticks = niceTicks(extent, 3);
  return (
    <svg
      className="timeline-plot investigation-static"
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      <Ticks ticks={ticks} y={y} left={MARGIN.left} right={right} />
      {bars.map((bar, at) => {
        const top = y(bar.value);
        return (
          <g key={bar.key}>
            <rect
              className="investigation-bar"
              x={MARGIN.left + at * step + step * 0.15}
              width={Math.max(1, step * 0.7)}
              y={Math.min(top, base)}
              height={Math.max(0.5, Math.abs(base - top))}
            />
            {bar.label !== undefined && at % labelEvery === 0 ? (
              <text
                className="timeline-axis"
                x={MARGIN.left + at * step + step / 2}
                y={height - 5}
                textAnchor="middle"
              >
                {bar.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {limits.map((limit) => (
        <line
          key={limit}
          className="investigation-limit"
          x1={MARGIN.left}
          x2={right}
          y1={y(limit)}
          y2={y(limit)}
        />
      ))}
      {fromZero ? (
        <line
          className="timeline-zero"
          x1={MARGIN.left}
          x2={right}
          y1={y(0)}
          y2={y(0)}
        />
      ) : null}
      {reference ? (
        <circle
          className="investigation-reference"
          cx={MARGIN.left + reference.at * step + step / 2}
          cy={y(reference.value)}
          r={4}
        />
      ) : null}
    </svg>
  );
}

// One small-multiple cell: anomalies and the trend line on a shared time
// axis. `extent` null = the cell's own scale.
export function Sparkline({
  values,
  months,
  line,
  span,
  extent,
}: {
  values: (number | null)[];
  months: string[];
  line: TrendLine | null;
  span: [number, number];
  extent: [number, number] | null;
}) {
  const width = 130;
  const height = 52;
  const own = paddedExtent([values, line ? [...line.line] : []]);
  const range = extent ?? own;
  if (!range) return null;
  const time = linearScale(span, [2, width - 2]);
  const y = linearScale(range, [height - 2, 2]);
  const x = (index: number) => time(monthNumber(months[index] ?? ""));
  return (
    <svg
      className="investigation-spark"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {range[0] < 0 && range[1] > 0 ? (
        <line className="timeline-zero" x1={0} x2={width} y1={y(0)} y2={y(0)} />
      ) : null}
      <path className="investigation-spark-line" d={linePath(values, x, y)} />
      {line ? (
        <line
          className="timeline-trend"
          x1={time(line.start)}
          x2={time(line.end)}
          y1={y(line.line[0])}
          y2={y(line.line[1])}
        />
      ) : null}
    </svg>
  );
}
