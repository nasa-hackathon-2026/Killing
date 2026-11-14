import { useEffect, useMemo } from "react";
import {
  DataTexture,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import type { TrendMap } from "./loadTrendMap";
import { gridSpherePatch } from "./trendGrid";
import { OVERLAY_RADIUS } from "./trendMapConfig";

type TrendMapOverlayProps = {
  map: TrendMap;
  opacity: number;
};

// A shell just above the surface that covers exactly the grid of the trend
// map, one texel per cell. Nearest filtering keeps the cells as computed and
// keeps colour from bleeding into cells with no data.
export function TrendMapOverlay({ map, opacity }: TrendMapOverlayProps) {
  const texture = useMemo(() => {
    const image = new DataTexture(
      map.pixels,
      map.spec.nLon,
      map.spec.nLat,
      RGBAFormat,
      UnsignedByteType,
    );
    image.colorSpace = SRGBColorSpace;
    image.magFilter = NearestFilter;
    image.minFilter = NearestFilter;
    image.needsUpdate = true;
    return image;
  }, [map]);
  const patch = useMemo(() => gridSpherePatch(map.spec), [map]);

  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);

  return (
    <mesh renderOrder={2}>
      <sphereGeometry
        args={[
          OVERLAY_RADIUS,
          96,
          48,
          patch.phiStart,
          patch.phiLength,
          patch.thetaStart,
          patch.thetaLength,
        ]}
      />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
