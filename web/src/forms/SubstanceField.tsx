import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  InstancedMesh,
  Object3D,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterial,
} from "three";
import { encodeForm } from "./encoding";
import { formSpec } from "./formMapping";
import { createParticleState, particleState } from "./motions";
import { MAX_FORM_PARTICLES } from "./particleField";
import type { SubstanceFormProps } from "./registry";
import { seedFromId, shellSamples } from "./shellSamples";

export type FieldStyle = {
  geometry: () => BufferGeometry;
  roughness: number;
  opacity: number;
};

type SubstanceFieldProps = SubstanceFormProps & {
  style: FieldStyle;
  // The variable whose row is used when the caller passes none.
  defaultVariableId: string;
};

// Draws any form that is "one instanced shape, moved by a motion from
// motions.ts, driven by a row of formMapping.ts".
export function SubstanceField({
  value,
  timeRef,
  opacityRef,
  color,
  variableId,
  style,
  defaultVariableId,
}: SubstanceFieldProps) {
  const id = variableId ?? defaultVariableId;
  const spec = formSpec(id) ?? formSpec(defaultVariableId);
  const mesh = useRef<InstancedMesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const geometry = useMemo(() => style.geometry(), [style]);
  const samples = useMemo(() => shellSamples(seedFromId(id)), [id]);
  const capacity = Math.min(
    MAX_FORM_PARTICLES,
    spec?.encoding.maxCount ?? MAX_FORM_PARTICLES,
  );
  const scratch = useRef({
    dummy: new Object3D(),
    outward: new Vector3(),
    up: new Vector3(0, 1, 0),
    state: createParticleState(),
  });
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const points = mesh.current;
    if (!points || !spec) return;
    const shown = opacityRef.current ?? 0;
    const encoding = encodeForm(value, spec.encoding);
    const count = shown < 0.02 ? 0 : Math.min(capacity, encoding.count);
    const time = (timeRef.current ?? 0) * encoding.speed;
    const { dummy, outward, up, state } = scratch.current;
    points.count = count;
    for (let index = 0; index < count; index += 1) {
      particleState(
        spec.motion,
        samples.directions[index * 3] ?? 0,
        samples.directions[index * 3 + 1] ?? 1,
        samples.directions[index * 3 + 2] ?? 0,
        samples.phases[index] ?? 0,
        time,
        spec.band,
        state,
      );
      dummy.position.set(state.x, state.y, state.z);
      if (state.radial) {
        outward.set(state.x, state.y, state.z).normalize();
        dummy.quaternion.setFromUnitVectors(up, outward);
        dummy.rotateY(state.spin);
      } else {
        dummy.rotation.set(state.spin, state.spin * 0.7, state.spin * 1.3);
      }
      dummy.scale.setScalar(encoding.size * state.scale);
      dummy.updateMatrix();
      points.setMatrixAt(index, dummy.matrix);
    }
    points.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = shown * style.opacity;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, capacity]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        ref={material}
        color={color}
        transparent
        opacity={0}
        roughness={style.roughness}
        metalness={0.02}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
