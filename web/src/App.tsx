import { useMemo, useRef, useState } from "react";
import {
  loadTrends,
  summarizeTrend,
  trendKey,
  type TrendSummary,
} from "./analysis/trends";
import { CloseUpPanel } from "./closeup/CloseUpPanel";
import { HudIcon } from "./hud/icons";
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
import { usualIntensity } from "./forms/calm/calmMath";
import { useParticleStyle } from "./forms/calm/particleStyle";
import { particleNote } from "./guide/particleNote";
import { Tour } from "./guide/Tour";
import { requestedTourStep } from "./guide/tourScript";
import { useGuidedTour } from "./guide/useGuidedTour";
import { carryChoices, monthYear, t, useI18n, type Locale } from "./i18n";
import { LanguageMenu, RoleSwitch } from "./i18n/ChoiceControls";
import { variableDefinition, variableName } from "./i18n/names";
import { LayerPanel, type LayerControl } from "./layers/LayerPanel";
import { initialLayerVisibility, layerRegistry } from "./layers/registry";
import { mockLocations, taiwanOverview } from "./mock/snapshot";
import { compareLinksFor, loadModelVsObs } from "./analysis/modelVsObs";
import { EarthCanvas } from "./scene/EarthCanvas";
import { DEFAULT_ORBIT_DISTANCE } from "./scene/orbitSpeed";
import type { FlyTarget } from "./scene/FlyCamera";
import { FpsReadout } from "./scene/FpsReadout";
import { FieldToggle } from "./fields/FieldToggle";
import { HudSearch } from "./hud/HudSearch";
import { useDismissOpenDetails } from "./hud/useDismissOnOutside";
import { useFieldNote } from "./fields/useFieldNote";
import { rendererLabel, type RendererKind } from "./scene/rendererLabel";
import { startLongitudeShift } from "./scene/startView";
import { bboxCenter, regionFrameDistance } from "./geo/regionFrame";
import { worldCityFrame } from "./scene/worldCityFrame";
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
  isRegion,
  nearestPlace,
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
import { GlobeStatsControls } from "./globeStats/GlobeStatsControls";
import { GlobeStatsPanel } from "./globeStats/GlobeStatsPanel";
import { GlobeStatsScene } from "./globeStats/GlobeStatsScene";
import { useGlobeStats } from "./globeStats/useGlobeStats";
import { GLOBE_STATS_TEXT } from "./globeStats/globeStatsText";
import {
  buildTrendGlyphs,
  countGlyphs,
  followedVariable,
} from "./globeStats/trendGlyphs";
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
const START_DISTANCE = DEFAULT_ORBIT_DISTANCE;
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
  place: Place | undefined,
  strata: boolean,
): FlyTarget | null {
  return useMemo(() => {
    if (strata || !place) return null;
    // A Taiwan region opens framed whole: the middle of its data area, at
    // the distance where the outline fits (no slide).
    if (isRegion(place)) {
      const middle = bboxCenter(place.bbox);
      const distance = regionFrameDistance(
        place.bbox,
        window.innerWidth / Math.max(1, window.innerHeight),
      );
      return {
        lat: middle.lat,
        lon:
          middle.lon +
          startLongitudeShift(
            window.innerWidth,
            window.innerHeight,
            distance,
            middle.lat,
          ),
        distance,
        instant: true,
      };
    }
    const { group, lat, lon } = place;
    if (lat === null || lon === null) return null;
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
  }, [place, strata]);
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
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  useDismissOpenDetails(moreMenuRef);
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
    () =>
      firstVisit && !settings.autoTour && requestedTourStep(search) === null,
  );
  const [howToOpen, setHowToOpen] = useState(false);
  // Guided tour (web/src/guide/useGuidedTour.ts): ?tour=<chapter> opens it
  // at a chapter; otherwise a first visit with `autoTour` opens it at 0.
  const [initialTour] = useState(() => {
    const asked = requestedTourStep(search);
    if (asked !== null) return asked;
    return firstVisit && settings.autoTour ? 0 : null;
  });
  const closeGuide = () => {
    rememberGuideDismissed();
    setGuideOpen(false);
    setHowToOpen(false);
  };
  const enterStrata = () => {
    setGuideOpen(false);
    strata.enter();
  };
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const places = data?.places ?? fallbackPlaces;
  const place = places.find((item) => item.id === locationId);
  // The place as a point on the globe; undefined for the global mean and the
  // Taiwan regions, which have no marker and no layer view (a region has its
  // own outline and camera flight, below).
  const location = hasCoordinates(place) ? place : undefined;
  const placeName = place ? displayPlaceName(place) : locationId;
  const aggregation = place?.aggregation ?? "point";
  // Series of a world place are read when it is picked.
  const placeLoading = !!data && !data.loaded.includes(locationId);
  // A Taiwan region: its data area is outlined on the globe.
  const region = isRegion(place)
    ? { id: place.id, name: placeName, bbox: place.bbox }
    : null;
  const selectPlace = (id: string, fly: boolean) => {
    setLocationId(id);
    const next = places.find((item) => item.id === id);
    if (strata.phase !== "off") return;
    // A region has no point: the camera goes to the middle of its data
    // area, at the distance that shows the whole outline.
    if (isRegion(next)) {
      const middle = bboxCenter(next.bbox);
      setFlyTarget({
        lat: middle.lat,
        lon: middle.lon,
        distance: regionFrameDistance(
          next.bbox,
          window.innerWidth / Math.max(1, window.innerHeight),
        ),
      });
      return;
    }
    if (!hasCoordinates(next)) return;
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
  const guidedTour = useGuidedTour({
    initialStep: initialTour,
    visibleLayers: controls.filter((item) => item.visible).map((i) => i.id),
    setVisibleLayers: (ids) =>
      setControls((current) =>
        current.map((layer) => ({ ...layer, visible: ids.includes(layer.id) })),
      ),
    place: locationId,
    selectPlace: (id) => selectPlace(id, true),
    ready: !!data,
    strataOn: strata.phase === "on",
    exitStrata: strata.exit,
  });
  const tourStep = guidedTour.step;
  const startTour = () => {
    setGuideOpen(false);
    setHowToOpen(false);
    setCloseUpId(null);
    guidedTour.go(0);
  };
  const endTour = () => {
    rememberGuideDismissed();
    guidedTour.end();
    // The examples and "How to read this" are offered next.
    setGuideOpen(true);
  };
  // The page opens with the camera over the selected place (the default,
  // or the one ?at= names), so the globe shows what the panels talk about.
  // A world city slides there (city on the viewing axis, slightly closer).
  // Taiwan is already there, with no slide. The global mean has no point
  // and keeps the default view; the layer view flies there by itself.
  const openingFlight = useOpeningFlight(place, requestedStrata());
  const flyTarget = askedFlight ?? (startDone ? null : openingFlight);
  const flying = flyTarget !== null;
  // "Fly near me": the device's position (asked only on this click, never
  // stored or sent anywhere) picks the closest Taiwan point or world city.
  // Without a position (no support, refused, timed out) it flies to Taiwan
  // as before.
  const [locating, setLocating] = useState(false);
  const flyToTaiwan = () =>
    setFlyTarget({ ...taiwanOverview, distance: TAIWAN_FLY_DISTANCE });
  const flyNearMe = () => {
    if (!("geolocation" in navigator)) {
      flyToTaiwan();
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const nearest = nearestPlace(
          position.coords.latitude,
          position.coords.longitude,
          places,
        );
        if (nearest) selectPlace(nearest.id, true);
        else flyToTaiwan();
      },
      () => {
        setLocating(false);
        flyToTaiwan();
      },
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  };
  const here =
    data?.series.filter((item) => item.locationId === locationId) ?? [];
  const months = timeline.months;
  const activeMonth = timeline.month;
  const intensities: Record<string, number> = {};
  const available: Record<string, boolean> = {};
  const usual: Record<string, number | null> = {};
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
      usual[layer.id] = usualIntensity(series.points, activeMonth);
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
  const globePlaces = useMemo(
    () => data?.places.filter(hasCoordinates) ?? [],
    [data],
  );
  // The marks follow the charted variable, else the open layer with the
  // most places significant after FDR correction (followedVariable).
  const selectedStatsVariableId = followedVariable(
    timeline.selectedVariableId,
    controls.filter((layer) => layer.visible).map((layer) => layer.id),
    (variableId) => {
      if (trendsFile.status !== "ready") return 0;
      const counts = countGlyphs(
        buildTrendGlyphs(globePlaces, variableId, trendsFile.data, ""),
      );
      return counts.solidUp + counts.solidDown;
    },
  );
  // The left-hand legend column is put away in the layer view and the
  // close-up. The trend map replaces the per-place trend marks (two trend
  // pictures at once read as one). The chart, the start card and the tour
  // take the left side, so the selector and legend give way to them.
  const legendsHidden = strata.phase !== "off" || closeUpId !== null;
  const trendMapOn = trendMapId !== null;
  const chartOpen = timeline.selectedVariableId !== null;
  const guideShown = guideOpen && tourStep === null;
  const globeStats = useGlobeStats({
    hidden: legendsHidden || trendMapOn,
    legendHidden: chartOpen || guideShown || tourStep !== null,
    places: globePlaces,
    selectedLocationId: locationId,
    selectedVariableId: selectedStatsVariableId,
    trends: trendsFile,
    modelVsObs: pairsFile,
    onSelectLocation: (id) => selectPlace(id, true),
  });
  const compareLinks =
    pairsFile.status === "ready"
      ? compareLinksFor(
          pairsFile.data.pairs,
          locationId,
          `${import.meta.env.BASE_URL}compare/`,
        )
      : undefined;

  // What the particles are, so they are not read as a global map.
  const openIds = controls
    .filter((control) => control.visible)
    .map((control) => control.id);
  const fieldNote = useFieldNote(openIds);
  const particleStyle = useParticleStyle();
  const particleLine = particleNote({
    style: location ? particleStyle : "lively",
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
  const tourSentences = (variableId: string, formatLocale?: Locale) => {
    const spec = companionFor(variableId);
    if (!spec) return null;
    const reading = readingOf(variableId);
    return companionSentences({
      companionName: companionName(spec),
      definition: variableDefinition(variableId, "general"),
      variableName: companionVariable(spec),
      place: placeName,
      month: activeMonth,
      formatLocale,
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
  // Turns one layer on (the search box and the companion panel use it).
  const showLayer = (id: string) =>
    setControls((current) =>
      current.map((layer) =>
        layer.id === id ? { ...layer, visible: true } : layer,
      ),
    );
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
        usual={usual}
        trendMap={trendMap.status === "ready" ? trendMap.map : null}
        trendMapOpacity={trendMapOpacity}
        places={places.filter(hasCoordinates)}
        locationId={locationId}
        region={region}
        onKind={setKind}
        onFlyDone={() => {
          setStartDone(true);
          setFlyTarget(null);
        }}
        onSelectLocation={(id) => selectPlace(id, false)}
        paused={strata.shown}
        controlsLocked={strata.phase !== "off"}
      >
        <GlobeStatsScene state={globeStats} />
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
        <HudSearch
          places={(strata.phase === "off"
            ? places
            : places.filter(hasCoordinates)
          ).map((place) => ({
            id: place.id,
            label: displayPlaceName(place),
          }))}
          layers={layerRegistry.map((layer) => ({
            id: layer.id,
            label: variableName(layer.id, layer.nameEn),
          }))}
          onPlace={(id) => selectPlace(id, true)}
          onLayer={showLayer}
        />
        {strata.phase === "off" ? (
          <FieldToggle
            openIds={openIds}
            trendMapOn={trendMap.status === "ready"}
            legendHidden={Boolean(closeUpLayer)}
          />
        ) : null}
        <button
          type="button"
          className="hud-guide"
          aria-pressed={guideOpen}
          aria-label={t("hud.guideAria")}
          title={t("hud.guideAria")}
          onClick={() => (guideOpen ? closeGuide() : setGuideOpen(true))}
        >
          <HudIcon name="guide" />
          <span className="hud-text">{t("hud.guide")}</span>
        </button>
        <button
          type="button"
          onClick={strata.phase === "off" ? enterStrata : strata.exit}
          disabled={
            strata.phase === "closing" ||
            strata.phase === "return" ||
            (strata.phase === "off" && !location)
          }
          title={
            location || strata.phase !== "off"
              ? t(strata.phase === "off" ? "hud.layerView" : "hud.backToGlobe")
              : t("hud.needsPlace")
          }
          aria-label={t(
            strata.phase === "off" ? "hud.layerView" : "hud.backToGlobe",
          )}
          aria-pressed={strata.phase !== "off"}
        >
          <HudIcon name="layers" />
          <span className="hud-text">
            {t(strata.phase === "off" ? "hud.layerView" : "hud.backToGlobe")}
          </span>
        </button>
        <label className="hud-select" data-on={trendMapId ? "" : undefined}>
          <HudIcon name="trend" />
          <select
            value={trendMapId ?? ""}
            aria-label={t("hud.trendMap")}
            title={t("hud.trendMap")}
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
          title={t("hud.flyNearTitle")}
          aria-label={t("hud.flyNear")}
          onClick={flyNearMe}
          disabled={flying || locating || strata.phase !== "off"}
        >
          <HudIcon name="fly" />
          <span className="hud-text">{t("hud.flyNear")}</span>
        </button>
        <div className="hud-choices">{roleControls}</div>
        {/* Secondary pages and the renderer diagnostics. */}
        <details className="hud-more" ref={moreMenuRef}>
          <summary title={t("hud.more")} aria-label={t("hud.more")}>
            <HudIcon name="more" />
            <span className="hud-text">{t("hud.more")}</span>
          </summary>
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
          month={activeMonth}
          sentences={tourSentences}
          figure={(variableId) => {
            const reading = readingOf(variableId);
            return {
              value: reading.value,
              anomalyZ: reading.anomaly?.z ?? null,
              signal: reading.signal,
            };
          }}
          onStep={guidedTour.go}
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
        places={places}
        onSelectLocation={(id) => selectPlace(id, true)}
        tourTab={guidedTour.tab}
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
        onTurnOn={showLayer}
        autoIntro={tourStep === null}
      />
      <div className="map-legends" hidden={legendsHidden}>
        {trendMapOn && !chartOpen && !guideShown ? (
          <p className="globe-stats-selectors globe-stats-paused">
            {GLOBE_STATS_TEXT.pausedForTrendMap}
          </p>
        ) : null}
        {globeStats.hidden || globeStats.legendHidden ? null : (
          <div className="globe-stats-selectors">
            <GlobeStatsControls state={globeStats} />
          </div>
        )}
        <GlobeStatsPanel state={globeStats} />
        <TrendMapLegend
          state={trendMap}
          opacity={trendMapOpacity}
          onOpacity={setTrendMapOpacity}
        />
        {/* The chart and the start card cover the bottom of the left
            side; the note comes back when they close. */}
        {particleLine && !guideShown && (!chartOpen || trendMapOn) ? (
          <aside className="particle-note" role="note">
            <p>{particleLine}</p>
            {fieldNote ? <p>{fieldNote}</p> : null}
          </aside>
        ) : null}
      </div>
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
      <p className="credit">
        {t("hud.credit.surface")}{" "}
        <a href="https://visibleearth.nasa.gov/images/57730/the-blue-marble-land-surface-ocean-color-and-sea-ice">
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
