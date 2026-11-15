import * as Collapsible from "@radix-ui/react-collapsible";
import type { CompareLink } from "../analysis/modelVsObs";
import { TrendBlock } from "../analysis/TrendBlock";
import type { TrendSummary } from "../analysis/trends";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import { shownTrendCaveat } from "../analysis/trendCaveats";
import type { TrendSignal } from "../forms/encoding";
import { formColor } from "../forms/formColor";
import { carryChoices, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { cn } from "../lib/cn";
import { UnitText } from "../snapshot/UnitText";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/buttonClass";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { Tip } from "../ui/tooltip";
import type { LayerControl } from "./LayerPanel";
import type { LayerDefinition } from "./registry";

export type LayerRowProps = {
  layer: LayerDefinition;
  control: LayerControl;
  reading: string | undefined;
  trend: TrendSummary | null | undefined;
  signal: TrendSignal | undefined;
  // Whether this row's details are open (any number of rows can be open).
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

// One layer of the Layers panel. Folded: a switch in the layer's own colour
// (on/off), then a button with the name (it wraps, never cut off), the trend
// mark, a caution mark when the trend has a documented issue, the value and
// a chevron. The button opens the details: the trend sentence and caution,
// the close-up, chart and compare buttons and the opacity slider. The switch
// is outside the button so turning a layer on never opens its details.
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
  const hintId = `layer-caution-${layer.id}`;
  const caveat = shownTrendCaveat(layer.id, trend, voice);
  return (
    <li
      data-layer-row={layer.id}
      className="border-b border-line/40 last:border-b-0"
    >
      <Collapsible.Root open={expanded} onOpenChange={() => onExpand(layer.id)}>
        <div className="flex items-start gap-2.5 py-2">
          <Switch
            className="mt-px"
            color={formColor(layer)}
            checked={control.visible}
            onCheckedChange={() => onToggle(layer.id)}
            aria-label={t("layers.showAria", { name })}
          />
          <Collapsible.Trigger
            aria-describedby={caveat ? hintId : undefined}
            className={cn(
              "group grid min-w-0 flex-1 cursor-pointer grid-cols-[1fr_auto_auto] items-start gap-x-3 rounded border-0 bg-transparent p-0 text-left text-ink",
              "hover:text-white",
            )}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
              <span>{name}</span>
              {signal ? <TrendMarkIcon signal={signal} /> : null}
              {caveat ? (
                <Tip label={t("layers.cautionHint")}>
                  <span
                    aria-hidden="true"
                    className="cursor-help text-[#ffb020]"
                  >
                    ⚠
                  </span>
                </Tip>
              ) : null}
            </span>
            <span className="max-w-[6rem] pt-px text-right text-xs leading-snug break-words text-soft tabular-nums">
              <UnitText text={reading ?? ""} />
            </span>
            <svg
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              className="mt-[3px] text-muted transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
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
          </Collapsible.Trigger>
          {caveat ? (
            <span id={hintId} className="sr-only">
              {t("layers.cautionHint")}
            </span>
          ) : null}
        </div>
        <Collapsible.Content className="space-y-2.5 pb-3 pl-[42px] text-xs">
          <TrendBlock variableId={layer.id} trend={trend} signal={signal} />
          <div className="flex flex-wrap gap-1.5">
            {onCloseUp ? (
              <Button
                aria-label={t("layers.closeUpAria", { name })}
                onClick={() => {
                  onBeforeOpen?.();
                  onCloseUp(layer.id);
                }}
              >
                {t("layers.closeUp")}
              </Button>
            ) : null}
            {onChart ? (
              <Button
                variant={chartId === layer.id ? "pressed" : "outline"}
                aria-label={t("layers.chartAria", { name })}
                aria-pressed={chartId === layer.id}
                onClick={() => {
                  onBeforeOpen?.();
                  onChart(chartId === layer.id ? null : layer.id);
                }}
              >
                {t("layers.chart")}
              </Button>
            ) : null}
            {compareLink ? (
              <a
                className={buttonClass({})}
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
          <label className="flex items-center gap-2 text-muted">
            <span className="shrink-0">{t("layers.opacity")}</span>
            <Slider
              min={0.15}
              max={1}
              step={0.05}
              value={control.opacity}
              aria-label={t("layers.opacityAria", { name })}
              onValueChange={(opacity) => onOpacity(layer.id, opacity)}
            />
          </label>
        </Collapsible.Content>
      </Collapsible.Root>
    </li>
  );
}
