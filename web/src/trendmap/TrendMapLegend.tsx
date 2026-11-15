import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import { formatCount, localNumber, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { UnitText } from "../snapshot/UnitText";
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
  return `${localNumber(String(Number(step.toFixed(2))))}°`;
}

function percent(fraction: number): string {
  return `${localNumber((fraction * 100).toFixed(1))}%`;
}

// Legend of the global trend map: numbers and method only, no reading of
// what the pattern means.
export function TrendMapLegend({
  state,
  opacity,
  onOpacity,
}: TrendMapLegendProps) {
  const { t, tm, settings, voice } = useI18n();
  if (state.status === "off") return null;
  if (state.status !== "ready") {
    return (
      <aside className="trendmap">
        <p className="trendmap-note">
          {t(
            state.status === "loading" ? "trendmap.loading" : "trendmap.error",
          )}
        </p>
      </aside>
    );
  }
  const { variable, meta, spec, limit } = state.map;
  const stops = PALETTES[variable.palette];
  const factor = variable.display?.factor ?? 1;
  const unit = variable.display?.unit ?? slopeUnitLabel(spec.slope.unit);
  const edge = localNumber(formatSlope(limit * factor));
  const gradient = `linear-gradient(to right, ${stops
    .map((stop) => `rgb(${stop.join(",")})`)
    .join(", ")})`;
  const high = `rgb(${(stops.at(-1) ?? [0, 0, 0]).join(",")})`;
  const { period, parameters, significant } = meta.trend;
  const caveat = trendCaveat(variable.id, voice);
  // The method and the full numbers: shown as they are for a researcher,
  // folded under "Details" otherwise.
  const method = (
    <>
      <p className="trendmap-note">{t("trendmap.fadeNote")}</p>
      <p className="trendmap-note">
        {t("trendmap.periodLine", {
          first: period.first_month,
          last: period.last_month,
          count: formatCount(period.n_months),
          lat: degrees(spec.latStep),
          lon: degrees(spec.lonStep),
          fdr: percent(significant.fdr.area_fraction),
          raw: percent(significant.uncorrected.area_fraction),
        })}
      </p>
      <p className="trendmap-note">
        <UnitText
          text={`${t("trendmap.method", {
            alpha: localNumber(String(parameters.alpha)),
            quantile: Math.round(RANGE_QUANTILE * 100),
          })}${variable.display ? ` ${t("trendmap.evapUnit")}` : ""}`}
        />
      </p>
      <p className="trendmap-note">{t("trendmap.warning.expert")}</p>
    </>
  );

  return (
    <aside className="trendmap">
      <p className="trendmap-title">
        {variableName(variable.id, meta.name_en)}
      </p>
      <p className="trendmap-note">
        <UnitText
          text={t("trendmap.unitLine", { unit, product: meta.product })}
        />
      </p>
      {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
      <div
        className="trendmap-ramp"
        style={{ background: gradient }}
        role="img"
        aria-label={t("trendmap.rampAria", { edge, unit })}
      />
      <p className="trendmap-ticks">
        <span>−{edge}</span>
        <span>0</span>
        <span>+{edge}</span>
      </p>
      <p className="trendmap-ticks trendmap-note">
        <span>{t("trendmap.falling")}</span>
        <span>{t("trendmap.rising")}</span>
      </p>
      <ul className="trendmap-key">
        <li>
          <i style={{ background: high }} />
          {tm("trendmap.key.full")}
        </li>
        <li>
          <i style={{ background: high, opacity: NOT_SIGNIFICANT_ALPHA }} />
          {tm("trendmap.key.faded")}
        </li>
        <li>
          <i className="trendmap-empty" />
          {t("trendmap.key.empty")}
        </li>
      </ul>
      <p className="trendmap-note trendmap-season">
        {t("trendmap.seasonNote")}
      </p>
      <label className="trendmap-opacity">
        {t("trendmap.opacity")}
        <input
          type="range"
          min={MIN_OVERLAY_OPACITY}
          max={1}
          step={0.05}
          value={opacity}
          aria-label={t("trendmap.opacityAria")}
          onChange={(event) => onOpacity(Number(event.target.value))}
        />
      </label>
      {settings.fullStatistics ? (
        method
      ) : (
        <>
          <p className="trendmap-note">
            {t("trendmap.summary", {
              share: percent(significant.fdr.area_fraction),
              first: period.first_month,
              last: period.last_month,
            })}{" "}
            {tm("trendmap.warning")}
          </p>
          <details className="trend-details">
            <summary>{t("common.action.details")}</summary>
            {method}
          </details>
        </>
      )}
    </aside>
  );
}
