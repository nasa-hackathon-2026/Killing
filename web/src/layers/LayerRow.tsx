import type { CompareLink } from "../analysis/modelVsObs";
import { TrendBlock } from "../analysis/TrendBlock";
import type { TrendSummary } from "../analysis/trends";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import { shownTrendCaveat } from "../analysis/trendCaveats";
import type { TrendSignal } from "../forms/encoding";
import { carryChoices, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { UnitText } from "../snapshot/UnitText";
import type { LayerControl } from "./LayerPanel";
import type { LayerDefinition } from "./registry";

export type LayerRowProps = {
  layer: LayerDefinition;
  control: LayerControl;
  reading: string | undefined;
  trend: TrendSummary | null | undefined;
  signal: TrendSignal | undefined;
  // Whether this row's details are open (the panel keeps one open at a time).
  expanded: boolean;
  onExpand: (id: string) => void;
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
  onCloseUp?: (id: string) => void;
  chartId?: string | null;
  onChart?: (id: string | null) => void;
  compareLink?: CompareLink;
  // Called before a chart or a close-up opens (the narrow panel folds away).
  onBeforeOpen?: () => void;
};

// One layer of the Layers panel. Folded, it is one line: the on/off box,
// then a button with the name, the trend mark, a caution mark when the trend
// has a documented issue, the value and a chevron. The button opens the
// details: the trend sentence and caution, "Details", the close-up, chart and
// compare buttons and the opacity slider. The box only turns the layer on or
// off; it is outside the button so it never opens the details.
export function LayerRow({
  layer,
  control,
  reading,
  trend,
  signal,
  expanded,
  onExpand,
  onToggle,
  onOpacity,
  onCloseUp,
  chartId,
  onChart,
  compareLink,
  onBeforeOpen,
}: LayerRowProps) {
  const { t, voice } = useI18n();
  const name = variableName(layer.id, layer.nameEn);
  const bodyId = `layer-details-${layer.id}`;
  const hintId = `layer-caution-${layer.id}`;
  const caveat = shownTrendCaveat(layer.id, trend, voice);
  return (
    <li className={expanded ? "layer-row layer-row-open" : "layer-row"}>
      <div className="layer-row-head">
        <input
          type="checkbox"
          checked={control.visible}
          aria-label={t("layers.showAria", { name })}
          onChange={() => onToggle(layer.id)}
        />
        <button
          type="button"
          className="layer-row-toggle"
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          aria-describedby={caveat ? hintId : undefined}
          onClick={() => onExpand(layer.id)}
        >
          <span className="layer-row-name" title={name}>
            {name}
          </span>
          {signal ? <TrendMarkIcon signal={signal} /> : null}
          {caveat ? (
            <span className="layer-caution" aria-hidden="true">
              ⚠
            </span>
          ) : null}
          <span className="reading" title={reading}>
            <UnitText text={reading ?? ""} />
          </span>
          <svg
            className="layer-row-chevron"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <polyline
              points="2.5,4.5 6,8 9.5,4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {caveat ? (
          // Shown while the mark is hovered or the button has keyboard focus
          // (CSS); screen readers hear it as the button's description.
          <span id={hintId} className="layer-caution-tip" role="tooltip">
            {t("layers.cautionHint")}
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div id={bodyId} className="layer-row-body">
          <TrendBlock variableId={layer.id} trend={trend} signal={signal} />
          <div className="timeline-layer-actions">
            {onCloseUp ? (
              <button
                type="button"
                className="closeup-open"
                aria-label={t("layers.closeUpAria", { name })}
                onClick={() => {
                  onBeforeOpen?.();
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
                  onBeforeOpen?.();
                  onChart(chartId === layer.id ? null : layer.id);
                }}
              >
                {t("layers.chart")}
              </button>
            ) : null}
            {compareLink ? (
              <a
                className="closeup-open layers-compare"
                href={carryChoices(compareLink.href)}
              >
                {t(
                  compareLink.label === "Compare with station"
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
        </div>
      ) : null}
    </li>
  );
}
