// The layer view: its own canvas over the globe (the globe is paused under
// it), with HTML labels, companions, a legend and the panel of an expanded
// stratum. Numbers and wording come from the layer panel's data unchanged;
// nothing is computed or interpreted here.
import { Canvas } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState } from "react";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import type { TrendSummary } from "../analysis/trends";
import {
  trendArrowDirection,
  trendMark,
  type TrendSignal,
} from "../forms/encoding";
import type { LayerControl } from "../layers/LayerPanel";
import { layerRegistry } from "../layers/registry";
import { CompanionSlot } from "./companionSlot";
import "./strata.css";
import {
  clampDepression,
  clampZoom,
  DEFAULT_AZIMUTH,
  DEFAULT_DEPRESSION,
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
  COLUMN_TOTAL_NOTE,
  flowNote,
  strata,
  strataAssignments,
  STRATA_NOTES,
  stratum,
  variablesOf,
  type StratumId,
} from "./strataSpec";
import { surfaceImage } from "./surfaceCrop";
import { useChartOpen, useCurrentMonth } from "./useCurrentMonth";

type StrataViewProps = {
  closing: boolean;
  onClosed: () => void;
  onExit: () => void;
  place: { nameEn: string; lat: number; lon: number };
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
};

function nameOf(variableId: string): string {
  return (
    layerRegistry.find((layer) => layer.id === variableId)?.nameEn ?? variableId
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
}: StrataViewProps) {
  const month = useCurrentMonth(appMonth);
  const chartOpen = useChartOpen();
  // The three notes of the legend start open where there is room for them
  // beside the six labels (a tall, wide window).
  const [notesOpen] = useState(
    () =>
      typeof window === "undefined" ||
      (window.innerWidth > MEDIUM_WIDTH && window.innerHeight >= 800),
  );
  const [selected, setSelected] = useState<StratumId | null>(null);
  const orbit = useRef<StrataOrbit>({
    azimuth: DEFAULT_AZIMUTH,
    depression: DEFAULT_DEPRESSION,
    zoom: 1,
    pointerFraction: 0.5,
  });
  const elements = useRef(new Map<string, HTMLElement>());
  const register = useCallback(
    (key: string) => (node: HTMLElement | null) => {
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
        spot: companionSpot(index, shown.length),
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
  const arriving = selected
    ? strataAssignments.filter((row) => row.flowsTo === selected)
    : [];

  return (
    <section
      className={closing ? "strata strata-closing" : "strata"}
      aria-label="Layer view"
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
            onSelect={setSelected}
            onClosed={onClosed}
          />
        </Canvas>
      </div>
      <div className="strata-overlay">
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
              <strong>{item.nameEn}</strong>
              {item.heightEn ? (
                <span className="strata-height">{item.heightEn}</span>
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
              title={`${info.name}: ${readings[variableId] ?? ""}`}
              onClick={() => assignment && setSelected(assignment.stratum)}
            >
              <CompanionSlot
                variableId={variableId}
                value={
                  available[variableId] ? (intensities[variableId] ?? 0) : null
                }
                anomalyZ={anomalyZ?.[variableId] ?? null}
                trend={trendArrowDirection(signal)}
                significant={
                  signal?.state === "rising" || signal?.state === "falling"
                }
                size={40}
              />
              {/* The name shows on hover or keyboard focus only: the left
                  column already lists every variable and its value. */}
              <span className="strata-companion-name">{info.name}</span>
            </button>
          );
        })}
      </div>
      <header className="strata-header" ref={register("header")}>
        <p className="strata-title">
          Layer view · {place.nameEn}
          {month ? ` · ${month.slice(0, 7)}` : ""}
          <button type="button" onClick={onExit} disabled={closing}>
            Back to the globe
          </button>
        </p>
        {openCount === 0 ? (
          <p>
            No layer is switched on: tick one in the Layers panel to see it
            here.
          </p>
        ) : null}
        <details open={notesOpen}>
          <summary>{STRATA_NOTES[0]} About this view</summary>
          <p>
            {STRATA_NOTES.slice(1).join(" ")} Drag to turn, scroll to zoom,
            click a layer for its numbers.
          </p>
        </details>
      </header>
      {chosen ? (
        <aside className="strata-detail" aria-label={`${chosen.nameEn} values`}>
          <header>
            <div>
              <h2>{chosen.nameEn}</h2>
              {chosen.heightEn ? <p>{chosen.heightEn}</p> : null}
            </div>
            <button type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </header>
          <p className="strata-detail-note">
            Values at {place.nameEn}
            {month ? `, ${month.slice(0, 7)}` : ""}. {STRATA_NOTES[0]}
          </p>
          <ul>
            {variablesOf(chosen.id).map((variableId) => {
              const assignment = strataAssignments.find(
                (row) => row.variableId === variableId,
              );
              const trend = trends?.[variableId];
              const signal = signals?.[variableId];
              const mark = signal ? trendMark(signal) : null;
              const caveat = trend ? trendCaveat(variableId) : null;
              return (
                <li key={variableId}>
                  <p className="strata-detail-name">
                    <span>{nameOf(variableId)}</span>
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
                    <b>{readings[variableId] ?? ""}</b>
                  </p>
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
                  {assignment?.columnTotal ? (
                    <p className="strata-detail-note">{COLUMN_TOTAL_NOTE}</p>
                  ) : null}
                  {assignment?.flowsTo ? (
                    <p className="strata-detail-note">
                      {flowNote(assignment.stratum, assignment.flowsTo)}
                    </p>
                  ) : null}
                  {open(variableId) ? null : (
                    <p className="strata-detail-note">
                      Switched off in the Layers panel; no particles drawn.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {arriving.map((row) => (
            <p key={row.variableId} className="strata-detail-note">
              {nameOf(row.variableId)} is listed under &quot;
              {stratum(row.stratum)?.nameEn}&quot;.{" "}
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
  return (
    <button type="button" className="strata-hint" onClick={onEnter}>
      Enter layer view at {placeName}
    </button>
  );
}
