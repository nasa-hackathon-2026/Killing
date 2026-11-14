import { trendCaveat } from "../analysis/trendCaveats";
import { formatSlope, slopeUnitLabel } from "./trendGrid";
import {
  MIN_OVERLAY_OPACITY,
  NOT_SIGNIFICANT_ALPHA,
  PALETTES,
  RANGE_QUANTILE,
} from "./trendMapConfig";
import type { TrendMapState } from "./useTrendMap";

type TrendMapLegendProps = {
  state: TrendMapState;
  opacity: number;
  onOpacity: (opacity: number) => void;
};

// 0.9999084… (IMERG, from float32 coordinates) reads as 1.
function degrees(step: number): string {
  return `${Number(step.toFixed(2))}°`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// Legend of the global trend map: numbers and method only, no reading of
// what the pattern means.
export function TrendMapLegend({
  state,
  opacity,
  onOpacity,
}: TrendMapLegendProps) {
  if (state.status === "off") return null;
  if (state.status !== "ready") {
    return (
      <aside className="trendmap">
        <p className="trendmap-note">
          {state.status === "loading"
            ? "Loading the trend map…"
            : "Could not read the trend map."}
        </p>
      </aside>
    );
  }
  const { variable, meta, spec, limit } = state.map;
  const stops = PALETTES[variable.palette];
  const factor = variable.display?.factor ?? 1;
  const unit = variable.display?.unit ?? slopeUnitLabel(spec.slope.unit);
  const edge = formatSlope(limit * factor);
  const gradient = `linear-gradient(to right, ${stops
    .map((stop) => `rgb(${stop.join(",")})`)
    .join(", ")})`;
  const high = `rgb(${(stops.at(-1) ?? [0, 0, 0]).join(",")})`;
  const { period, parameters, significant } = meta.trend;
  const caveat = trendCaveat(variable.id);

  return (
    <aside className="trendmap">
      <p className="trendmap-title">{meta.name_en}</p>
      <p className="trendmap-note">
        Change per decade, {unit} per decade · {meta.product}
      </p>
      {caveat ? (
        <p className="trend-caveat" role="note">
          {caveat.text} <span>Sources: {caveat.sources}</span>
        </p>
      ) : null}
      <div
        className="trendmap-ramp"
        style={{ background: gradient }}
        role="img"
        aria-label={`Colour scale from −${edge} (falling) to +${edge} (rising) ${unit} per decade`}
      />
      <p className="trendmap-ticks">
        <span>−{edge}</span>
        <span>0</span>
        <span>+{edge}</span>
      </p>
      <p className="trendmap-ticks trendmap-note">
        <span>falling</span>
        <span>rising</span>
      </p>
      <ul className="trendmap-key">
        <li>
          <i style={{ background: high }} />
          Full colour: significant after FDR correction
        </li>
        <li>
          <i style={{ background: high, opacity: NOT_SIGNIFICANT_ALPHA }} />
          Faded: not significant, or significant only before correction
        </li>
        <li>
          <i className="trendmap-empty" />
          No colour: no data, or not analysed
        </li>
      </ul>
      <label className="trendmap-opacity">
        Opacity
        <input
          type="range"
          min={MIN_OVERLAY_OPACITY}
          max={1}
          step={0.05}
          value={opacity}
          aria-label="Trend map opacity"
          onChange={(event) => onOpacity(Number(event.target.value))}
        />
      </label>
      <p className="trendmap-note">
        Period {period.first_month} to {period.last_month} ({period.n_months}{" "}
        months). Grid {degrees(spec.latStep)} × {degrees(spec.lonStep)}.
        Significant after FDR correction:{" "}
        {percent(significant.fdr.area_fraction)} of the analysed area (
        {percent(significant.uncorrected.area_fraction)} before correction).
      </p>
      <p className="trendmap-note">
        Method: linear trend of monthly anomalies in each grid cell; t-test
        adjusted for lag-1 autocorrelation; Benjamini-Hochberg FDR across the
        map at α = {parameters.alpha}. The colour range is ±the{" "}
        {Math.round(RANGE_QUANTILE * 100)}th percentile of the absolute cell
        trends; values beyond it take the end colours.
        {variable.display ? ` ${variable.display.note}` : ""}
      </p>
      <p className="trendmap-note">
        Not significant does not mean no change. Trends are computed on a ~1°
        grid; sensor or product changes can cause artificial trends.
      </p>
    </aside>
  );
}
