import { useState } from "react";
import {
  loadTrends,
  summarizeTrend,
  trendKey,
  type TrendSummary,
} from "./analysis/trends";
import { CloseUpPanel } from "./closeup/CloseUpPanel";
import { useAnalysisFile } from "./analysis/useAnalysisFile";
import {
  trendArrowDirection,
  trendMark,
  trendSignal,
  type TrendSignal,
} from "./forms/encoding";
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
import { usePlaceSnapshot } from "./snapshot/usePlaceSnapshot";
import { requestedCloseUp, requestedLayers } from "./urlParams";

const askedLayers = requestedLayers();
const initialControls: LayerControl[] = layerRegistry.map((layer) => ({
  id: layer.id,
  visible: askedLayers
    ? askedLayers.includes(layer.id)
    : initialLayerVisibility(layer.id),
  opacity: 0.75,
}));

export function App() {
  const [forceWebGL, setForceWebGL] = useState(false);
  const [flying, setFlying] = useState(false);
  const [kind, setKind] = useState<RendererKind>("webgl");
  const [locationId, setLocationId] = useState("taichung");
  const [controls, setControls] = useState(initialControls);
  const [month, setMonth] = useState<string | null>(null);
  const [closeUpId, setCloseUpId] = useState<string | null>(requestedCloseUp);
  const snapshot = usePlaceSnapshot();
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const location =
    data?.places.find((item) => item.id === locationId) ??
    mockLocations.find((item) => item.id === locationId);
  const here =
    data?.series.filter((item) => item.locationId === locationId) ?? [];
  const months = sortedMonths(here.map((item) => item.points));
  const activeMonth =
    month && months.includes(month)
      ? month
      : (bestDefaultMonth(here.map((item) => item.points)) ??
        months.at(-1) ??
        null);
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
        places={data?.places ?? []}
        locationId={locationId}
        onKind={setKind}
        onFlyDone={() => setFlying(false)}
        onSelectLocation={setLocationId}
      />
      <div className="hud">
        <p className="badge">Renderer: {rendererLabel(kind)}</p>
        <FpsReadout />
        <button type="button" onClick={() => setForceWebGL((value) => !value)}>
          {forceWebGL ? "Use automatic renderer" : "Force WebGL"}
        </button>
        <button type="button" onClick={() => setFlying(true)} disabled={flying}>
          Fly to Taiwan
        </button>
        <a href={`${import.meta.env.BASE_URL}lab/`}>Form lab</a>
        <a href={`${import.meta.env.BASE_URL}mining/`}>Data mining</a>
      </div>
      <LayerPanel
        layers={layerRegistry}
        controls={controls}
        readings={readings}
        trends={trends}
        signals={signals}
        locationName={location?.nameEn ?? locationId}
        months={months}
        month={activeMonth}
        onMonth={setMonth}
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
        onCloseUp={setCloseUpId}
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
