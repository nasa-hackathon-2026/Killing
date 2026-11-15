import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { motionScale, prefersReducedMotion } from "../forms/reducedMotion";
import { MONTH_FOLLOW_RATE } from "../fields/fieldConfig";
import { followMonth } from "../fields/fieldMapping";
import type { FieldData } from "../fields/loadField";
import type { TrendMap } from "./loadTrendMap";
import { seasonalCycle } from "./seasonal";
import { SeasonalSurface } from "./seasonalSurface";
import { gridSpherePatch } from "./trendGrid";
import { OVERLAY_RADIUS } from "./trendMapConfig";

type TrendMapOverlayProps = {
  map: TrendMap;
  opacity: number;
  // Monthly climatology of the same variable; with it the map follows the
  // timeline (see seasonal.ts). Without it the map is drawn as computed.
  field?: FieldData | null;
  // Calendar month of the timeline, 0 = January; null = no month.
  month?: number | null;
  // Playing speed in months per second, to keep up with the timeline.
  speed?: number;
};

// True when the climatology is on the very grid of the trend map.
function sameGrid(map: TrendMap, field: FieldData): boolean {
  const a = map.spec;
  const b = field.spec;
  return (
    a.nLat === b.nLat &&
    a.nLon === b.nLon &&
    a.latSouth === b.latSouth &&
    a.lonWest === b.lonWest &&
    a.latStep === b.latStep &&
    a.lonStep === b.lonStep
  );
}

// A shell just above the surface that covers exactly the grid of the trend
// map, one texel per cell. Nearest filtering keeps the cells as computed and
// keeps colour from bleeding into cells with no data. The colours are the
// trend; the strength of each cell follows the calendar month of the
// timeline, sliding from month to month (seasonal.ts).
export function TrendMapOverlay({
  map,
  opacity,
  field = null,
  month = null,
  speed = 1,
}: TrendMapOverlayProps) {
  const seasonal = field !== null && sameGrid(map, field) ? field : null;
  const cycle = useMemo(
    () =>
      seasonal
        ? seasonalCycle(
            seasonal.months,
            seasonal.range.high - seasonal.range.low,
          )
        : null,
    [seasonal],
  );
  const surface = useMemo(
    () => new SeasonalSurface(map.pixels, map.spec.nLon, map.spec.nLat),
    [map],
  );
  const patch = useMemo(() => gridSpherePatch(map.spec), [map]);

  // Without climatology the map is drawn as computed; with it, the first
  // frame paints the month.
  useEffect(() => {
    if (seasonal) surface.forget();
    else surface.showStatic();
  }, [seasonal, surface]);

  useEffect(() => {
    return () => surface.dispose();
  }, [surface]);

  useFrame((_, delta) => {
    if (!seasonal || !cycle) return;
    const goal = month ?? 0;
    const previous = surface.position;
    const next =
      previous === null || prefersReducedMotion()
        ? goal
        : followMonth(
            previous,
            goal,
            delta * MONTH_FOLLOW_RATE * Math.max(1, speed) * motionScale(),
          );
    surface.show(seasonal.months, cycle, next);
  });

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
        map={surface.texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
