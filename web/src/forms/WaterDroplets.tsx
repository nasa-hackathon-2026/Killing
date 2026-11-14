import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import {
  InstancedMesh,
  Object3D,
  Vector3,
  type MeshStandardMaterial,
} from "three";
import { dropletGeometry } from "./geometries";
import { motionSpeed, particleCount } from "./particleField";
import { seedFromId, shellSamples } from "./shellSamples";

type WaterDropletsProps = {
  value: number;
  timeRef: RefObject<number>;
  opacityRef: RefObject<number>;
  color: string;
  maxCount?: number;
  hasData?: boolean;
};

export function WaterDroplets({
  value,
  timeRef,
  opacityRef,
  color,
  maxCount,
  hasData,
}: WaterDropletsProps) {
  const mesh = useRef<InstancedMesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const geometry = useMemo(() => dropletGeometry(), []);
  const samples = useMemo(() => shellSamples(seedFromId("water-droplet")), []);
  const scratch = useRef({
    dummy: new Object3D(),
    inward: new Vector3(),
    up: new Vector3(0, 1, 0),
  });

  useFrame(() => {
    const points = mesh.current;
    if (!points) return;
    const shown = opacityRef.current ?? 0;
    const count = shown < 0.02 ? 0 : particleCount(value, maxCount, hasData);
    const speed = motionSpeed(value);
    const time = timeRef.current ?? 0;
    const { dummy, inward, up } = scratch.current;
    points.count = count;
    for (let index = 0; index < count; index += 1) {
      const phase = samples.phases[index] ?? 0;
      const travel = (time * speed * 0.45 + phase * 2.4) % 2.4;
      const radius = 1.3 - (travel / 2.4) * 0.24;
      const x = (samples.directions[index * 3] ?? 0) * radius;
      const y = (samples.directions[index * 3 + 1] ?? 0) * radius;
      const z = (samples.directions[index * 3 + 2] ?? 0) * radius;
      dummy.position.set(x, y, z);
      inward.set(-x, -y, -z).normalize();
      dummy.quaternion.setFromUnitVectors(up, inward);
      const scale = 0.85 + value * 0.55;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      points.setMatrixAt(index, dummy.matrix);
    }
    points.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = shown * 0.9;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, samples.phases.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        ref={material}
        color={color}
        transparent
        opacity={0}
        roughness={0.25}
        metalness={0.02}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
