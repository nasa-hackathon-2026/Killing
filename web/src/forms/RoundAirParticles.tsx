import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import {
  InstancedMesh,
  Object3D,
  SphereGeometry,
  type MeshStandardMaterial,
} from "three";
import { motionSpeed, particleCount } from "./particleField";
import { seedFromId, shellSamples } from "./shellSamples";

type RoundAirParticlesProps = {
  value: number;
  timeRef: RefObject<number>;
  opacityRef: RefObject<number>;
  color: string;
};

export function RoundAirParticles({
  value,
  timeRef,
  opacityRef,
  color,
}: RoundAirParticlesProps) {
  const mesh = useRef<InstancedMesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const geometry = useMemo(() => new SphereGeometry(0.02, 10, 8), []);
  const samples = useMemo(() => shellSamples(seedFromId("round-air")), []);
  const dummy = useRef(new Object3D());

  useFrame(() => {
    const points = mesh.current;
    if (!points) return;
    const shown = opacityRef.current ?? 0;
    const count = shown < 0.02 ? 0 : particleCount(value);
    const speed = motionSpeed(value);
    const time = timeRef.current ?? 0;
    const spin = time * speed * 0.35;
    points.count = count;
    for (let index = 0; index < count; index += 1) {
      const phase = samples.phases[index] ?? 0;
      const turn = spin + phase * Math.PI * 2;
      const x0 = samples.directions[index * 3] ?? 0;
      const y0 = samples.directions[index * 3 + 1] ?? 1;
      const z0 = samples.directions[index * 3 + 2] ?? 0;
      const radius = 1.12 + phase * 0.18;
      const x = (x0 * Math.cos(turn) - z0 * Math.sin(turn)) * radius;
      const z = (x0 * Math.sin(turn) + z0 * Math.cos(turn)) * radius;
      dummy.current.position.set(x, y0 * radius, z);
      dummy.current.rotation.set(0, 0, 0);
      dummy.current.scale.setScalar(0.75 + value * 0.7);
      dummy.current.updateMatrix();
      points.setMatrixAt(index, dummy.current.matrix);
    }
    points.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = shown * 0.85;
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
        roughness={0.45}
        metalness={0}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
