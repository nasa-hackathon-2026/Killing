import { useState } from "react";
import type { CompareLink } from "../analysis/modelVsObs";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import type { TrendSummary } from "../analysis/trends";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import type { TrendSignal } from "../forms/encoding";
import { groupedPlaces, type Place } from "../snapshot/places";
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
}: LayerPanelProps) {
  const monthIndex = month ? months.indexOf(month) : -1;
  const [collapsed, setCollapsed] = useState(isNarrow);
  const onCount = controls.filter((control) => control.visible).length;
  const head = (
    <p className="layers-title">
      <span>
        Layers
        {collapsed ? ` · ${onCount} on` : ""}
      </span>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand layers" : "Collapse layers"}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? "+" : "–"}
      </button>
    </p>
  );
  if (collapsed) {
    return (
      <aside className="layers layers-collapsed" aria-label="Layers">
        {head}
      </aside>
    );
  }

  return (
    <aside className="layers" aria-label="Layers">
      {head}
      {places && places.length > 0 && onLocation ? (
        <label className="layers-place">
          <span>Values at</span>
          <select
            value={locationId}
            aria-label="Place"
            onChange={(event) => onLocation(event.target.value)}
          >
            {groupedPlaces(places).map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.nameEn}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : (
        <p className="layers-note">Values at {locationName}</p>
      )}
      {placeNote ? <p className="layers-note">{placeNote}</p> : null}
      {monthIndex >= 0 ? (
        <label className="month">
          Month
          <input
            type="range"
            min={0}
            max={months.length - 1}
            step={1}
            value={monthIndex}
            aria-label="Month"
            onChange={(event) => {
              const next = months[Number(event.target.value)];
              if (next) onMonth(next);
            }}
          />
          <span>{month?.slice(0, 7)}</span>
        </label>
      ) : null}
      <p className="layers-note">
        Count, size and speed of each form follow this place&apos;s own record.
        Kelvin is shown as °C. Each slider sets opacity. Flow direction is
        illustrative; no wind data.
      </p>
      {trends ? (
        <p className="layers-note">
          Trend: linear change of monthly anomalies over each record. Not
          significant does not mean no change; the record may be too short or
          too variable to tell. ▲ ▼ and the arrows above a layer (away from the
          Earth = rising, towards it = falling) mark significant trends only; ◇
          is not significant. A crossed-out triangle marks a significant trend
          that is not reliable as a climate signal (documented data issue; see
          its caution).
        </p>
      ) : null}
      <ul>
        {layers.map((layer) => {
          const control = controls.find((item) => item.id === layer.id);
          if (!control) return null;
          const trend = trends?.[layer.id];
          const signal = signals?.[layer.id];
          const caveat = trend ? trendCaveat(layer.id) : null;
          return (
            <li key={layer.id}>
              <label>
                <input
                  type="checkbox"
                  checked={control.visible}
                  onChange={() => onToggle(layer.id)}
                />
                <span>{layer.nameEn}</span>
                {signal ? <TrendMarkIcon signal={signal} /> : null}
                <span className="reading">{readings[layer.id]}</span>
              </label>
              {trend ? (
                <p className="trend">
                  {trend.headline}
                  <span>
                    {trend.significance}
                    {trend.period ? ` · ${trend.period}` : ""}
                  </span>
                </p>
              ) : null}
              {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
              <div className="timeline-layer-actions">
                {onCloseUp ? (
                  <button
                    type="button"
                    className="closeup-open"
                    aria-label={`${layer.nameEn} close-up`}
                    onClick={() => {
                      if (isNarrow()) setCollapsed(true);
                      onCloseUp(layer.id);
                    }}
                  >
                    Close-up
                  </button>
                ) : null}
                {onChart ? (
                  <button
                    type="button"
                    className="closeup-open"
                    aria-label={`${layer.nameEn} time series chart`}
                    aria-pressed={chartId === layer.id}
                    onClick={() => {
                      if (isNarrow()) setCollapsed(true);
                      onChart(chartId === layer.id ? null : layer.id);
                    }}
                  >
                    Chart
                  </button>
                ) : null}
                {compareLinks?.[layer.id] ? (
                  <a
                    className="closeup-open layers-compare"
                    href={compareLinks[layer.id]?.href}
                  >
                    {compareLinks[layer.id]?.label}
                  </a>
                ) : null}
              </div>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={control.opacity}
                aria-label={`${layer.nameEn} opacity`}
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
