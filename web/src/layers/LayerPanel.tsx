import type { TrendSummary } from "../analysis/trends";
import { trendMark, type TrendSignal } from "../forms/encoding";
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
  months: string[];
  month: string | null;
  onMonth: (month: string) => void;
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
  // Opens the close-up view of a layer; the button is hidden without it.
  onCloseUp?: (id: string) => void;
};

export function LayerPanel({
  layers,
  controls,
  readings,
  trends,
  signals,
  locationName,
  months,
  month,
  onMonth,
  onToggle,
  onOpacity,
  onCloseUp,
}: LayerPanelProps) {
  const monthIndex = month ? months.indexOf(month) : -1;

  return (
    <aside className="layers">
      <p className="layers-title">Layers</p>
      <p className="layers-note">Values at {locationName}</p>
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
          is not significant.
        </p>
      ) : null}
      <ul>
        {layers.map((layer) => {
          const control = controls.find((item) => item.id === layer.id);
          if (!control) return null;
          const trend = trends?.[layer.id];
          const signal = signals?.[layer.id];
          const mark = signal ? trendMark(signal) : null;
          return (
            <li key={layer.id}>
              <label>
                <input
                  type="checkbox"
                  checked={control.visible}
                  onChange={() => onToggle(layer.id)}
                />
                <span>{layer.nameEn}</span>
                {mark && mark.glyph ? (
                  <span
                    className="trend-mark"
                    role="img"
                    aria-label={mark.label}
                    title={mark.label}
                  >
                    {mark.glyph}
                  </span>
                ) : null}
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
              {onCloseUp ? (
                <button
                  type="button"
                  className="closeup-open"
                  aria-label={`${layer.nameEn} close-up`}
                  onClick={() => onCloseUp(layer.id)}
                >
                  Close-up
                </button>
              ) : null}
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
