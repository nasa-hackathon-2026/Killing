import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Points,
  SphereGeometry,
  type MeshStandardMaterial,
  type PointsMaterial,
} from "three";
import { formRegistry } from "../forms/registry";
import type { LayerDefinition } from "./registry";

const MAX_PARTICLES = 480;

type GlassParticleLayerProps = {
  layer: LayerDefinition;
  visible: boolean;
  opacity: number;
  intensity: number;
};

function shellGeometry(radius: number, seed: number) {
  const geometry = new SphereGeometry(radius, 40, 24);
  const position = geometry.attributes.position;
  if (!(position instanceof BufferAttribute)) return geometry;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const warp =
      1 +
      0.035 *
        Math.sin(x * 5.5 + seed) *
        Math.cos(y * 4.2 + seed * 0.7) *
        Math.sin(z * 6.1);
    position.setXYZ(index, x * warp, y * warp, z * warp);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function particlePositions(seed: number) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < MAX_PARTICLES; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 1.08 + random() * 0.22;
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  return positions;
}

function seedFromId(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function GlassParticleLayer({
  layer,
  visible,
  opacity,
  intensity,
}: GlassParticleLayerProps) {
  const glass = useRef<MeshStandardMaterial>(null);
  const points = useRef<Points>(null);
  const pointMaterial = useRef<PointsMaterial>(null);
  const shown = useRef(visible ? opacity : 0);
  const time = useRef(0);
  const form = formRegistry.find((item) => item.id === layer.formId);
  const FormParticles = form?.Component;
  const shell = useMemo(
    () => shellGeometry(layer.shellRadius, seedFromId(layer.id)),
    [layer.id, layer.shellRadius],
  );
  const geometry = useMemo(() => {
    const buffer = new BufferGeometry();
    buffer.setAttribute(
      "position",
      new BufferAttribute(particlePositions(seedFromId(layer.id)), 3),
    );
    buffer.setDrawRange(0, 0);
    return buffer;
  }, [layer.id]);

  useFrame((_, delta) => {
    const target = visible ? opacity : 0;
    shown.current += (target - shown.current) * (1 - Math.exp(-5 * delta));
    time.current += delta;
    const amount = shown.current;
    if (glass.current) glass.current.opacity = amount * 0.38;
    if (form) return;
    if (pointMaterial.current) pointMaterial.current.opacity = amount;
    const position = geometry.getAttribute("position");
    if (!(position instanceof BufferAttribute)) return;
    const array = position.array as Float32Array;
    const count = Math.round(
      Math.min(1, Math.max(0, intensity)) * MAX_PARTICLES * amount,
    );
    geometry.setDrawRange(0, count);
    const fall = layer.motion === "fall";
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      let x = array[offset];
      let y = array[offset + 1];
      let z = array[offset + 2];
      const length = Math.hypot(x, y, z) || 1;
      if (fall) {
        const next = length - delta * 0.18;
        const reset = next < layer.shellRadius;
        const radius = reset ? 1.28 : next;
        x = (x / length) * radius;
        y = (y / length) * radius;
        z = (z / length) * radius;
      } else {
        const turn = delta * 0.15;
        const nextX = x * Math.cos(turn) - z * Math.sin(turn);
        const nextZ = x * Math.sin(turn) + z * Math.cos(turn);
        x = nextX;
        z = nextZ;
      }
      array[offset] = x;
      array[offset + 1] = y;
      array[offset + 2] = z;
    }
    position.needsUpdate = true;
    if (points.current) points.current.visible = amount > 0.02;
  });

  return (
    <group>
      <mesh geometry={shell}>
        <meshStandardMaterial
          ref={glass}
          color={layer.glassColor}
          transparent
          opacity={0}
          roughness={0.2}
          metalness={0.04}
          depthWrite={false}
        />
      </mesh>
      {FormParticles ? (
        <FormParticles
          value={intensity}
          timeRef={time}
          opacityRef={shown}
          color={layer.particleColor}
        />
      ) : (
        <points ref={points} geometry={geometry}>
          <pointsMaterial
            ref={pointMaterial}
            color={layer.particleColor}
            size={layer.motion === "fall" ? 0.018 : 0.014}
            transparent
            opacity={0}
            depthWrite={false}
            sizeAttenuation
          />
        </points>
      )}
    </group>
  );
}
