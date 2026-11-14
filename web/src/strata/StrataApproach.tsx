// Lives inside the globe's canvas. Flies the globe camera to the chosen place
// before the layer view opens and back to where it was afterwards, and
// reports when the user has zoomed in far enough to be offered the layer
// view. With "reduce motion" the camera jumps instead of flying.
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { latLonToVector3 } from "../geo/latLon";
import {
  APPROACH_DISTANCE,
  APPROACH_SECONDS,
  approachPosition,
  NEAR_HINT_DISTANCE,
  type Vec3,
} from "./strataCamera";
import type { StrataPhase } from "./useStrataMode";

type StrataApproachProps = {
  phase: StrataPhase;
  lat: number;
  lon: number;
  onArrive: () => void;
  onReturn: () => void;
  onNear: (near: boolean) => void;
};

export function StrataApproach({
  phase,
  lat,
  lon,
  onArrive,
  onReturn,
  onNear,
}: StrataApproachProps) {
  const camera = useThree((state) => state.camera);
  const flight = useRef<{
    phase: StrataPhase;
    from: Vec3;
    to: Vec3;
    t: number;
    done: boolean;
  } | null>(null);
  // Where the camera was before the layer view was opened.
  const home = useRef<Vec3 | null>(null);
  const near = useRef(false);

  useFrame((_, delta) => {
    if (phase === "off") {
      flight.current = null;
      const isNear = camera.position.length() < NEAR_HINT_DISTANCE;
      if (isNear !== near.current) {
        near.current = isNear;
        onNear(isNear);
      }
      return;
    }
    if (phase !== "approach" && phase !== "return") return;
    if (!flight.current || flight.current.phase !== phase) {
      const here: Vec3 = [
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ];
      if (phase === "approach") {
        home.current = here;
        const point = latLonToVector3(lat, lon, APPROACH_DISTANCE);
        flight.current = {
          phase,
          from: here,
          to: [point.x, point.y, point.z],
          t: 0,
          done: false,
        };
      } else {
        flight.current = {
          phase,
          from: here,
          to: home.current ?? here,
          t: 0,
          done: false,
        };
      }
    }
    const current = flight.current;
    if (current.done) return;
    current.t = prefersReducedMotion()
      ? 1
      : Math.min(1, current.t + Math.min(delta, 0.25) / APPROACH_SECONDS);
    const [x, y, z] = approachPosition(current.from, current.to, current.t);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    if (current.t >= 1) {
      current.done = true;
      if (phase === "approach") onArrive();
      else onReturn();
    }
  });

  return null;
}
