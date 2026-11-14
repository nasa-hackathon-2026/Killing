import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  ConeGeometry,
  InstancedMesh,
  Object3D,
  Vector3,
  type MeshBasicMaterial,
} from "three";
import { seedFromId, shellSamples } from "./shellSamples";

export const TREND_ARROW_COUNT = 16;

type TrendArrowsProps = {
  // +1: significant rise (arrows point away from the Earth); -1: significant
  // fall (towards it); 0 draws nothing. See trendArrowDirection.
  direction: number;
  radius: number;
  color: string;
  timeRef: RefObject<number>;
  opacityRef: RefObject<number>;
};

// A few arrows above a layer that say which way its long-term trend goes.
// They only appear for a trend the trend file calls significant.
export function TrendArrows({
  direction,
  radius,
  color,
  timeRef,
  opacityRef,
}: TrendArrowsProps) {
  const mesh = useRef<InstancedMesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const geometry = useMemo(() => new ConeGeometry(0.012, 0.045, 6), []);
  const samples = useMemo(() => shellSamples(seedFromId("trend-arrows")), []);
  const scratch = useRef({
    dummy: new Object3D(),
    aim: new Vector3(),
    up: new Vector3(0, 1, 0),
  });
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const arrows = mesh.current;
    if (!arrows) return;
    const shown = opacityRef.current ?? 0;
    const active = direction !== 0 && shown >= 0.02;
    arrows.count = active ? TREND_ARROW_COUNT : 0;
    if (!active) return;
    const time = timeRef.current ?? 0;
    const { dummy, aim, up } = scratch.current;
    for (let index = 0; index < TREND_ARROW_COUNT; index += 1) {
      const phase = samples.phases[index] ?? 0;
      const bob = ((time * 0.25 + phase) % 1) * 0.05 * direction;
      const x = samples.directions[index * 3] ?? 0;
      const y = samples.directions[index * 3 + 1] ?? 1;
      const z = samples.directions[index * 3 + 2] ?? 0;
      dummy.position.set(x, y, z).multiplyScalar(radius + bob);
      aim.set(x, y, z).multiplyScalar(direction);
      dummy.quaternion.setFromUnitVectors(up, aim);
      dummy.updateMatrix();
      arrows.setMatrixAt(index, dummy.matrix);
    }
    arrows.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = shown;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, TREND_ARROW_COUNT]}
      frustumCulled={false}
    >
      <meshBasicMaterial
        ref={material}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
