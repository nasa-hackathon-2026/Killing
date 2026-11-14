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
  locationName: string;
  months: string[];
  month: string | null;
  onMonth: (month: string) => void;
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
};

export function LayerPanel({
  layers,
  controls,
  readings,
  locationName,
  months,
  month,
  onMonth,
  onToggle,
  onOpacity,
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
        Density follows this place&apos;s own record. Kelvin is shown as °C.
        Each slider sets opacity.
      </p>
      <ul>
        {layers.map((layer) => {
          const control = controls.find((item) => item.id === layer.id);
          if (!control) return null;
          return (
            <li key={layer.id}>
              <label>
                <input
                  type="checkbox"
                  checked={control.visible}
                  onChange={() => onToggle(layer.id)}
                />
                <span>{layer.nameEn}</span>
                <span className="reading">{readings[layer.id]}</span>
              </label>
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
