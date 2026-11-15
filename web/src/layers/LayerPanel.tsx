import { useState } from "react";
import type { CompareLink } from "../analysis/modelVsObs";
import { TrendBlock } from "../analysis/TrendBlock";
import type { TrendSummary } from "../analysis/trends";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import { ParticleStyleToggle } from "../forms/calm/ParticleStyleToggle";
import type { TrendSignal } from "../forms/encoding";
import { carryChoices, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import {
  displayPlaceName,
  groupedPlaces,
  placeGroupLabel,
  type Place,
} from "../snapshot/places";
import { UnitText } from "../snapshot/UnitText";
import type { LayerDefinition } from "./registry";

export type LayerControl = {
  id: string;
  visible: boolean;
  opacity: number;
};

type LayerPanelProps = {
  layers: LayerDefinition[];
  controls: LayerControl[];
  readings: Record<string, string>;
  trends?: Record<string, TrendSummary | null>;
  signals?: Record<string, TrendSignal>;
  locationName: string;
  // The place menu: every place of the catalogs, the one shown now, and the
  // handler for picking another. Without `places` the name is plain text.
  places?: Place[];
  locationId?: string;
  onLocation?: (id: string) => void;
  // A sentence about how this place's numbers are made (places.ts).
  placeNote?: string | null;
  // Per layer: a link to the model vs observation page for this place.
  compareLinks?: Record<string, CompareLink>;
  months: string[];
  month: string | null;
  onMonth: (month: string) => void;
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
  // Opens the close-up view of a layer; the button is hidden without it.
  onCloseUp?: (id: string) => void;
  // Opens (or closes, with null) the time series chart of a layer; the
  // button is hidden without it. `chartId` is the layer charted now.
  chartId?: string | null;
  onChart?: (id: string | null) => void;
  // Opens "How to read this" (the guide card); the link is hidden without it.
  onHowTo?: () => void;
};

// At or below this width the panel starts folded (the globe would be hidden
// behind it) and folds again when it opens a chart or a close-up.
const NARROW_WIDTH = 700;

function isNarrow(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= NARROW_WIDTH;
}

export function LayerPanel({
  layers,
  controls,
  readings,
  trends,
  signals,
  locationName,
  places,
  locationId,
  onLocation,
  placeNote,
  compareLinks,
  months,
  month,
  onMonth,
  onToggle,
  onOpacity,
  onCloseUp,
  chartId,
  onChart,
  onHowTo,
}: LayerPanelProps) {
  const { t, tm, settings } = useI18n();
  const monthIndex = month ? months.indexOf(month) : -1;
  const [collapsed, setCollapsed] = useState(isNarrow);
  const onCount = controls.filter((control) => control.visible).length;
  const head = (
    <p className="layers-title">
      <span>
        {t("layers.title")}
        {collapsed ? ` · ${t("layers.onCount", { count: onCount })}` : ""}
      </span>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? "layers.expand" : "layers.collapse")}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? "+" : "–"}
      </button>
    </p>
  );
  if (collapsed) {
    return (
      <aside className="layers layers-collapsed" aria-label={t("layers.title")}>
        {head}
      </aside>
    );
  }

  return (
    <aside className="layers" aria-label={t("layers.title")}>
      {head}
      <ParticleStyleToggle />
      {places && places.length > 0 && onLocation ? (
        <label className="layers-place">
          <span>{t("layers.valuesAt")}</span>
          <select
            value={locationId}
            aria-label={t("layers.place")}
            onChange={(event) => onLocation(event.target.value)}
          >
            {groupedPlaces(places).map((group) => (
              <optgroup key={group.id} label={placeGroupLabel(group.id)}>
                {group.places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {displayPlaceName(place)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : (
        <p className="layers-note">
          {t("layers.valuesAtPlace", { place: locationName })}
        </p>
      )}
      {placeNote ? <p className="layers-note">{placeNote}</p> : null}
      {monthIndex >= 0 ? (
        <label className="month">
          {t("layers.month")}
          <input
            type="range"
            min={0}
            max={months.length - 1}
            step={1}
            value={monthIndex}
            aria-label={t("layers.month")}
            onChange={(event) => {
              const next = months[Number(event.target.value)];
              if (next) onMonth(next);
            }}
          />
          <span>{month?.slice(0, 7)}</span>
        </label>
      ) : null}
      <p className="layers-note">
        {tm("layers.note")}
        {onHowTo ? (
          <>
            {" "}
            <button type="button" className="layers-howto" onClick={onHowTo}>
              {t("common.action.howToRead")}
            </button>
          </>
        ) : null}
      </p>
      {trends && settings.readingAid ? (
        <p className="layers-note">{t("layers.trendNote")}</p>
      ) : null}
      <ul>
        {layers.map((layer) => {
          const control = controls.find((item) => item.id === layer.id);
          if (!control) return null;
          const trend = trends?.[layer.id];
          const signal = signals?.[layer.id];
          const name = variableName(layer.id, layer.nameEn);
          return (
            <li key={layer.id}>
              <label>
                <input
                  type="checkbox"
                  checked={control.visible}
                  onChange={() => onToggle(layer.id)}
                />
                <span>{name}</span>
                {signal ? <TrendMarkIcon signal={signal} /> : null}
                <span className="reading">
                  <UnitText text={readings[layer.id] ?? ""} />
                </span>
              </label>
              <TrendBlock variableId={layer.id} trend={trend} signal={signal} />
              <div className="timeline-layer-actions">
                {onCloseUp ? (
                  <button
                    type="button"
                    className="closeup-open"
                    aria-label={t("layers.closeUpAria", { name })}
                    onClick={() => {
                      if (isNarrow()) setCollapsed(true);
                      onCloseUp(layer.id);
                    }}
                  >
                    {t("layers.closeUp")}
                  </button>
                ) : null}
                {onChart ? (
                  <button
                    type="button"
                    className="closeup-open"
                    aria-label={t("layers.chartAria", { name })}
                    aria-pressed={chartId === layer.id}
                    onClick={() => {
                      if (isNarrow()) setCollapsed(true);
                      onChart(chartId === layer.id ? null : layer.id);
                    }}
                  >
                    {t("layers.chart")}
                  </button>
                ) : null}
                {compareLinks?.[layer.id] ? (
                  <a
                    className="closeup-open layers-compare"
                    href={carryChoices(compareLinks[layer.id]?.href ?? "")}
                  >
                    {t(
                      compareLinks[layer.id]?.label === "Compare with station"
                        ? "layers.compareStation"
                        : "layers.compareObservations",
                    )}
                  </a>
                ) : null}
              </div>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={control.opacity}
                aria-label={t("layers.opacityAria", { name })}
                onChange={(event) =>
                  onOpacity(layer.id, Number(event.target.value))
                }
              />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
