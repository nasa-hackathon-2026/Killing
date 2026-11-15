// The layer view: its own canvas over the globe (the globe is paused under
// it), with HTML labels, companions, a legend and the panel of an expanded
// stratum. Numbers and wording come from the layer panel's data unchanged;
// nothing is computed or interpreted here.
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendBlock } from "../analysis/TrendBlock";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import type { TrendSummary, TrendsFile } from "../analysis/trends";
import { companionTexts } from "../companions/companionTexts";
import type { TrendSignal } from "../forms/encoding";
import { monthYear, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import type { LayerControl } from "../layers/LayerPanel";
import { layerRegistry } from "../layers/registry";
import type { LoadedSeries } from "../snapshot/loadSnapshot";
import { UnitText } from "../snapshot/UnitText";
import { CompanionSlot } from "./companionSlot";
import "./strata.css";
import {
  clampDepression,
  clampZoom,
  defaultOrbit,
  nextLayerIndex,
  pinchZoom,
  companionFit,
  type CompanionFit,
  FOV_DEG,
  MEDIUM_WIDTH,
} from "./strataCamera";
import { companionSpot } from "./strataLayout";
import {
  StrataScene,
  type SceneLayer,
  type StrataAnchor,
  type StrataOrbit,
} from "./StrataScene";
import {
  columnTotalNote,
  flowNote,
  strata,
  strataAssignments,
  strataNotes,
  stratum,
  stratumHeight,
  stratumName,
  variablesOf,
  type StratumId,
} from "./strataSpec";
import { surfaceImage } from "./surfaceCrop";
import { useChartOpen, useCurrentMonth } from "./useCurrentMonth";

type StrataViewProps = {
  closing: boolean;
  onClosed: () => void;
  onExit: () => void;
  // `nameEn` is the name to show (already in the active language).
  place: { nameEn: string; lat: number; lon: number };
  // The stratum a guided tour wants expanded; undefined leaves the choice
  // to the visitor.
  focus?: StratumId | null;
  // The month of the Month slider (see useCurrentMonth).
  month: string | null;
  controls: LayerControl[];
  readings: Record<string, string>;
  intensities: Record<string, number>;
  available: Record<string, boolean>;
  // Standardized anomaly of the month per variable (companions' posture).
  anomalyZ?: Record<string, number | null>;
  trends?: Record<string, TrendSummary | null>;
  signals?: Record<string, TrendSignal>;
  // For a companion's sentence of data facts (companions/companionTexts.ts):
  // the place's series, its id and aggregation, and the trends file.
  series?: LoadedSeries[];
  locationId?: string;
  aggregation?: string;
  trendsFile?: TrendsFile | null;
};

// Beside the stack or on the platforms, following the window size and the
// docked chart (strataCamera.ts companionPlacement).
// `rows` is the number of strata with a switched-on layer: a row of
// companions each, which have to fit the height (strataCamera.ts
// companionFit picks the size, or the platforms).
function useCompanionFit(chartOpen: boolean, rows: number): CompanionFit {
  const measure = useCallback(
    (): CompanionFit =>
      typeof window === "undefined"
        ? { placement: "on", tier: null }
        : companionFit(window.innerWidth, window.innerHeight, chartOpen, rows),
    [chartOpen, rows],
  );
  const [fit, setFit] = useState<CompanionFit>(measure);
  useEffect(() => {
    const update = () =>
      setFit((previous) => {
        const next = measure();
        return previous.placement === next.placement &&
          previous.tier?.id === next.tier?.id
          ? previous
          : next;
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [measure]);
  return fit;
}

// Size of a companion figure on a platform. Beside the stack it follows the
// tier (strataCamera.ts COMPANION_TIERS).
const ON_PLATFORM_SIZE = 40;

function nameOf(variableId: string): string {
  return variableName(
    variableId,
    layerRegistry.find((layer) => layer.id === variableId)?.nameEn,
  );
}

export function StrataView({
  closing,
  onClosed,
  onExit,
  place,
  month: appMonth,
  controls,
  readings,
  intensities,
  available,
  anomalyZ,
  trends,
  signals,
  focus,
  series,
  locationId,
  aggregation = "point",
  trendsFile = null,
}: StrataViewProps) {
  const { t, voice } = useI18n();
  const month = useCurrentMonth(appMonth);
  const chartOpen = useChartOpen();
  const fit = useCompanionFit(
    chartOpen,
    strata.filter((item) =>
      variablesOf(item.id).some((id) =>
        controls.some((control) => control.id === id && control.visible),
      ),
    ).length,
  );
  const placement = fit.placement;
  // The companion last clicked: its sentence shows in the stratum's panel.
  const [speaking, setSpeaking] = useState<string | null>(null);
  // The three notes of the legend start open where there is room for them
  // beside the six labels (a tall, wide window).
  const [notesOpen] = useState(
    () =>
      typeof window === "undefined" ||
      (window.innerWidth > MEDIUM_WIDTH && window.innerHeight >= 800),
  );
  const [selected, setSelected] = useState<StratumId | null>(focus ?? null);
  // Expanding a stratum by any way other than a companion clears the
  // companion sentence; a companion click sets both (see the companions).
  const choose = (id: StratumId | null) => {
    setSelected(id);
    setSpeaking(null);
  };
  // A tour step moves the expanded stratum; the visitor can still change it.
  const [lastFocus, setLastFocus] = useState(focus);
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus !== undefined) choose(focus);
  }
  const notes = strataNotes();
  const when = month ? monthYear(month, "short") : null;
  const orbit = useRef<StrataOrbit>(defaultOrbit());
  const elements = useRef(new Map<string, Element>());
  const register = useCallback(
    (key: string) => (node: Element | null) => {
      if (node) elements.current.set(key, node);
      else elements.current.delete(key);
    },
    [],
  );
  const surface = useMemo(
    () => surfaceImage(place.lat, place.lon),
    [place.lat, place.lon],
  );
  const open = (id: string) =>
    controls.find((control) => control.id === id)?.visible ?? false;
  const sceneLayers: SceneLayer[] = controls.map((control) => ({
    id: control.id,
    visible: control.visible,
    opacity: control.opacity,
    value: intensities[control.id] ?? 0,
    hasData: available[control.id] ?? false,
  }));
  const openCount = controls.filter((control) => control.visible).length;

  const anchors: StrataAnchor[] = [];
  const companions: { variableId: string; key: string }[] = [];
  for (const item of strata) {
    anchors.push({ key: `label:${item.id}`, stratum: item.id, spot: null });
    const shown = variablesOf(item.id).filter(open);
    shown.forEach((variableId, index) => {
      const key = `companion:${variableId}`;
      anchors.push({
        key,
        stratum: item.id,
        spot: companionSpot(index, shown.length, placement),
      });
      companions.push({ variableId, key });
    });
  }

  // One pointer turns the stack; two (a pinch on a touch screen) zoom it.
  // The pointers stay in a map while they are down, so a second finger
  // takes over from the rotation without a jump.
  // A finger that lands on a label or a figure (not on the picture itself)
  // only counts towards a pinch: it never turns the stack.
  const pointers = useRef(
    new Map<number, { x: number; y: number; turns: boolean }>(),
  );
  const drag = (
    event: React.PointerEvent<HTMLElement>,
    turns: boolean = true,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const active = pointers.current;
    active.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      turns,
    });
    const spread = () => {
      const [a, b] = [...active.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const move = (next: PointerEvent) => {
      const last = active.get(next.pointerId);
      if (!last) return;
      const view = orbit.current;
      if (active.size >= 2) {
        const before = spread();
        active.set(next.pointerId, {
          ...last,
          x: next.clientX,
          y: next.clientY,
        });
        view.zoom = pinchZoom(view.zoom, before, spread());
        return;
      }
      if (last.turns) {
        view.azimuth -= (next.clientX - last.x) * 0.008;
        view.depression = clampDepression(
          view.depression + (next.clientY - last.y) * 0.005,
        );
      }
      active.set(next.pointerId, { ...last, x: next.clientX, y: next.clientY });
    };
    const stop = (end: PointerEvent) => {
      if (end.pointerId !== event.pointerId) return;
      active.delete(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  // Back to the view the layer view opened with, no layer expanded.
  const resetView = () => {
    orbit.current = defaultOrbit();
    choose(null);
  };
  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const view = orbit.current;
    const rect = event.currentTarget.getBoundingClientRect();
    view.zoom = clampZoom(view.zoom * Math.exp(event.deltaY * 0.0012));
    view.pointerFraction =
      (event.clientY - rect.top) / Math.max(1, rect.height);
  };

  const chosen = selected ? stratum(selected) : undefined;
  // The companion's sentence shows while its layer is still switched on and
  // its stratum is the one expanded.
  const spoken =
    speaking &&
    chosen &&
    open(speaking) &&
    strataAssignments.some(
      (row) => row.variableId === speaking && row.stratum === chosen.id,
    )
      ? speaking
      : null;
  const sentence = useMemo(
    () =>
      spoken && series && locationId
        ? (companionTexts({
            series,
            month,
            locationId,
            locationName: place.nameEn,
            aggregation,
            trends: trendsFile,
            voice,
          }).lines[spoken] ?? null)
        : null,
    [
      spoken,
      series,
      month,
      locationId,
      place.nameEn,
      aggregation,
      trendsFile,
      voice,
    ],
  );
  const beside = placement === "beside";
  // Escape folds the expanded layer, or leaves the layer view when none is
  // expanded. A menu or the tour that is open takes the key first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || closing) return;
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        !active.closest(".strata, .app > .hud")
      ) {
        return;
      }
      if (document.querySelector(".guide-tour")) return;
      if (selected) choose(null);
      else onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Up and down arrows move the focus between the layer labels.
  const arrowBetweenLayers = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const labels = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(".strata-label"),
    ];
    const at = labels.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    labels[
      nextLayerIndex(labels.length, at, event.key === "ArrowUp" ? "up" : "down")
    ]?.focus();
  };
  const arriving = selected
    ? strataAssignments.filter((row) => row.flowsTo === selected)
    : [];

  return (
    <section
      className={closing ? "strata strata-closing" : "strata"}
      aria-label={t("strata.title")}
      onKeyDown={arrowBetweenLayers}
      onPointerDown={(event) => {
        const target = event.target as Element;
        if (event.pointerType !== "touch") return;
        // On the picture the canvas handles it; the panels scroll by
        // themselves; a label or a figure may be the second finger.
        if (target.closest(".strata-canvas, .strata-detail, .strata-header"))
          return;
        if (target.closest(".strata-labelbar, .strata-reset")) return;
        drag(event, false);
      }}
    >
      <div
        className="strata-canvas"
        onPointerDown={(event) => drag(event, true)}
        onWheel={wheel}
        onDoubleClick={resetView}
      >
        <Canvas
          camera={{ position: [0, 3.4, 0.3], fov: FOV_DEG, near: 0.1, far: 80 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "low-power" }}
          onPointerMissed={() => choose(null)}
        >
          <StrataScene
            layers={sceneLayers}
            selected={selected}
            closing={closing}
            orbit={orbit}
            anchors={anchors}
            elements={elements}
            surface={surface}
            chartOpen={chartOpen}
            placement={placement}
            onSelect={choose}
            onClosed={onClosed}
          />
        </Canvas>
      </div>
      <div
        className={
          fit.tier
            ? `strata-overlay strata-beside strata-tier-${fit.tier.id}`
            : "strata-overlay"
        }
      >
        {beside ? (
          // One thin line per stratum from the platform's right edge to its
          // row of companions; StrataScene sets the ends every frame.
          <svg className="strata-links" aria-hidden="true">
            {strata.map((item) => (
              <line
                key={item.id}
                ref={register(`link:${item.id}`)}
                stroke={item.color}
                visibility="hidden"
                className={
                  selected && selected !== item.id ? "strata-dim" : undefined
                }
              />
            ))}
          </svg>
        ) : null}
        <div className="strata-labelbar">
          {strata.map((item) => (
            <button
              key={item.id}
              type="button"
              ref={register(`label:${item.id}`)}
              className={
                selected ? "strata-label strata-hidden" : "strata-label"
              }
              style={{ borderLeftColor: item.color }}
              aria-pressed={selected === item.id}
              onClick={() => choose(selected === item.id ? null : item.id)}
            >
              <span className="strata-label-head">
                <strong>{stratumName(item.id)}</strong>
                {stratumHeight(item.id) ? (
                  <span className="strata-height">
                    {stratumHeight(item.id)}
                  </span>
                ) : null}
              </span>
              {variablesOf(item.id).map((variableId) => (
                <span
                  key={variableId}
                  className={
                    open(variableId)
                      ? "strata-value"
                      : "strata-value strata-off"
                  }
                >
                  <span className="strata-value-name">
                    {nameOf(variableId)}
                  </span>
                  <b>
                    <UnitText text={readings[variableId] ?? ""} />
                  </b>
                </span>
              ))}
            </button>
          ))}
        </div>
        {companions.map(({ variableId, key }) => {
          const assignment = strataAssignments.find(
            (row) => row.variableId === variableId,
          );
          const signal = signals?.[variableId];
          const info = { name: nameOf(variableId) };
          return (
            <button
              key={key}
              type="button"
              ref={register(key)}
              className={
                selected && assignment && selected !== assignment.stratum
                  ? "strata-companion strata-dim"
                  : "strata-companion"
              }
              aria-label={`${info.name}: ${readings[variableId] ?? ""}`}
              aria-pressed={spoken === variableId}
              title={`${info.name}: ${readings[variableId] ?? ""}`}
              onClick={() => {
                if (!assignment) return;
                setSelected(assignment.stratum);
                setSpeaking(variableId);
              }}
            >
              <CompanionSlot
                variableId={variableId}
                value={
                  available[variableId] ? (intensities[variableId] ?? 0) : null
                }
                anomalyZ={anomalyZ?.[variableId] ?? null}
                signal={signal}
                size={fit.tier ? fit.tier.figure : ON_PLATFORM_SIZE}
              />
              {beside ? (
                <span className="strata-companion-caption" aria-hidden="true">
                  <span>{info.name}</span>
                  <b>
                    <UnitText text={readings[variableId] ?? ""} />
                  </b>
                </span>
              ) : (
                // On a platform the name shows on hover or keyboard focus
                // only: the left column already lists every variable.
                <span className="strata-companion-name">{info.name}</span>
              )}
            </button>
          );
        })}
      </div>
      <header className="strata-header" ref={register("header")}>
        <p className="strata-title">
          {t("strata.title")} · {place.nameEn}
          {month ? ` · ${month.slice(0, 7)}` : ""}
          <button type="button" onClick={onExit} disabled={closing}>
            {t("strata.back")}
          </button>
        </p>
        {openCount === 0 ? <p>{t("strata.noLayer")}</p> : null}

        <details open={notesOpen}>
          <summary>
            {notes[0]} {t("strata.about")}
          </summary>
          <p>
            {notes[1]} {notes[2]} {t("strata.controls")}
          </p>
        </details>
      </header>
      <button type="button" className="strata-reset" onClick={resetView}>
        {t("strata.reset")}
      </button>
      {chosen ? (
        <aside
          className="strata-detail"
          aria-label={t("strata.valuesAria", { name: stratumName(chosen.id) })}
        >
          <header>
            <div>
              <h2>{stratumName(chosen.id)}</h2>
              {stratumHeight(chosen.id) ? (
                <p>{stratumHeight(chosen.id)}</p>
              ) : null}
            </div>
            <button type="button" onClick={() => choose(null)}>
              {t("common.action.close")}
            </button>
          </header>
          <p className="strata-detail-note">
            {t("strata.valuesAt", {
              where: when
                ? t("places.placeMonth", { place: place.nameEn, month: when })
                : place.nameEn,
            })}{" "}
            {notes[0]}
          </p>
          {sentence ? (
            <p className="strata-companion-line" aria-live="polite">
              {sentence}
            </p>
          ) : null}
          <ul>
            {variablesOf(chosen.id).map((variableId) => {
              const assignment = strataAssignments.find(
                (row) => row.variableId === variableId,
              );
              const trend = trends?.[variableId];
              const signal = signals?.[variableId];
              return (
                <li key={variableId}>
                  <p className="strata-detail-name">
                    <span>{nameOf(variableId)}</span>
                    {signal ? <TrendMarkIcon signal={signal} /> : null}
                    <b>
                      <UnitText text={readings[variableId] ?? ""} />
                    </b>
                  </p>
                  <TrendBlock
                    variableId={variableId}
                    trend={trend}
                    signal={signal}
                  />
                  {assignment?.columnTotal ? (
                    <p className="strata-detail-note">{columnTotalNote()}</p>
                  ) : null}
                  {assignment?.flowsTo ? (
                    <p className="strata-detail-note">
                      {flowNote(assignment.stratum, assignment.flowsTo)}
                    </p>
                  ) : null}
                  {open(variableId) ? null : (
                    <p className="strata-detail-note">{t("strata.off")}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {arriving.map((row) => (
            <p key={row.variableId} className="strata-detail-note">
              {t("strata.listedUnder", {
                name: nameOf(row.variableId),
                stratum: stratumName(row.stratum),
              })}{" "}
              {flowNote(row.stratum, chosen.id)}
            </p>
          ))}
        </aside>
      ) : null}
    </section>
  );
}
