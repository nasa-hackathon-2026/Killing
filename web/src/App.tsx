import { useEffect, useMemo, useState } from "react";
import {
  loadTrends,
  summarizeTrend,
  trendKey,
  type TrendSummary,
} from "./analysis/trends";
import { CloseUpPanel } from "./closeup/CloseUpPanel";
import { CompanionDock } from "./companions/CompanionDock";
import { companionReading, monthlyAnomaly } from "./companions/companionData";
import { companionSentences } from "./companions/companionLine";
import {
  companionFor,
  companionName,
  companionVariable,
} from "./companions/companionSpec";
import { useAnalysisFile } from "./analysis/useAnalysisFile";
import {
  trendArrowDirection,
  trendLabel,
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
import { Tour } from "./guide/Tour";
import { TOUR_STEPS, tourLayers } from "./guide/tourScript";
import { carryChoices, monthYear, t, useI18n } from "./i18n";
import { LanguageMenu, RoleSwitch } from "./i18n/ChoiceControls";
import { variableDefinition, variableName } from "./i18n/names";
import { LayerPanel, type LayerControl } from "./layers/LayerPanel";
import { initialLayerVisibility, layerRegistry } from "./layers/registry";
import { mockLocations, taiwanOverview } from "./mock/snapshot";
import { compareLinksFor, loadModelVsObs } from "./analysis/modelVsObs";
import { EarthCanvas } from "./scene/EarthCanvas";
import type { FlyTarget } from "./scene/FlyCamera";
import { FpsReadout } from "./scene/FpsReadout";
import { rendererLabel, type RendererKind } from "./scene/rendererLabel";
import { startLongitudeShift } from "./scene/startView";
import {
  bestDefaultMonth,
  formatMeasurement,
  intensityAt,
  sortedMonths,
  valueAt,
} from "./snapshot/reading";
import {
  displayPlaceName,
  hasCoordinates,
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

// One target object per place, so the camera jumps there once.
function useStartFlight(
  lat: number | undefined,
  lon: number | undefined,
  distance: number,
): FlyTarget | null {
  return useMemo(
    () =>
      lat !== undefined && lon !== undefined
        ? {
            lat,
            // East of the place on medium windows, so the place shows left
            // of the Companions panel (scene/startView.ts).
            lon:
              lon +
              startLongitudeShift(
                window.innerWidth,
                window.innerHeight,
                distance,
                lat,
              ),
            distance,
            instant: true,
          }
        : null,
    [lat, lon, distance],
  );
}

// "Precipitation (GPM IMERG Final)": the variable's name in the active
// language with the product name, which is not translated.
function trendMapLabel(variable: { id: string; label: string }): string {
  const product = /\(([^()]+)\)$/.exec(variable.label)?.[1];
  const name = variableName(variable.id, variable.label);
  return product && !name.includes(product) ? `${name} (${product})` : name;
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
  const { settings, voice } = useI18n();
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
  // On a first visit a role with `autoTour` gets the companion tour, the
  // others the guide card; "? Guide" reopens the card, which offers the tour.
  const [firstVisit] = useState(() =>
    showGuideAtStart(search, guideDismissed()),
  );
  const [guideOpen, setGuideOpen] = useState(
    () => firstVisit && !settings.autoTour,
  );
  const [howToOpen, setHowToOpen] = useState(false);
  // Guided tour (web/src/guide/tourScript.ts): the step shown, or null. The
  // layers the visitor had on are put back when it ends.
  const [tourStep, setTourStep] = useState<number | null>(() =>
    firstVisit && settings.autoTour ? 0 : null,
  );
  const [layersBeforeTour, setLayersBeforeTour] = useState<string[] | null>(
    null,
  );
  const closeGuide = () => {
    rememberGuideDismissed();
    setGuideOpen(false);
    setHowToOpen(false);
  };
  const enterStrata = () => {
    setGuideOpen(false);
    strata.enter();
  };
  const goToStep = (index: number) => {
    const visible = controls.filter((item) => item.visible).map((i) => i.id);
    if (layersBeforeTour === null) setLayersBeforeTour(visible);
    const needed = tourLayers(index);
    setControls((current) =>
      current.map((layer) =>
        needed.includes(layer.id) && !layer.visible
          ? { ...layer, visible: true }
          : layer,
      ),
    );
    setTourStep(index);
  };
  const startTour = () => {
    setGuideOpen(false);
    setHowToOpen(false);
    setCloseUpId(null);
    timeline.setPlaying(false);
    timeline.setSelectedVariableId(null);
    goToStep(0);
  };
  const endTour = () => {
    rememberGuideDismissed();
    setTourStep(null);
    if (layersBeforeTour) {
      setControls((current) =>
        current.map((layer) => ({
          ...layer,
          visible: layersBeforeTour.includes(layer.id),
        })),
      );
    }
    setLayersBeforeTour(null);
    // The examples and "How to read this" are offered next.
    setGuideOpen(true);
  };
  const tour = tourStep === null ? null : (TOUR_STEPS[tourStep] ?? null);
  // The tour's step decides whether the layer view is open; the state
  // machine of the layer view does the moving.
  const tourView = tour?.view ?? null;
  const { phase: strataPhase, enter: strataEnter, exit: strataExit } = strata;
  useEffect(() => {
    if (tourView === "strata" && strataPhase === "off") strataEnter();
    else if (tourView === "globe" && strataPhase === "on") strataExit();
  }, [tourView, strataPhase, strataEnter, strataExit]);
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const places = data?.places ?? fallbackPlaces;
  const place = places.find((item) => item.id === locationId);
  // The place as a point on the globe; undefined for the global mean, which
  // has no marker, no camera flight and no layer view.
  const location = hasCoordinates(place) ? place : undefined;
  const placeName = place ? displayPlaceName(place) : locationId;
  const aggregation = place?.aggregation ?? "point";
  // Series of a world place are read when it is picked.
  const placeLoading = !!data && !data.loaded.includes(locationId);
  const selectPlace = (id: string, fly: boolean) => {
    setLocationId(id);
    const next = places.find((item) => item.id === id);
    if (fly && hasCoordinates(next) && strata.phase === "off") {
      setFlyTarget({
        lat: next.lat,
        lon: next.lon,
        distance: PLACE_FLY_DISTANCE,
      });
    }
  };
  // The page opens with the camera over the selected place (the default,
  // or the one ?at= names), so the globe shows what the panels talk about.
  // The global mean has no point and keeps the default view; the layer view
  // flies there by itself.
  const startLat = location?.lat;
  const startLon = location?.lon;
  const startDistance =
    place?.group === "taiwan" ? START_DISTANCE : PLACE_FLY_DISTANCE;
  const startFlight = useStartFlight(
    requestedStrata() ? undefined : startLat,
    startLon,
    startDistance,
  );
  const flyTarget = askedFlight ?? (startDone ? null : startFlight);
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
      readings[layer.id] = t("common.status.loading");
      intensities[layer.id] = 0;
    } else if (!series || !activeMonth) {
      readings[layer.id] =
        snapshot.status === "error"
          ? t("common.status.snapshotError")
          : t("common.status.noDataAtPlace");
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
      .map((layer) => variableName(layer.id, layer.nameEn)),
    place: placeName,
    month: activeMonth,
    trendMap: trendMap.status === "ready",
  });

  // What a companion says and looks like in the tour: the same reading the
  // Companions panel builds, as short template sentences.
  const readingOf = (variableId: string) =>
    companionReading(
      variableId,
      here.find((item) => item.variableId === variableId),
      activeMonth,
      trendsFile.status === "ready"
        ? trendsFile.data.series[trendKey(variableId, locationId, aggregation)]
        : undefined,
      trendsFile.status === "ready" ? trendsFile.data.known_issues : undefined,
    );
  const tourSentences = (variableId: string) => {
    const spec = companionFor(variableId);
    if (!spec) return null;
    const reading = readingOf(variableId);
    return companionSentences({
      companionName: companionName(spec),
      definition: variableDefinition(variableId, "general"),
      variableName: companionVariable(spec),
      place: placeName,
      month: activeMonth,
      value: reading.raw,
      unit: reading.unit,
      anomaly: reading.anomaly,
      trend: reading.trend,
      unreliableReason: reading.signal.unreliable
        ? (reading.caveat?.reason ?? t("caveats.genericReason"))
        : null,
      dataKind: spec.dataKind,
    });
  };
  const closeUpName = closeUpLayer
    ? variableName(closeUpLayer.id, closeUpLayer.nameEn)
    : "";
  const roleControls = (
    <>
      <RoleSwitch />
      <LanguageMenu />
    </>
  );

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
          place={{ ...location, nameEn: placeName }}
          focus={tour ? tour.stratum : undefined}
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
        <StrataHint placeName={placeName} onEnter={enterStrata} />
      ) : null}
      <div className="hud hud-main">
        <button
          type="button"
          className="hud-guide"
          aria-pressed={guideOpen}
          aria-label={t("hud.guideAria")}
          onClick={() => (guideOpen ? closeGuide() : setGuideOpen(true))}
        >
          ? <span>{t("hud.guide")}</span>
        </button>
        <button
          type="button"
          onClick={strata.phase === "off" ? enterStrata : strata.exit}
          disabled={
            strata.phase === "closing" ||
            strata.phase === "return" ||
            (strata.phase === "off" && !location)
          }
          title={location ? undefined : t("hud.needsPlace")}
          aria-pressed={strata.phase !== "off"}
        >
          {t(strata.phase === "off" ? "hud.layerView" : "hud.backToGlobe")}
        </button>
        <label>
          <span>{t("hud.trendMap")}</span>
          <select
            value={trendMapId ?? ""}
            aria-label={t("hud.trendMap")}
            onChange={(event) => {
              setGuideOpen(false);
              setTrendMapId(event.target.value || null);
            }}
          >
            <option value="">{t("hud.trendMapOff")}</option>
            {TREND_MAP_VARIABLES.map((variable) => (
              <option key={variable.id} value={variable.id}>
                {trendMapLabel(variable)}
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
          {t("hud.flyTaiwan")}
        </button>
        <div className="hud-choices">{roleControls}</div>
        {/* Secondary pages and the renderer diagnostics. */}
        <details className="hud-more">
          <summary>{t("hud.more")}</summary>
          <div className="hud-menu">
            <div className="hud-menu-choices">{roleControls}</div>
            <a href={carryChoices(`${import.meta.env.BASE_URL}compare/`)}>
              {t("hud.compare")}
            </a>
            <a href={carryChoices(`${import.meta.env.BASE_URL}mining/`)}>
              {t("hud.mining")}
            </a>
            <a href={carryChoices(`${import.meta.env.BASE_URL}lab/`)}>
              {t("hud.lab")}
            </a>
            <div className="hud-debug">
              <p className="badge">
                {t("hud.renderer", { name: rendererLabel(kind) })}
              </p>
              <FpsReadout />
              <button
                type="button"
                onClick={() => setForceWebGL((value) => !value)}
              >
                {t(forceWebGL ? "hud.autoRenderer" : "hud.forceWebgl")}
              </button>
            </div>
          </div>
        </details>
      </div>
      {guideOpen && tourStep === null ? (
        <GuideCard
          onClose={closeGuide}
          onTour={location ? startTour : undefined}
          howToOpen={howToOpen}
        />
      ) : null}
      {tourStep !== null ? (
        <Tour
          step={tourStep}
          vars={{
            place: placeName,
            month: activeMonth ? monthYear(activeMonth) : "",
          }}
          sentences={tourSentences}
          figure={(variableId) => {
            const reading = readingOf(variableId);
            return {
              value: reading.value,
              anomalyZ: reading.anomaly?.z ?? null,
              signal: reading.signal,
            };
          }}
          onStep={goToStep}
          onEnd={endTour}
        />
      ) : null}
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
        placeNote={placeNote(place, voice)}
        onHowTo={() => {
          setHowToOpen(true);
          setGuideOpen(true);
        }}
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
          variableName={t("closeup.kicker", {
            name: closeUpName,
            where: activeMonth
              ? t("places.placeMonth", {
                  place: placeName,
                  month: activeMonth.slice(0, 7),
                })
              : placeName,
          })}
          hasData={available[closeUpLayer.id] ?? false}
          value={intensities[closeUpLayer.id] ?? 0}
          reading={readings[closeUpLayer.id] ?? ""}
          kelvin={kelvins[closeUpLayer.id] ?? null}
          trendLabel={
            signals?.[closeUpLayer.id]
              ? trendLabel(signals[closeUpLayer.id] as TrendSignal, voice)
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
        {t("hud.credit.surface")}{" "}
        <a href="https://visibleearth.nasa.gov/images/57730/blue-marble-land-surface-ocean-color-sea-ice-and-clouds">
          NASA Visible Earth
        </a>
        . {t("hud.credit.detail")}{" "}
        <a href="https://gibs.earthdata.nasa.gov/">NASA GIBS</a>.
        {snapshotDay
          ? ` ${t("hud.credit.snapshot", { date: snapshotDay })}`
          : ""}{" "}
        {t("hud.credit.insignia")}
      </p>
    </div>
  );
}
