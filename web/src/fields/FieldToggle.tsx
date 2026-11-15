import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import { companionFor } from "../companions/companionSpec";
import { formColor } from "../forms/formColor";
import { localNumber, monthName, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { layerRegistry } from "../layers/registry";
import { UnitText } from "../snapshot/UnitText";
import { useTimeline } from "../timeline/TimelineContext";
import { fieldVariable } from "./fieldConfig";
import { seededRandom } from "./fieldGrid";
import {
  calendarMonth,
  dotBrightness,
  fieldLevel,
  formatFieldValue,
} from "./fieldMapping";
import { resolveField, setFieldMode, useFieldMode } from "./fieldStore";
import { fieldText } from "./fieldText";
import { useField, type FieldData } from "./loadField";
import "./field.css";

type FieldToggleProps = {
  // Ids of the layers switched on in the Layers panel ("auto" mode).
  openIds: readonly string[];
  // The global trend map is on (the legend says how the two are layered).
  trendMapOn?: boolean;
  legendHidden?: boolean;
};

function layerName(id: string): string {
  return layerRegistry.find((layer) => layer.id === id)?.nameEn ?? id;
}

// "Global distribution: Off / <variable>" in the HUD, and its legend above
// the timeline (rendered into the page's .app so it can use the timeline's
// CSS variables).
export function FieldToggle({
  openIds,
  trendMapOn = false,
  legendHidden = false,
}: FieldToggleProps) {
  useI18n();
  const mode = useFieldMode();
  const timeline = useTimeline();
  const id = resolveField(mode, timeline.selectedVariableId, openIds);
  const state = useField(id);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const month = calendarMonth(timeline.month);

  return (
    <label
      className="field-toggle"
      ref={(element) =>
        setAnchor(
          element
            ?.closest(".app")
            ?.querySelector<HTMLElement>(".map-legends") ?? null,
        )
      }
    >
      <span>{fieldText.controlLabel}</span>
      <select
        value={mode ?? ""}
        aria-label={fieldText.controlLabel}
        onChange={(event) => setFieldMode(event.target.value || null)}
      >
        <option value="">{fieldText.off}</option>
        <option value="auto">{fieldText.auto}</option>
        {layerRegistry.map((layer) =>
          fieldVariable(layer.id) ? (
            <option key={layer.id} value={layer.id}>
              {variableName(layer.id, layer.nameEn)}
            </option>
          ) : (
            <option
              key={layer.id}
              value={layer.id}
              disabled
              title={fieldText.unavailableReason}
            >
              {fieldText.unavailable(variableName(layer.id, layer.nameEn))}
            </option>
          ),
        )}
      </select>
      {anchor && mode !== null && !legendHidden
        ? createPortal(
            <aside className="field-legend" aria-live="polite">
              {id === null ? (
                <p className="field-legend-note">{fieldText.autoNothing}</p>
              ) : state.status === "ready" ? (
                <FieldLegend
                  field={state.field}
                  month={month}
                  trendMapOn={trendMapOn}
                />
              ) : (
                <p className="field-legend-note">
                  {state.status === "error"
                    ? fieldText.error
                    : fieldText.loading}
                </p>
              )}
            </aside>,
            anchor,
          )
        : null}
    </label>
  );
}

// A strip of dots drawn with the same mapping as the globe: low on the left,
// high on the right.
function DensityStrip({ color }: { color: string }) {
  const dots = useMemo(() => {
    const random = seededRandom(5);
    return Array.from({ length: 140 }, () => {
      const x = random();
      const y = random();
      const glow = dotBrightness(fieldLevel(x, { low: 0, high: 1 }), random());
      return { x, y, glow };
    }).filter((dot) => dot.glow > 0);
  }, []);
  return (
    <svg
      className="field-strip"
      viewBox="0 0 200 22"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {dots.map((dot, index) => (
        <circle
          key={index}
          cx={4 + dot.x * 192}
          cy={3 + dot.y * 16}
          r={1.3}
          fill={color}
          opacity={dot.glow}
        />
      ))}
    </svg>
  );
}

function FieldLegend({
  field,
  month,
  trendMapOn,
}: {
  field: FieldData;
  month: number | null;
  trendMapOn: boolean;
}) {
  const { t } = useI18n();
  const { variable, meta, spec, range } = field;
  const layer = layerRegistry.find((item) => item.id === variable.id);
  const color = layer ? formColor(layer) : "#ffffff";
  const display = variable.display ?? {
    factor: 1,
    offset: 0,
    unit: spec.climatology.unit,
  };
  const shown = (value: number) =>
    localNumber(formatFieldValue(value * display.factor + display.offset));
  const shownMonth =
    month === null
      ? null
      : monthName(`2000-${String(month + 1).padStart(2, "0")}`);
  const period = spec.climatology.period;
  const kind = companionFor(variable.id)?.dataKind;
  const caveat = trendCaveat(variable.id);
  const typical = shownMonth
    ? `${fieldText.typical(shownMonth)}${period ? ` (${fieldText.period(period[0], period[1])})` : ""}`
    : null;

  return (
    <details open className="field-legend-body">
      <summary>
        <span className="field-legend-typical">{typical}</span>
        <span className="field-legend-name">
          {variableName(variable.id, meta.name_en ?? layerName(variable.id))}
        </span>
      </summary>
      <p className="field-legend-caption">
        <UnitText text={`${fieldText.densityCaption} (${display.unit})`} />
      </p>
      <DensityStrip color={color} />
      <p
        className="field-legend-ends"
        style={{ "--field-color": color } as CSSProperties}
      >
        <span>
          {fieldText.low} {shown(range.low)}
        </span>
        <span>
          {fieldText.high} {shown(range.high)}
        </span>
      </p>
      <p className="field-legend-strong">{fieldText.notThisMonth}</p>
      {period ? (
        <p className="field-legend-note">
          {fieldText.method(period[0], period[1])}
        </p>
      ) : null}
      <p className="field-legend-note">{fieldText.noWind}</p>
      {kind ? (
        <p className="field-legend-note">
          {fieldText.dataKind(t(`common.dataKind.${kind}.label`))}
        </p>
      ) : null}
      {trendMapOn ? (
        <p className="field-legend-note">{fieldText.withTrendMap}</p>
      ) : null}
      {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
    </details>
  );
}
