import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Suspense,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import { CalmLayers } from "../forms/calm/CalmLayers";
import { useParticleStyle } from "../forms/calm/particleStyle";
import { GlassParticleLayer } from "../layers/GlassParticleLayer";
import { GlobalField } from "../fields/GlobalField";
import { LocalParticlesBlend } from "../fields/LocalParticlesBlend";
import { layerRegistry, type LayerDefinition } from "../layers/registry";
import { mockLocations, type MockLocation } from "../mock/snapshot";
import type { TrendMap } from "../trendmap/loadTrendMap";
import { TrendMapOverlay } from "../trendmap/TrendMapOverlay";
import { createSceneRenderer } from "./createSceneRenderer";
import { DEFAULT_ORBIT_DISTANCE, orbitRotateSpeed } from "./orbitSpeed";
import { Earth } from "./Earth";
import { TaiwanDetail } from "./TaiwanDetail";
import { FlyCamera, type FlyTarget } from "./FlyCamera";
import { Markers } from "./Markers";
import { RegionFrame } from "./RegionFrame";
import { bboxCenter, type Bbox } from "../geo/regionFrame";
import { type RendererKind } from "./rendererLabel";

export type SceneLayer = {
  id: string;
  visible: boolean;
  opacity: number;
};

export type SelectedRegion = { id: string; name: string; bbox: Bbox };

type EarthCanvasProps = {
  forceWebGL: boolean;
  // Camera flight in progress (web/src/scene/FlyCamera.tsx); null = none.
  flyTarget: FlyTarget | null;
  layers: SceneLayer[];
  intensities: Record<string, number>;
  // Layers whose current month has a value; the others draw no particles.
  available: Record<string, boolean>;
  trendDirections?: Record<string, number>;
  // Per layer: the normalized mean of the shown calendar month (Calm style).
  usual?: Record<string, number | null>;
  // Global trend map drawn over the surface; null = off.
  trendMap?: TrendMap | null;
  trendMapOpacity?: number;
  places: MockLocation[];
  locationId: string;
  // The selected Taiwan region: its data area is outlined and labelled, and
  // the Calm particles gather at its middle. null for any other place.
  region?: SelectedRegion | null;
  onKind: (kind: RendererKind) => void;
  onFlyDone: () => void;
  onSelectLocation: (id: string) => void;
  // Layer view (web/src/strata): stop drawing while it covers the globe,
  // keep the orbit controls off while its camera flight runs, and let it
  // put its camera flight inside this canvas.
  paused?: boolean;
  controlsLocked?: boolean;
  children?: ReactNode;
};

function Scene({
  flyTarget,
  layers,
  intensities,
  available,
  trendDirections,
  usual,
  trendMap,
  trendMapOpacity,
  places,
  locationId,
  region,
  onFlyDone,
  onSelectLocation,
  controlsLocked,
  children,
}: {
  controlsLocked?: boolean;
  children?: ReactNode;
  // Camera flight in progress (web/src/scene/FlyCamera.tsx); null = none.
  flyTarget: FlyTarget | null;
  layers: SceneLayer[];
  intensities: Record<string, number>;
  // Layers whose current month has a value; the others draw no particles.
  available: Record<string, boolean>;
  trendDirections?: Record<string, number>;
  // Per layer: the normalized mean of the shown calendar month (Calm style).
  usual?: Record<string, number | null>;
  // Global trend map drawn over the surface; null = off.
  trendMap?: TrendMap | null;
  trendMapOpacity?: number;
  places: MockLocation[];
  locationId: string;
  region?: SelectedRegion | null;
  onFlyDone: () => void;
  onSelectLocation: (id: string) => void;
}) {
  const [controlEpoch, setControlEpoch] = useState(0);
  const openLayers = layers.filter((layer) => layer.visible).length;
  // The Calm style needs a place to float above; the global mean has none
  // and keeps the Lively style.
  const selected =
    places.find((place) => place.id === locationId) ??
    (region ? bboxCenter(region.bbox) : undefined);
  const calm = useParticleStyle() === "calm" && selected !== undefined;

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 2, 3]} intensity={1.1} />
      <Suspense fallback={null}>
        <Earth />
        <TaiwanDetail />
      </Suspense>
      {trendMap ? (
        <TrendMapOverlay map={trendMap} opacity={trendMapOpacity ?? 1} />
      ) : null}
      <Markers
        locations={places.length > 0 ? places : mockLocations}
        selectedId={locationId}
        onSelect={onSelectLocation}
      />
      {region ? <RegionFrame bbox={region.bbox} name={region.name} /> : null}
      <GlobalField
        openIds={layers
          .filter((layer) => layer.visible)
          .map((layer) => layer.id)}
        trendMapOn={Boolean(trendMap)}
      />
      <LocalParticlesBlend>
        {layerRegistry.map((layer) => (
          <LayerView
            key={layer.id}
            layer={layer}
            control={layers.find((item) => item.id === layer.id)}
            intensity={intensities[layer.id] ?? 0}
            hasData={available[layer.id] ?? false}
            openLayers={openLayers}
            trendDirection={trendDirections?.[layer.id] ?? 0}
            calm={calm}
          />
        ))}
        {calm && selected ? (
          <CalmLayers
            lat={selected.lat}
            lon={selected.lon}
            layers={layers}
            intensities={intensities}
            available={available}
            usual={usual}
            trendDirections={trendDirections}
          />
        ) : null}
      </LocalParticlesBlend>
      <FlyCamera
        target={flyTarget}
        onDone={() => {
          setControlEpoch((epoch) => epoch + 1);
          onFlyDone();
        }}
      />
      {children}
      <GlobeControls
        key={controlsLocked ? "locked" : controlEpoch}
        enabled={!flyTarget && !controlsLocked}
      />
    </>
  );
}

// Orbit drag only. rotateSpeed is written each frame from the camera
// distance; zoomSpeed is left at the control default, and this component
// is not mounted in the layer view.
function GlobeControls({ enabled }: { enabled: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useFrame(() => {
    const current = controls.current;
    if (!current) return;
    current.rotateSpeed = orbitRotateSpeed(current.getDistance());
  });
  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enabled={enabled}
      minDistance={1.18}
      maxDistance={6}
    />
  );
}

function LayerView({
  layer,
  control,
  intensity,
  hasData,
  openLayers,
  trendDirection,
  calm,
}: {
  layer: LayerDefinition;
  control: SceneLayer | undefined;
  intensity: number;
  hasData: boolean;
  openLayers: number;
  trendDirection: number;
  calm: boolean;
}) {
  if (!control) return null;
  return (
    <GlassParticleLayer
      layer={layer}
      visible={control.visible}
      opacity={control.opacity}
      intensity={intensity}
      hasData={hasData}
      openLayers={openLayers}
      trendDirection={trendDirection}
      calm={calm}
    />
  );
}

export function EarthCanvas({
  forceWebGL,
  flyTarget,
  layers,
  intensities,
  available,
  trendDirections,
  usual,
  trendMap,
  trendMapOpacity,
  places,
  locationId,
  region,
  onKind,
  onFlyDone,
  onSelectLocation,
  paused,
  controlsLocked,
  children,
}: EarthCanvasProps) {
  return (
    <Canvas
      key={forceWebGL ? "webgl" : "auto"}
      camera={{ position: [0, 0, DEFAULT_ORBIT_DISTANCE], fov: 45 }}
      dpr={[1, 2]}
      frameloop={paused ? "never" : "always"}
      gl={createSceneRenderer(forceWebGL, onKind)}
    >
      <Scene
        flyTarget={flyTarget}
        layers={layers}
        intensities={intensities}
        available={available}
        trendDirections={trendDirections}
        usual={usual}
        trendMap={trendMap}
        trendMapOpacity={trendMapOpacity}
        places={places}
        locationId={locationId}
        region={region}
        onFlyDone={onFlyDone}
        onSelectLocation={onSelectLocation}
        controlsLocked={controlsLocked}
      >
        {children}
      </Scene>
    </Canvas>
  );
}
