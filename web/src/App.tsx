import { useMemo, useState } from "react";
import {
  loadTrends,
  summarizeTrend,
  trendKey,
  type TrendSummary,
} from "./analysis/trends";
import { CloseUpPanel } from "./closeup/CloseUpPanel";
import { CompanionDock } from "./companions/CompanionDock";
import { monthlyAnomaly } from "./companions/companionData";
import { useAnalysisFile } from "./analysis/useAnalysisFile";
import {
  trendArrowDirection,
  trendMark,
  trendSignal,
  type TrendSignal,
} from "./forms/encoding";
import {
  guideDismissed,
  rememberGuideDismissed,
  showGuideAtStart,
  startingLayers,
} from "./guide/firstVisit";
import { GuideCard } from "./guide/GuideCard";
import { LayerPanel, type LayerControl } from "./layers/LayerPanel";
import { initialLayerVisibility, layerRegistry } from "./layers/registry";
import { mockLocations } from "./mock/snapshot";
import { EarthCanvas } from "./scene/EarthCanvas";
import { FpsReadout } from "./scene/FpsReadout";
import { rendererLabel, type RendererKind } from "./scene/rendererLabel";
import {
  bestDefaultMonth,
  formatMeasurement,
  intensityAt,
  sortedMonths,
  valueAt,
} from "./snapshot/reading";
import {
  usePlaceSnapshot,
  type SnapshotState,
} from "./snapshot/usePlaceSnapshot";
import { StrataApproach } from "./strata/StrataApproach";
import { StrataHint, StrataView } from "./strata/StrataView";
import { useStrataMode } from "./strata/useStrataMode";
import { TimelineProvider, useTimeline } from "./timeline/TimelineContext";
import { TimelineDock } from "./timeline/TimelineDock";
import { useTrendMap } from "./trendmap/useTrendMap";
import {
  DEFAULT_OVERLAY_OPACITY,
  TREND_MAP_VARIABLES,
  trendMapVariable,
} from "./trendmap/trendMapConfig";
import { TrendMapLegend } from "./trendmap/TrendMapLegend";
import {
  requestedCloseUp,
  requestedPlace,
  requestedStrata,
  requestedTrendMap,
} from "./urlParams";

const search = typeof window === "undefined" ? "" : window.location.search;
// The layers the address lists, or the first-visit defaults when it sets
// nothing (web/src/guide/firstVisit.ts).
const askedLayers = startingLayers(search);
const initialControls: LayerControl[] = layerRegistry.map((layer) => ({
  id: layer.id,
  visible: askedLayers
    ? askedLayers.includes(layer.id)
    : initialLayerVisibility(layer.id),
  opacity: 0.75,
}));
const initialTrendMap = trendMapVariable(requestedTrendMap())?.id ?? null;
const askedPlace = requestedPlace();
const initialLocation =
  mockLocations.find((item) => item.id === askedPlace)?.id ?? "taichung";

// Loads the snapshot and owns the place; the month, playback and the charted
// variable live in the timeline context (web/src/timeline/TimelineContext.tsx)
// so every panel reads the same month.
export function App() {
  const [locationId, setLocationId] = useState(initialLocation);
  const snapshot = usePlaceSnapshot();
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const { months, defaultMonth } = useMemo(() => {
    const groups = (data?.series ?? [])
      .filter((item) => item.locationId === locationId)
      .map((item) => item.points);
    return {
      months: sortedMonths(groups),
      defaultMonth: bestDefaultMonth(groups),
    };
  }, [data, locationId]);
  return (
    <TimelineProvider
      months={months}
      defaultMonth={defaultMonth}
      locationId={locationId}
    >
      <AppView
        snapshot={snapshot}
        locationId={locationId}
        setLocationId={setLocationId}
      />
    </TimelineProvider>
  );
}

function AppView({
  snapshot,
  locationId,
  setLocationId,
}: {
  snapshot: SnapshotState;
  locationId: string;
  setLocationId: (id: string) => void;
}) {
  const timeline = useTimeline();
  const [forceWebGL, setForceWebGL] = useState(false);
  const [flying, setFlying] = useState(false);
  const [kind, setKind] = useState<RendererKind>("webgl");
  // Layer view (web/src/strata): one block of state, one block of JSX below.
  const strata = useStrataMode(requestedStrata());
  const [nearGround, setNearGround] = useState(false);
  const [controls, setControls] = useState(initialControls);
  const [closeUpId, setCloseUpId] = useState<string | null>(requestedCloseUp);
  const [trendMapId, setTrendMapId] = useState<string | null>(initialTrendMap);
  const [trendMapOpacity, setTrendMapOpacity] = useState(
    DEFAULT_OVERLAY_OPACITY,
  );
  const trendMap = useTrendMap(trendMapId);
  // Start card (web/src/guide): opens by itself on a first visit, and from
  // the "? Guide" button. Opening another left-hand panel puts it away.
  const [guideOpen, setGuideOpen] = useState(() =>
    showGuideAtStart(search, guideDismissed()),
  );
  const closeGuide = () => {
    rememberGuideDismissed();
    setGuideOpen(false);
  };
  const enterStrata = () => {
    setGuideOpen(false);
    strata.enter();
  };
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const location =
    data?.places.find((item) => item.id === locationId) ??
    mockLocations.find((item) => item.id === locationId);
  const here =
    data?.series.filter((item) => item.locationId === locationId) ?? [];
  const months = timeline.months;
  const activeMonth = timeline.month;
  const intensities: Record<string, number> = {};
  const available: Record<string, boolean> = {};
  const readings: Record<string, string> = {};
  const kelvins: Record<string, number | null> = {};
  for (const layer of layerRegistry) {
    const series = here.find((item) => item.variableId === layer.id);
    if (snapshot.status === "loading") {
      readings[layer.id] = "Loading…";
      intensities[layer.id] = 0;
    } else if (!series || !activeMonth) {
      readings[layer.id] =
        snapshot.status === "error"
          ? "Could not read the snapshot"
          : "Not in this snapshot";
      intensities[layer.id] = 0;
    } else {
      readings[layer.id] = formatMeasurement(
        valueAt(series.points, activeMonth),
        series.unit,
      );
      intensities[layer.id] = intensityAt(series.points, activeMonth);
      available[layer.id] = valueAt(series.points, activeMonth) !== null;
      kelvins[layer.id] =
        series.unit === "K" ? valueAt(series.points, activeMonth) : null;
    }
  }
  const closeUpLayer = layerRegistry.find((layer) => layer.id === closeUpId);
  const snapshotDay = data?.generatedAt.slice(0, 10);
  const trendsFile = useAnalysisFile(loadTrends);
  let trends: Record<string, TrendSummary | null> | undefined;
  let signals: Record<string, TrendSignal> | undefined;
  const trendDirections: Record<string, number> = {};
  if (trendsFile.status === "ready") {
    trends = {};
    signals = {};
    for (const layer of layerRegistry) {
      const entry =
        trendsFile.data.series[trendKey(layer.id, locationId, "point")];
      trends[layer.id] = summarizeTrend(
        entry,
        trendsFile.data.parameters.alpha,
      );
      const signal = trendSignal(entry);
      signals[layer.id] = signal;
      trendDirections[layer.id] = trendArrowDirection(signal);
    }
  }

  return (
    <div className="app">
      <EarthCanvas
        forceWebGL={forceWebGL}
        flying={flying}
        layers={controls}
        intensities={intensities}
        available={available}
        trendDirections={trendDirections}
        trendMap={trendMap.status === "ready" ? trendMap.map : null}
        trendMapOpacity={trendMapOpacity}
        places={data?.places ?? []}
        locationId={locationId}
        onKind={setKind}
        onFlyDone={() => setFlying(false)}
        onSelectLocation={setLocationId}
        paused={strata.shown}
        controlsLocked={strata.phase !== "off"}
      >
        {location ? (
          <StrataApproach
            phase={strata.phase}
            lat={location.lat}
            lon={location.lon}
            onArrive={strata.onArrive}
            onReturn={strata.onReturn}
            onNear={setNearGround}
          />
        ) : null}
      </EarthCanvas>
      {strata.shown && location ? (
        <StrataView
          closing={strata.phase === "closing"}
          onClosed={strata.onClosed}
          onExit={strata.exit}
          place={location}
          month={activeMonth}
          controls={controls}
          readings={readings}
          intensities={intensities}
          available={available}
          anomalyZ={Object.fromEntries(
            here.map((item) => [
              item.variableId,
              activeMonth
                ? (monthlyAnomaly(item.points, activeMonth)?.z ?? null)
                : null,
            ]),
          )}
          trends={trends}
          signals={signals}
        />
      ) : null}
      {strata.phase === "off" && nearGround && location ? (
        <StrataHint placeName={location.nameEn} onEnter={enterStrata} />
      ) : null}
      <div className="hud hud-main">
        <button
          type="button"
          className="hud-guide"
          aria-pressed={guideOpen}
          aria-label="Guide: how to start and how to read this"
          onClick={() => (guideOpen ? closeGuide() : setGuideOpen(true))}
        >
          ? <span>Guide</span>
        </button>
        <button
          type="button"
          onClick={strata.phase === "off" ? enterStrata : strata.exit}
          disabled={strata.phase === "closing" || strata.phase === "return"}
          aria-pressed={strata.phase !== "off"}
        >
          {strata.phase === "off" ? "Layer view" : "Back to the globe"}
        </button>
        <label>
          <span>Global trend map</span>
          <select
            value={trendMapId ?? ""}
            aria-label="Global trend map"
            onChange={(event) => {
              setGuideOpen(false);
              setTrendMapId(event.target.value || null);
            }}
          >
            <option value="">{"Trend map: off"}</option>
            {TREND_MAP_VARIABLES.map((variable) => (
              <option key={variable.id} value={variable.id}>
                {variable.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="hud-fly"
          onClick={() => setFlying(true)}
          disabled={flying || strata.phase !== "off"}
        >
          Fly to Taiwan
        </button>
        {/* Secondary pages and the renderer diagnostics. */}
        <details className="hud-more">
          <summary>More</summary>
          <div className="hud-menu">
            <a href={`${import.meta.env.BASE_URL}compare/`}>
              Model vs observation
            </a>
            <a href={`${import.meta.env.BASE_URL}mining/`}>Data mining</a>
            <a href={`${import.meta.env.BASE_URL}lab/`}>Form lab</a>
            <div className="hud-debug">
              <p className="badge">Renderer: {rendererLabel(kind)}</p>
              <FpsReadout />
              <button
                type="button"
                onClick={() => setForceWebGL((value) => !value)}
              >
                {forceWebGL ? "Use automatic renderer" : "Force WebGL"}
              </button>
            </div>
          </div>
        </details>
      </div>
      {guideOpen ? <GuideCard onClose={closeGuide} /> : null}
      <LayerPanel
        layers={layerRegistry}
        controls={controls}
        readings={readings}
        trends={trends}
        signals={signals}
        locationName={location?.nameEn ?? locationId}
        months={months}
        month={activeMonth}
        onMonth={timeline.setMonth}
        onToggle={(id) =>
          setControls((current) =>
            current.map((layer) =>
              layer.id === id ? { ...layer, visible: !layer.visible } : layer,
            ),
          )
        }
        onOpacity={(id, opacity) =>
          setControls((current) =>
            current.map((layer) =>
              layer.id === id ? { ...layer, opacity } : layer,
            ),
          )
        }
        onCloseUp={(id) => {
          setGuideOpen(false);
          setCloseUpId(id);
        }}
        chartId={timeline.selectedVariableId}
        onChart={(id) => {
          setGuideOpen(false);
          timeline.setSelectedVariableId(id);
        }}
      />
      <TimelineDock
        series={here}
        variables={layerRegistry}
        visibleIds={controls
          .filter((layer) => layer.visible)
          .map((layer) => layer.id)}
        locationName={location?.nameEn ?? locationId}
        trends={trendsFile}
      />
      <CompanionDock
        compact={strata.shown}
        visibleIds={controls
          .filter((layer) => layer.visible)
          .map((layer) => layer.id)}
        series={here}
        locationId={locationId}
        locationName={location?.nameEn ?? locationId}
        trends={trendsFile.status === "ready" ? trendsFile.data : null}
      />
      <TrendMapLegend
        state={trendMap}
        opacity={trendMapOpacity}
        onOpacity={setTrendMapOpacity}
      />
      {closeUpLayer ? (
        <CloseUpPanel
          variableId={closeUpLayer.id}
          variableName={`${closeUpLayer.nameEn} at ${location?.nameEn ?? locationId}, ${activeMonth?.slice(0, 7) ?? ""}`}
          value={intensities[closeUpLayer.id] ?? 0}
          reading={readings[closeUpLayer.id] ?? ""}
          kelvin={kelvins[closeUpLayer.id] ?? null}
          trendLabel={
            signals?.[closeUpLayer.id]
              ? trendMark(signals[closeUpLayer.id]).label.toLowerCase()
              : undefined
          }
          onClose={() => setCloseUpId(null)}
        />
      ) : null}
      <p className="credit">
        Surface: Blue Marble,{" "}
        <a href="https://visibleearth.nasa.gov/images/57730/blue-marble-land-surface-ocean-color-sea-ice-and-clouds">
          NASA Visible Earth
        </a>
        . Closer Taiwan view: Blue Marble shaded relief,{" "}
        <a href="https://gibs.earthdata.nasa.gov/">NASA GIBS</a>.
        {snapshotDay ? ` Snapshot ${snapshotDay}.` : ""} NASA insignia is not
        used.
      </p>
    </div>
  );
}
