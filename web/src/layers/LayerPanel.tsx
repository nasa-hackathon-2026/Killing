import * as Collapsible from "@radix-ui/react-collapsible";
import { useState } from "react";
import type { CompareLink } from "../analysis/modelVsObs";
import type { TrendSummary } from "../analysis/trends";
import { ParticleStyleToggle } from "../forms/calm/ParticleStyleToggle";
import type { TrendSignal } from "../forms/encoding";
import { useI18n } from "../i18n";
import {
  displayPlaceName,
  groupedPlaces,
  placeGroupLabel,
  type Place,
} from "../snapshot/places";
import { stratumName } from "../strata/strataSpec";
import { toggleExpanded } from "./layerAccordion";
import type { LeftView } from "../leftPanel/leftView";
import { isNarrowScreen, setSidebarOpen } from "../sidebar/sidebarStore";
import { groupLayers } from "./layerGroups";
import { LayerRow } from "./LayerRow";
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
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
  // What the left side shows, and the handler for changing it (the close-up
  // and the chart of a layer are one slot: leftPanel/leftView.ts).
  view: LeftView;
  onView: (view: LeftView) => void;
  // Opens "How to read this" (the guide card); the link is hidden without it.
  onHowTo?: () => void;
};

// The month is chosen on the timeline at the bottom (the panel used to have a
// second slider for it; two controls for one value were confusing).
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
  onToggle,
  onOpacity,
  view,
  onView,
  onHowTo,
}: LayerPanelProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  // The layers whose details are open (layerAccordion.ts); none at first.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onCount = controls.filter((control) => control.visible).length;
  const head = (
    <div className="flex items-center justify-between gap-3">
      <h2 className="m-0 text-[13px] font-semibold text-ink">
        {t("layers.title")}
        <span className="ml-1.5 font-normal text-muted">
          {onCount > 0 ? `· ${t("layers.onCount", { count: onCount })}` : ""}
        </span>
      </h2>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? "layers.expand" : "layers.collapse")}
        onClick={() => setCollapsed(!collapsed)}
        className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-line bg-panel text-ink"
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <polyline
            points="2.5,4.5 6,8 9.5,4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={collapsed ? undefined : "rotate(180 6 6)"}
          />
        </svg>
      </button>
    </div>
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
      <>
        {head}
        {places && places.length > 0 && onLocation ? (
          <label className="mt-3 flex items-center gap-2 text-muted">
            <span className="shrink-0">{t("layers.valuesAt")}</span>
            <select
              value={locationId}
              aria-label={t("layers.place")}
              onChange={(event) => onLocation(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel-solid px-1.5 text-ink"
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
          <p className="mt-3 mb-0 text-muted">
            {t("layers.valuesAtPlace", { place: locationName })}
          </p>
        )}
        {placeNote ? (
          <p className="mt-2 mb-0 text-xs text-muted">{placeNote}</p>
        ) : null}
        <Collapsible.Root className="mt-2">
          <Collapsible.Trigger className="group flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 py-1 text-left text-muted hover:text-ink">
            <svg
              viewBox="0 0 12 12"
              width="10"
              height="10"
              aria-hidden="true"
              className="-rotate-90 transition-transform group-data-[state=open]:rotate-0 motion-reduce:transition-none"
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
            {t("layers.display")}
          </Collapsible.Trigger>
          <Collapsible.Content className="pt-1">
            <ParticleStyleToggle />
          </Collapsible.Content>
        </Collapsible.Root>
        {onHowTo ? (
          <p className="mt-1 mb-0">
            <button
              type="button"
              onClick={onHowTo}
              className="cursor-pointer border-0 bg-transparent p-0 text-accent-strong underline"
            >
              {t("common.action.howToRead")}
            </button>
          </p>
        ) : null}
        <div className="mt-3 space-y-3">
          {groupLayers(layers).map((group) => (
            <section key={group.id} aria-labelledby={`layer-group-${group.id}`}>
              <h3
                id={`layer-group-${group.id}`}
                className="m-0 mb-0.5 text-[11px] font-medium tracking-wide text-muted uppercase"
              >
                {group.id === "other"
                  ? t("layers.title")
                  : stratumName(group.id)}
              </h3>
              <ul className="m-0 list-none p-0">
                {group.layers.map((layer) => {
                  const control = controls.find((item) => item.id === layer.id);
                  if (!control) return null;
                  return (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      control={control}
                      reading={readings[layer.id]}
                      trend={trends?.[layer.id]}
                      signal={signals?.[layer.id]}
                      expanded={expandedIds.has(layer.id)}
                      onExpand={(id) =>
                        setExpandedIds(toggleExpanded(expandedIds, id))
                      }
                      onToggle={onToggle}
                      onOpacity={onOpacity}
                      view={view}
                      onView={onView}
                      compareLink={compareLinks?.[layer.id]}
                      // On a phone the sidebar covers the page, so it slides
                      // away when a chart or a close-up opens.
                      onBeforeOpen={() => {
                        if (isNarrowScreen()) setSidebarOpen(false);
                      }}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </>
    </aside>
  );
}
