// The particles of one variable inside the layer view: the same shape, color
// and value → count / size / speed mapping as on the globe (formMapping.ts,
// encodeForm, formColor), moved by slabParticleState inside the variable's
// range of the stack.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  InstancedMesh,
  Object3D,
  type BufferGeometry,
  type MeshStandardMaterial,
} from "three";
import { encodeForm } from "../forms/encoding";
import { formColor } from "../forms/formColor";
import { formSpec } from "../forms/formMapping";
import {
  aerosolGrainGeometry,
  dropletGeometry,
  leafGeometry,
  moleculeGeometry,
  roundAirGeometry,
  soilLensGeometry,
  thermalPointGeometry,
} from "../forms/geometries";
import { MAX_FORM_PARTICLES } from "../forms/particleField";
import { seedFromId } from "../forms/shellSamples";
import type { LayerDefinition } from "../layers/registry";
import type { FormId } from "../mock/snapshot";
import {
  particleRange,
  PLATFORM_DEPTH,
  PLATFORM_WIDTH,
  type StratumBox,
} from "./strataLayout";
import {
  createSlabParticle,
  slabParticleState,
  slabSamples,
  type SlabBox,
} from "./strataMotion";
import type { StrataAssignment } from "./strataSpec";

// The globe's shapes are sized for a scene where the Earth's radius is 1;
// the platforms are a few units wide, so the shapes are enlarged to read.
export const PARTICLE_SCALE = 3.2;
const JITTER = 0.012 * PARTICLE_SCALE;

const formGeometry: Record<FormId, () => BufferGeometry> = {
  "water-droplet": dropletGeometry,
  "round-air": roundAirGeometry,
  "thermal-motion": thermalPointGeometry,
  "water-vapor": () => moleculeGeometry("H2O"),
  "soil-water": soilLensGeometry,
  "ozone-molecule": () => moleculeGeometry("O3"),
  "aerosol-grain": aerosolGrainGeometry,
  leaf: leafGeometry,
};

type StrataParticlesProps = {
  layer: LayerDefinition;
  assignment: StrataAssignment;
  // Normalized reading of the month, 0..1.
  value: number;
  hasData: boolean;
  // The layer's share of the common particle budget (layerParticleCap).
  cap: number;
  opacity: number;
  boxesRef: RefObject<StratumBox[]>;
  timeRef: RefObject<number>;
};

export function StrataParticles({
  layer,
  assignment,
  value,
  hasData,
  cap,
  opacity,
  boxesRef,
  timeRef,
}: StrataParticlesProps) {
  const spec = formSpec(layer.id);
  const mesh = useRef<InstancedMesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const formId = spec?.formId ?? "round-air";
  const geometry = useMemo(() => formGeometry[formId](), [formId]);
  const samples = useMemo(
    () => slabSamples(seedFromId(layer.id), MAX_FORM_PARTICLES),
    [layer.id],
  );
  const scratch = useRef({
    dummy: new Object3D(),
    state: createSlabParticle(),
    box: {
      halfWidth: PLATFORM_WIDTH / 2,
      halfDepth: PLATFORM_DEPTH / 2,
      from: 0,
      to: 0,
    } as SlabBox,
  });
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const points = mesh.current;
    if (!points || !spec) return;
    const range = particleRange(assignment, boxesRef.current ?? []);
    if (!range) {
      points.count = 0;
      return;
    }
    const encoding = encodeForm(value, spec.encoding, { cap, hasData });
    const count = Math.min(MAX_FORM_PARTICLES, encoding.count);
    const time = (timeRef.current ?? 0) * encoding.speed;
    const { dummy, state, box } = scratch.current;
    box.from = range.from;
    box.to = range.to;
    // Rain points its tip at the ground, as on the globe.
    const flip = spec.motion === "fall" ? Math.PI : 0;
    points.count = count;
    for (let index = 0; index < count; index += 1) {
      slabParticleState(
        spec.motion,
        samples.u[index] ?? 0,
        samples.v[index] ?? 0,
        samples.phases[index] ?? 0,
        time,
        box,
        JITTER,
        state,
      );
      dummy.position.set(state.x, state.y, state.z);
      if (state.flat) dummy.rotation.set(0, state.spin, 0);
      else if (spec.motion === "fall" || spec.motion === "rise")
        dummy.rotation.set(flip, state.spin, 0);
      else dummy.rotation.set(state.spin, state.spin * 0.7, state.spin * 1.3);
      dummy.scale.setScalar(encoding.size * state.scale * PARTICLE_SCALE);
      dummy.updateMatrix();
      points.setMatrixAt(index, dummy.matrix);
    }
    points.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = opacity * 0.9;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, MAX_FORM_PARTICLES]}
      frustumCulled={false}
      raycast={() => null}
    >
      <meshStandardMaterial
        ref={material}
        color={formColor(layer)}
        transparent
        opacity={0}
        roughness={0.4}
        metalness={0.02}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
