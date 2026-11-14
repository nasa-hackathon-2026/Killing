import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { latLonToVector3 } from "../geo/latLon";
import { taiwanOverview } from "../mock/snapshot";

type FlyCameraProps = {
  flying: boolean;
  onDone: () => void;
};

export function FlyCamera({ flying, onDone }: FlyCameraProps) {
  const camera = useThree((state) => state.camera);
  const destination = useMemo(() => {
    const point = latLonToVector3(taiwanOverview.lat, taiwanOverview.lon, 1.85);
    return new Vector3(point.x, point.y, point.z);
  }, []);
  const finished = useRef(false);

  useFrame((_, delta) => {
    if (!flying) {
      finished.current = false;
      return;
    }
    if (finished.current) return;
    camera.position.lerp(destination, 1 - Math.exp(-2.8 * delta));
    camera.lookAt(0, 0, 0);
    if (camera.position.distanceTo(destination) < 0.03) {
      camera.position.copy(destination);
      camera.lookAt(0, 0, 0);
      finished.current = true;
      onDone();
    }
  });

  return null;
}
