import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useState, type ReactNode } from "react";
import { GlassParticleLayer } from "../layers/GlassParticleLayer";
import { GlobalField } from "../fields/GlobalField";
import { LocalParticlesBlend } from "../fields/LocalParticlesBlend";
import { layerRegistry, type LayerDefinition } from "../layers/registry";
import { mockLocations, type MockLocation } from "../mock/snapshot";
import type { TrendMap } from "../trendmap/loadTrendMap";
import { TrendMapOverlay } from "../trendmap/TrendMapOverlay";
import { createSceneRenderer } from "./createSceneRenderer";
import { Earth } from "./Earth";
import { TaiwanDetail } from "./TaiwanDetail";
import { FlyCamera, type FlyTarget } from "./FlyCamera";
import { Markers } from "./Markers";
import { type RendererKind } from "./rendererLabel";

export type SceneLayer = {
  id: string;
  visible: boolean;
  opacity: number;
};

type EarthCanvasProps = {
  forceWebGL: boolean;
  // Camera flight in progress (web/src/scene/FlyCamera.tsx); null = none.
  flyTarget: FlyTarget | null;
  layers: SceneLayer[];
  intensities: Record<string, number>;
  // Layers whose current month has a value; the others draw no particles.
  available: Record<string, boolean>;
  trendDirections?: Record<string, number>;
  // Global trend map drawn over the surface; null = off.
  trendMap?: TrendMap | null;
  trendMapOpacity?: number;
  places: MockLocation[];
  locationId: string;
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
  trendMap,
  trendMapOpacity,
  places,
  locationId,
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
  // Global trend map drawn over the surface; null = off.
  trendMap?: TrendMap | null;
  trendMapOpacity?: number;
  places: MockLocation[];
  locationId: string;
  onFlyDone: () => void;
  onSelectLocation: (id: string) => void;
}) {
  const [controlEpoch, setControlEpoch] = useState(0);
  const openLayers = layers.filter((layer) => layer.visible).length;

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
          />
        ))}
      </LocalParticlesBlend>
      <FlyCamera
        target={flyTarget}
        onDone={() => {
          setControlEpoch((epoch) => epoch + 1);
          onFlyDone();
        }}
      />
      {children}
      <OrbitControls
        key={controlsLocked ? "locked" : controlEpoch}
        enablePan={false}
        enabled={!flyTarget && !controlsLocked}
        minDistance={1.18}
        maxDistance={6}
      />
    </>
  );
}

function LayerView({
  layer,
  control,
  intensity,
  hasData,
  openLayers,
  trendDirection,
}: {
  layer: LayerDefinition;
  control: SceneLayer | undefined;
  intensity: number;
  hasData: boolean;
  openLayers: number;
  trendDirection: number;
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
  trendMap,
  trendMapOpacity,
  places,
  locationId,
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
      camera={{ position: [0, 0, 3.2], fov: 45 }}
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
        trendMap={trendMap}
        trendMapOpacity={trendMapOpacity}
        places={places}
        locationId={locationId}
        onFlyDone={onFlyDone}
        onSelectLocation={onSelectLocation}
        controlsLocked={controlsLocked}
      >
        {children}
      </Scene>
    </Canvas>
  );
}
