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
import { CompanionSlot } from "./companionSlot";
import "./strata.css";
import {
  clampDepression,
  clampZoom,
  companionPlacement,
  DEFAULT_AZIMUTH,
  DEFAULT_DEPRESSION,
  FOV_DEG,
  MEDIUM_WIDTH,
} from "./strataCamera";
import { companionSpot, type CompanionPlacement } from "./strataLayout";
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
function useCompanionPlacement(chartOpen: boolean): CompanionPlacement {
  const measure = useCallback(
    () =>
      typeof window === "undefined"
        ? "on"
        : companionPlacement(window.innerWidth, window.innerHeight, chartOpen),
    [chartOpen],
  );
  const [placement, setPlacement] = useState<CompanionPlacement>(measure);
  useEffect(() => {
    const update = () => setPlacement(measure());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [measure]);
  return placement;
}

// Size of a companion figure: larger beside the stack, where its name and
// value are written under it.
const BESIDE_SIZE = 60;
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
  const placement = useCompanionPlacement(chartOpen);
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
  // A tour step moves the expanded stratum; the visitor can still change it.
  const [lastFocus, setLastFocus] = useState(focus);
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus !== undefined) setSelected(focus);
  }
  const notes = strataNotes();
  const when = month ? monthYear(month, "short") : null;
  const orbit = useRef<StrataOrbit>({
    azimuth: DEFAULT_AZIMUTH,
    depression: DEFAULT_DEPRESSION,
    zoom: 1,
    pointerFraction: 0.5,
  });
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

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    let lastX = event.clientX;
    let lastY = event.clientY;
    const move = (next: PointerEvent) => {
      const view = orbit.current;
      view.azimuth -= (next.clientX - lastX) * 0.008;
      view.depression = clampDepression(
        view.depression + (next.clientY - lastY) * 0.005,
      );
      lastX = next.clientX;
      lastY = next.clientY;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const view = orbit.current;
    const rect = event.currentTarget.getBoundingClientRect();
    view.zoom = clampZoom(view.zoom * Math.exp(event.deltaY * 0.0012));
    view.pointerFraction =
      (event.clientY - rect.top) / Math.max(1, rect.height);
  };

  const chosen = selected ? stratum(selected) : undefined;
  const spoken =
    speaking &&
    chosen &&
    strataAssignments.some(
      (row) => row.variableId === speaking && row.stratum === chosen.id,
    )
      ? speaking
      : null;
  const sentence =
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
      : null;
  const beside = placement === "beside";
  const arriving = selected
    ? strataAssignments.filter((row) => row.flowsTo === selected)
    : [];

  return (
    <section
      className={closing ? "strata strata-closing" : "strata"}
      aria-label={t("strata.title")}
    >
      <div className="strata-canvas" onPointerDown={drag} onWheel={wheel}>
        <Canvas
          camera={{ position: [0, 3.4, 0.3], fov: FOV_DEG, near: 0.1, far: 80 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "low-power" }}
          onPointerMissed={() => setSelected(null)}
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
            onSelect={setSelected}
            onClosed={onClosed}
          />
        </Canvas>
      </div>
      <div
        className={beside ? "strata-overlay strata-beside" : "strata-overlay"}
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
        {strata.map((item) => (
          <button
            key={item.id}
            type="button"
            ref={register(`label:${item.id}`)}
            className={selected ? "strata-label strata-hidden" : "strata-label"}
            style={{ borderLeftColor: item.color }}
            aria-pressed={selected === item.id}
            onClick={() => setSelected(selected === item.id ? null : item.id)}
          >
            <span className="strata-label-head">
              <strong>{stratumName(item.id)}</strong>
              {stratumHeight(item.id) ? (
                <span className="strata-height">{stratumHeight(item.id)}</span>
              ) : null}
            </span>
            {variablesOf(item.id).map((variableId) => (
              <span
                key={variableId}
                className={
                  open(variableId) ? "strata-value" : "strata-value strata-off"
                }
              >
                <span className="strata-value-name">{nameOf(variableId)}</span>
                <b>{readings[variableId] ?? ""}</b>
              </span>
            ))}
          </button>
        ))}
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
                size={beside ? BESIDE_SIZE : ON_PLATFORM_SIZE}
              />
              {beside ? (
                <span className="strata-companion-caption" aria-hidden="true">
                  <span>{info.name}</span>
                  <b>{readings[variableId] ?? ""}</b>
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
            <button type="button" onClick={() => setSelected(null)}>
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
                    <b>{readings[variableId] ?? ""}</b>
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

// Offered once the user has zoomed in on the globe; never switches by itself.
export function StrataHint({
  placeName,
  onEnter,
}: {
  placeName: string;
  onEnter: () => void;
}) {
  const { t } = useI18n();
  return (
    <button type="button" className="strata-hint" onClick={onEnter}>
      {t("strata.hint", { place: placeName })}
    </button>
  );
}
