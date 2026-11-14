import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useState } from "react";
import { GlassParticleLayer } from "../layers/GlassParticleLayer";
import { layerRegistry, type LayerDefinition } from "../layers/registry";
import { mockLocations, type MockLocation } from "../mock/snapshot";
import { createSceneRenderer } from "./createSceneRenderer";
import { Earth } from "./Earth";
import { TaiwanDetail } from "./TaiwanDetail";
import { FlyCamera } from "./FlyCamera";
import { Markers } from "./Markers";
import { type RendererKind } from "./rendererLabel";

export type SceneLayer = {
  id: string;
  visible: boolean;
  opacity: number;
};

type EarthCanvasProps = {
  forceWebGL: boolean;
  flying: boolean;
  layers: SceneLayer[];
  intensities: Record<string, number>;
  // Layers whose current month has a value; the others draw no particles.
  available: Record<string, boolean>;
  trendDirections?: Record<string, number>;
  places: MockLocation[];
  locationId: string;
  onKind: (kind: RendererKind) => void;
  onFlyDone: () => void;
  onSelectLocation: (id: string) => void;
};

function Scene({
  flying,
  layers,
  intensities,
  available,
  trendDirections,
  places,
  locationId,
  onFlyDone,
  onSelectLocation,
}: {
  flying: boolean;
  layers: SceneLayer[];
  intensities: Record<string, number>;
  // Layers whose current month has a value; the others draw no particles.
  available: Record<string, boolean>;
  trendDirections?: Record<string, number>;
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
      <Markers
        locations={places.length > 0 ? places : mockLocations}
        selectedId={locationId}
        onSelect={onSelectLocation}
      />
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
      <FlyCamera
        flying={flying}
        onDone={() => {
          setControlEpoch((epoch) => epoch + 1);
          onFlyDone();
        }}
      />
      <OrbitControls
        key={controlEpoch}
        enablePan={false}
        enabled={!flying}
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
  flying,
  layers,
  intensities,
  available,
  trendDirections,
  places,
  locationId,
  onKind,
  onFlyDone,
  onSelectLocation,
}: EarthCanvasProps) {
  return (
    <Canvas
      key={forceWebGL ? "webgl" : "auto"}
      camera={{ position: [0, 0, 3.2], fov: 45 }}
      dpr={[1, 2]}
      gl={createSceneRenderer(forceWebGL, onKind)}
    >
      <Scene
        flying={flying}
        layers={layers}
        intensities={intensities}
        available={available}
        trendDirections={trendDirections}
        places={places}
        locationId={locationId}
        onFlyDone={onFlyDone}
        onSelectLocation={onSelectLocation}
      />
    </Canvas>
  );
}
