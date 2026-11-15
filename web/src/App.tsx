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
import { particleNote } from "./guide/particleNote";
import { LayerPanel, type LayerControl } from "./layers/LayerPanel";
import { initialLayerVisibility, layerRegistry } from "./layers/registry";
import { mockLocations, taiwanOverview } from "./mock/snapshot";
import { compareLinksFor, loadModelVsObs } from "./analysis/modelVsObs";
import { EarthCanvas } from "./scene/EarthCanvas";
import type { FlyTarget } from "./scene/FlyCamera";
import { FpsReadout } from "./scene/FpsReadout";
import { rendererLabel, type RendererKind } from "./scene/rendererLabel";
import { startLongitudeShift } from "./scene/startView";
import { worldCityFrame } from "./scene/worldCityFrame";
import {
  bestDefaultMonth,
  formatMeasurement,
  intensityAt,
  sortedMonths,
  valueAt,
} from "./snapshot/reading";
import {
  hasCoordinates,
  NO_DATA_AT_PLACE,
  placeNote,
  resolvePlaceId,
  type Place,
} from "./snapshot/places";
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
// ?at=<place id>. The id is checked against the catalogs once they are
// read (resolvePlaceId); until then it is kept as asked.
const askedPlace = requestedPlace();
const initialLocation = resolvePlaceId(askedPlace, []);
// Camera distances from the Earth's center: the Taiwan overview, and the
// wider view a place picked from the menu is shown at.
const TAIWAN_FLY_DISTANCE = 1.85;
const PLACE_FLY_DISTANCE = 2.3;
// The whole globe in view: the distance the camera is created at
// (EarthCanvas). A page that opens at a Taiwan place starts here.
const START_DISTANCE = 3.2;
// Before the catalogs are read, the five Taiwan places stand in.
const fallbackPlaces: Place[] = mockLocations.map((item) => ({
  ...item,
  group: "taiwan",
  aggregation: "point",
}));

// One target object per place. A world city slides to the center of the
// globe, a little closer than the whole-Earth view. A Taiwan place is
// already framed when the page opens (no slide), shifted east on medium
// windows so it is not behind the Companions panel.
function useOpeningFlight(
  group: string | undefined,
  lat: number | null,
  lon: number | null,
  strata: boolean,
): FlyTarget | null {
  return useMemo(() => {
    if (strata || group === undefined || lat === null || lon === null) {
      return null;
    }
    const city = worldCityFrame({ group, lat, lon }, PLACE_FLY_DISTANCE);
    if (city) return city;
    if (group !== "taiwan") return null;
    return {
      lat,
      lon:
        lon +
        startLongitudeShift(
          window.innerWidth,
          window.innerHeight,
          START_DISTANCE,
          lat,
        ),
      distance: START_DISTANCE,
      instant: true,
    };
  }, [group, lat, lon, strata]);
}

// Loads the snapshot and owns the place; the month, playback and the charted
// variable live in the timeline context (web/src/timeline/TimelineContext.tsx)
// so every panel reads the same month.
export function App() {
  const [chosenId, setLocationId] = useState(initialLocation);
  const snapshot = usePlaceSnapshot(chosenId);
  const data = snapshot.status === "ready" ? snapshot.data : null;
  // The catalogs decide which ids exist; an unknown ?at= falls back.
  const locationId = resolvePlaceId(chosenId, data?.places ?? []);
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
  const [askedFlight, setFlyTarget] = useState<FlyTarget | null>(null);
  const [startDone, setStartDone] = useState(false);
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
  const places = data?.places ?? fallbackPlaces;
  const place = places.find((item) => item.id === locationId);
  // The place as a point on the globe; undefined for the global mean, which
  // has no marker, no camera flight and no layer view.
  const location = hasCoordinates(place) ? place : undefined;
  const placeName = place?.nameEn ?? locationId;
  const aggregation = place?.aggregation ?? "point";
  // Series of a world place are read when it is picked.
  const placeLoading = !!data && !data.loaded.includes(locationId);
  const selectPlace = (id: string, fly: boolean) => {
    setLocationId(id);
    const next = places.find((item) => item.id === id);
    if (!hasCoordinates(next) || strata.phase !== "off") return;
    // A world city slides to the center and a little closer, whether it was
    // chosen from the menu or by its marker. Taiwan markers do not fly.
    const city = worldCityFrame(next, PLACE_FLY_DISTANCE);
    if (city) {
      setFlyTarget(city);
      return;
    }
    if (fly) {
      setFlyTarget({
        lat: next.lat,
        lon: next.lon,
        distance: PLACE_FLY_DISTANCE,
      });
    }
  };
  // The page opens with the camera over the selected place (the default,
  // or the one ?at= names), so the globe shows what the panels talk about.
  // A world city slides there (city on the viewing axis, slightly closer).
  // Taiwan is already there, with no slide. The global mean has no point
  // and keeps the default view; the layer view flies there by itself.
  const openingFlight = useOpeningFlight(
    place?.group,
    place?.lat ?? null,
    place?.lon ?? null,
    requestedStrata(),
  );
  const flyTarget = askedFlight ?? (startDone ? null : openingFlight);
  const flying = flyTarget !== null;
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
    if (snapshot.status === "loading" || placeLoading) {
      readings[layer.id] = "Loading…";
      intensities[layer.id] = 0;
    } else if (!series || !activeMonth) {
      readings[layer.id] =
        snapshot.status === "error"
          ? "Could not read the snapshot"
          : NO_DATA_AT_PLACE;
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
        trendsFile.data.series[trendKey(layer.id, locationId, aggregation)];
      const signal = trendSignal(entry, trendsFile.data.known_issues);
      trends[layer.id] = summarizeTrend(
        entry,
        trendsFile.data.parameters.alpha,
        signal.unreliable,
      );
      signals[layer.id] = signal;
      trendDirections[layer.id] = trendArrowDirection(signal);
    }
  }

  const pairsFile = useAnalysisFile(loadModelVsObs);
  const compareLinks =
    pairsFile.status === "ready"
      ? compareLinksFor(
          pairsFile.data.pairs,
          locationId,
          `${import.meta.env.BASE_URL}compare/`,
        )
      : undefined;

  // What the particles are, so they are not read as a global map.
  const particleLine = particleNote({
    layerNames: layerRegistry
      .filter((layer) =>
        controls.some((item) => item.id === layer.id && item.visible),
      )
      .map((layer) => layer.nameEn),
    place: placeName,
    month: activeMonth,
    trendMap: trendMap.status === "ready",
  });

  return (
    <div className="app">
      <EarthCanvas
        forceWebGL={forceWebGL}
        flyTarget={flyTarget}
        layers={controls}
        intensities={intensities}
        available={available}
        trendDirections={trendDirections}
        trendMap={trendMap.status === "ready" ? trendMap.map : null}
        trendMapOpacity={trendMapOpacity}
        places={places.filter(hasCoordinates)}
        locationId={locationId}
        onKind={setKind}
        onFlyDone={() => {
          setStartDone(true);
          setFlyTarget(null);
        }}
        onSelectLocation={(id) => selectPlace(id, false)}
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
          disabled={
            strata.phase === "closing" ||
            strata.phase === "return" ||
            (strata.phase === "off" && !location)
          }
          title={location ? undefined : "The layer view needs a single place"}
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
          onClick={() =>
            setFlyTarget({ ...taiwanOverview, distance: TAIWAN_FLY_DISTANCE })
          }
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
        locationName={placeName}
        // The layer view needs a point, so the global mean is not offered
        // while it is open.
        places={strata.phase === "off" ? places : places.filter(hasCoordinates)}
        locationId={locationId}
        onLocation={(id) => selectPlace(id, true)}
        placeNote={placeNote(place)}
        compareLinks={compareLinks}
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
        locationName={placeName}
        aggregation={aggregation}
        trends={trendsFile}
      />
      <CompanionDock
        compact={strata.shown}
        visibleIds={controls
          .filter((layer) => layer.visible)
          .map((layer) => layer.id)}
        series={here}
        locationId={locationId}
        locationName={placeName}
        aggregation={aggregation}
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
          variableName={`${closeUpLayer.nameEn} at ${placeName}, ${activeMonth?.slice(0, 7) ?? ""}`}
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
      {particleLine && strata.phase === "off" ? (
        <p className="particle-note" role="note">
          {particleLine}
        </p>
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
