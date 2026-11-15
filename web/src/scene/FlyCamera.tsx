import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { latLonToVector3 } from "../geo/latLon";
import { approachPosition, type Vec3 } from "../strata/strataCamera";

// Where the globe camera should go: above a point, at a distance from the
// Earth's center. `instant` jumps there without a flight.
export type FlyTarget = {
  lat: number;
  lon: number;
  distance: number;
  instant?: boolean;
};

type FlyCameraProps = {
  target: FlyTarget | null;
  onDone: () => void;
};

// Seconds one flight takes, whatever the angle.
export const FLY_SECONDS = 1.6;

// Turns the camera around the Earth along the great arc to the target (so
// the path never cuts through the globe). With "reduce motion" it jumps.
export function FlyCamera({ target, onDone }: FlyCameraProps) {
  const camera = useThree((state) => state.camera);
  const flight = useRef<{ target: FlyTarget; from: Vec3; t: number } | null>(
    null,
  );

  useFrame((_, delta) => {
    if (!target) {
      flight.current = null;
      return;
    }
    if (flight.current?.target !== target) {
      flight.current = {
        target,
        from: [camera.position.x, camera.position.y, camera.position.z],
        t: 0,
      };
    }
    const current = flight.current;
    if (current.t >= 1) return;
    const jump = target.instant || prefersReducedMotion();
    current.t = jump ? 1 : Math.min(1, current.t + delta / FLY_SECONDS);
    const end = latLonToVector3(target.lat, target.lon, target.distance);
    const [x, y, z] = approachPosition(
      current.from,
      [end.x, end.y, end.z],
      current.t,
    );
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    if (current.t >= 1) onDone();
  });

  return null;
}
