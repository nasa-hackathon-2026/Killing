// The Calm particle style on the globe: one small cluster per open layer,
// floating above the selected place and always facing the reader. All the
// numbers come from calmMath.ts.
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Group,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  Vector3,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from "three";
import { latLonToVector3 } from "../../geo/latLon";
import type { LayerDefinition } from "../../layers/registry";
import { encodeForm } from "../encoding";
import { formColor } from "../formColor";
import { formSpec } from "../formMapping";
import { prefersReducedMotion } from "../reducedMotion";
import { calmUnitGeometry } from "./calmGeometry";
import {
  approach,
  CALM_BIG_RADIUS,
  CALM_CELL_RADIUS,
  CALM_GROUP_SIZE,
  CALM_MAX_UNITS,
  calmDriftSpeed,
  calmGrid,
  calmLayout,
  calmRadius,
  calmSlot,
  calmUnits,
  calmUnitValue,
  calmUsualRadius,
  calmViewScale,
} from "./calmMath";

// Radius of one unit in scene units (Earth = 1) for a single layer seen
// from the starting camera distance.
const UNIT_WORLD = 0.0235;
// How far above the surface the display floats, as a share of its size.
const LIFT = 0.07;
// Easing rates, per second.
const MOVE_RATE = 5;
const FADE_RATE = 5;
// How far a unit drifts from its place, in unit radii.
const DRIFT = 0.16;
const RING_SEGMENTS = 72;
const RING_WIDTH = 0.26;
const MAX_BIGS = CALM_MAX_UNITS / CALM_GROUP_SIZE;

export type CalmLayerInput = {
  layer: LayerDefinition;
  opacity: number;
  // Normalized value of the month (0..1) and whether the month has one.
  value: number;
  hasData: boolean;
  // Normalized mean of this calendar month; null when unknown.
  usual: number | null;
  // +1, -1 or 0; see trendArrowDirection in forms/encoding.ts.
  trendDirection: number;
};

type CalmClustersProps = {
  lat: number;
  lon: number;
  // Open layers, lowest height band first.
  layers: CalmLayerInput[];
};

// A ring of RING_SEGMENTS quads. Even segments come first in the index, so
// drawing half of the index gives a dashed ring.
function ringGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array((RING_SEGMENTS + 1) * 2 * 3), 3),
  );
  const index: number[] = [];
  for (const parity of [0, 1]) {
    for (let s = parity; s < RING_SEGMENTS; s += 2) {
      const a = s * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(index);
  return geometry;
}

function setRingRadius(
  geometry: BufferGeometry,
  radius: number,
  width: number,
) {
  const position = geometry.getAttribute("position");
  if (!(position instanceof BufferAttribute)) return;
  for (let s = 0; s <= RING_SEGMENTS; s += 1) {
    const angle = (s / RING_SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const outer = radius + width / 2;
    const inner = Math.max(0, radius - width / 2);
    position.setXYZ(s * 2, cos * inner, sin * inner, 0);
    position.setXYZ(s * 2 + 1, cos * outer, sin * outer, 0);
  }
  position.needsUpdate = true;
}

function CalmCluster({
  input,
  slotX,
  slotY,
  scale,
  labelRoom,
  facingRef,
}: {
  input: CalmLayerInput;
  slotX: number;
  slotY: number;
  scale: number;
  labelRoom: number;
  facingRef: RefObject<boolean>;
}) {
  const { layer, opacity, value, hasData, usual, trendDirection } = input;
  const group = useRef<Group>(null);
  const units = useRef<InstancedMesh>(null);
  const unitMaterial = useRef<MeshStandardMaterial>(null);
  const halos = useRef<InstancedMesh>(null);
  const haloMaterial = useRef<MeshBasicMaterial>(null);
  const disc = useRef<Mesh>(null);
  const discMaterial = useRef<MeshBasicMaterial>(null);
  const ring = useRef<Mesh>(null);
  const ringMaterial = useRef<MeshBasicMaterial>(null);
  const arrow = useRef<Mesh>(null);
  const arrowMaterial = useRef<MeshBasicMaterial>(null);
  const label = useRef<HTMLParagraphElement>(null);
  const color = formColor(layer);
  const unitGeometry = useMemo(
    () => calmUnitGeometry(layer.formId),
    [layer.formId],
  );
  const circle = useMemo(() => new CircleGeometry(1, 40), []);
  const triangle = useMemo(() => new CircleGeometry(1, 3), []);
  const ringShape = useMemo(() => ringGeometry(), []);
  useEffect(
    () => () => {
      unitGeometry.dispose();
      circle.dispose();
      triangle.dispose();
      ringShape.dispose();
    },
    [unitGeometry, circle, triangle, ringShape],
  );
  const state = useRef({
    started: false,
    time: 0,
    shown: 0,
    x: slotX,
    y: slotY,
    scale,
    // Per unit: x, y, size.
    unit: new Float32Array(CALM_MAX_UNITS * 3),
    // Per big shape: x, y, size.
    big: new Float32Array(MAX_BIGS * 3),
    disc: 0,
    discShown: 0,
    ring: 0,
    ringDrawn: -1,
    dummy: new Object3D(),
  });
  const speed = calmDriftSpeed(
    encodeForm(value, formSpec(layer.id)?.encoding ?? FALLBACK_ENCODING).speed,
  );

  useFrame((_, delta) => {
    const s = state.current;
    const still = prefersReducedMotion();
    // The first frame and "reduce motion" jump straight to the target.
    const move = still || !s.started ? 0 : MOVE_RATE;
    const fade = still ? 0 : FADE_RATE;
    s.started = true;
    if (!still) s.time += delta * speed;
    s.shown = approach(s.shown, opacity, delta, fade);
    s.x = approach(s.x, slotX, delta, move);
    s.y = approach(s.y, slotY, delta, move);
    s.scale = approach(s.scale, scale, delta, move);
    if (group.current) {
      group.current.position.set(s.x, s.y, 0);
      group.current.scale.setScalar(s.scale);
    }

    const count = calmUnits(value, hasData);
    const layout = calmLayout(count);
    const { dummy } = s;
    let drawn = 0;
    for (let i = 0; i < CALM_MAX_UNITS; i += 1) {
      const target = layout.units[i];
      const o = i * 3;
      if (target) {
        // A unit that appears starts at its own place, not at the center.
        if ((s.unit[o + 2] ?? 0) < 0.01 && move > 0) {
          s.unit[o] = target.x;
          s.unit[o + 1] = target.y;
        }
        s.unit[o] = approach(s.unit[o] ?? 0, target.x, delta, move);
        s.unit[o + 1] = approach(s.unit[o + 1] ?? 0, target.y, delta, move);
      }
      s.unit[o + 2] = approach(s.unit[o + 2] ?? 0, target ? 1 : 0, delta, move);
      const size = s.unit[o + 2] ?? 0;
      if (size > 0.01) drawn = i + 1;
      const phase = i * 2.399963;
      dummy.position.set(
        (s.unit[o] ?? 0) + DRIFT * Math.cos(s.time * 0.7 + phase),
        (s.unit[o + 1] ?? 0) + DRIFT * Math.sin(s.time + phase * 1.7),
        1,
      );
      dummy.rotation.set(0, 0, 0.18 * Math.sin(s.time * 0.5 + phase));
      dummy.scale.setScalar(size * 0.96);
      dummy.updateMatrix();
      units.current?.setMatrixAt(i, dummy.matrix);
    }
    if (units.current) {
      units.current.count = s.shown < 0.02 ? 0 : drawn;
      units.current.instanceMatrix.needsUpdate = true;
    }
    if (unitMaterial.current) unitMaterial.current.opacity = s.shown;

    let bigsDrawn = 0;
    dummy.rotation.set(0, 0, 0);
    for (let g = 0; g < MAX_BIGS; g += 1) {
      const target = layout.bigs[g];
      const o = g * 3;
      if (target) {
        if ((s.big[o + 2] ?? 0) < 0.01 && move > 0) {
          s.big[o] = target.x;
          s.big[o + 1] = target.y;
        }
        s.big[o] = approach(s.big[o] ?? 0, target.x, delta, move);
        s.big[o + 1] = approach(s.big[o + 1] ?? 0, target.y, delta, move);
      }
      s.big[o + 2] = approach(s.big[o + 2] ?? 0, target ? 1 : 0, delta, move);
      const size = s.big[o + 2] ?? 0;
      if (size > 0.01) bigsDrawn = g + 1;
      dummy.position.set(s.big[o] ?? 0, s.big[o + 1] ?? 0, 0.05);
      dummy.scale.setScalar(size * (CALM_BIG_RADIUS - 0.12));
      dummy.updateMatrix();
      halos.current?.setMatrixAt(g, dummy.matrix);
    }
    if (halos.current) {
      halos.current.count = s.shown < 0.02 ? 0 : bigsDrawn;
      halos.current.instanceMatrix.needsUpdate = true;
    }
    if (haloMaterial.current) haloMaterial.current.opacity = s.shown * 0.5;

    // The disc is this month on the unit scale; the ring is the usual month.
    const discTarget = calmRadius(calmUnitValue(value, hasData));
    if (discTarget > 0) s.disc = approach(s.disc, discTarget, delta, move);
    s.discShown = approach(s.discShown, hasData ? 1 : 0, delta, fade);
    if (disc.current) {
      disc.current.scale.setScalar(Math.max(0.001, s.disc));
      disc.current.visible = s.discShown * s.shown > 0.02;
    }
    if (discMaterial.current) {
      discMaterial.current.opacity = s.shown * s.discShown * 0.2;
    }
    const known = usual !== null;
    const ringTarget = known ? calmUsualRadius(usual) : calmRadius(1);
    s.ring = approach(s.ring, ringTarget, delta, move);
    if (Math.abs(s.ring - s.ringDrawn) > 0.002) {
      setRingRadius(ringShape, s.ring, RING_WIDTH / Math.max(0.3, s.scale));
      s.ringDrawn = s.ring;
    }
    // A month without data keeps a dashed ring only.
    ringShape.setDrawRange(
      0,
      hasData ? RING_SEGMENTS * 6 : (RING_SEGMENTS / 2) * 6,
    );
    if (ring.current) ring.current.visible = s.shown > 0.02;
    if (ringMaterial.current) {
      ringMaterial.current.opacity = s.shown * (known ? 0.95 : 0.45);
    }

    if (arrow.current) {
      const on = trendDirection !== 0 && hasData && s.shown > 0.02;
      arrow.current.visible = on;
      if (on) {
        const reach = Math.max(s.disc, s.ring) + 1.9;
        arrow.current.position.set(reach, 0, 0.5);
        arrow.current.rotation.z =
          (trendDirection > 0 ? 1 : -1) * (Math.PI / 2);
      }
    }
    if (arrowMaterial.current) arrowMaterial.current.opacity = s.shown;
    if (label.current) {
      label.current.style.visibility =
        facingRef.current && s.shown > 0.02 ? "visible" : "hidden";
    }
  });

  return (
    <group ref={group}>
      <mesh ref={disc} geometry={circle} renderOrder={1}>
        <meshBasicMaterial
          ref={discMaterial}
          color={color}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
      <instancedMesh
        ref={halos}
        args={[circle, undefined, MAX_BIGS]}
        frustumCulled={false}
        renderOrder={2}
      >
        <meshBasicMaterial
          ref={haloMaterial}
          color="#0b1220"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={units}
        args={[unitGeometry, undefined, CALM_MAX_UNITS]}
        frustumCulled={false}
        renderOrder={3}
      >
        <meshStandardMaterial
          ref={unitMaterial}
          color={color}
          transparent
          opacity={0}
          emissive={color}
          emissiveIntensity={0.5}
          roughness={0.35}
          metalness={0.02}
        />
      </instancedMesh>
      <mesh
        ref={ring}
        geometry={ringShape}
        position={[0, 0, 2.2]}
        frustumCulled={false}
        renderOrder={4}
      >
        <meshBasicMaterial
          ref={ringMaterial}
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={arrow} geometry={triangle} visible={false} renderOrder={4}>
        <meshBasicMaterial
          ref={arrowMaterial}
          color={layer.glassColor}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
      <Html
        position={[0, -(CALM_CELL_RADIUS + labelRoom / 2 / scale), 0]}
        center
        zIndexRange={[0, 0]}
        style={{ pointerEvents: "none" }}
      >
        <p
          ref={label}
          className={
            labelRoom > 3 ? "calm-label calm-label-small" : "calm-label"
          }
        >
          {layer.nameEn}
        </p>
      </Html>
    </group>
  );
}

const FALLBACK_ENCODING = {
  maxCount: 1,
  size: [1, 1] as [number, number],
  speed: [0.04, 1] as [number, number],
  speedLaw: "linear" as const,
};

export function CalmClusters({ lat, lon, layers }: CalmClustersProps) {
  const root = useRef<Group>(null);
  const leader = useRef<Mesh>(null);
  const facing = useRef(true);
  const aspect = useThree((three) => three.size.width / three.size.height);
  const plane = useMemo(() => new PlaneGeometry(1, 1), []);
  useEffect(() => () => plane.dispose(), [plane]);
  const { surface, normal } = useMemo(() => {
    const at = latLonToVector3(lat, lon, 1);
    const point = new Vector3(at.x, at.y, at.z);
    return { surface: point, normal: point.clone().normalize() };
  }, [lat, lon]);
  const scratch = useRef(new Vector3());
  const grid = calmGrid(layers.length, aspect);

  useFrame(({ camera }) => {
    const display = root.current;
    if (!display) return;
    const view = calmViewScale(camera.position.length());
    display.position.copy(normal).multiplyScalar(1 + LIFT * view);
    display.quaternion.copy(camera.quaternion);
    display.scale.setScalar(view * UNIT_WORLD);
    // Hidden while the place is on the far side of the Earth.
    facing.current = normal.dot(camera.position) > 1.02;
    display.visible = facing.current && layers.length > 0;
    // A thin line from the place's marker to the bottom of the display.
    if (leader.current) {
      display.updateMatrixWorld();
      const from = display.worldToLocal(scratch.current.copy(surface));
      const toY = 2.2;
      const dx = -from.x;
      const dy = toY - from.y;
      const length = Math.hypot(dx, dy);
      leader.current.position.set(from.x + dx / 2, from.y + dy / 2, from.z / 2);
      leader.current.rotation.z = Math.atan2(dy, dx);
      leader.current.scale.set(length, 0.14, 1);
    }
  });

  return (
    <group ref={root}>
      <mesh ref={leader} geometry={plane} renderOrder={1}>
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      {layers.map((input, index) => {
        const slot = calmSlot(index, layers.length, grid);
        return (
          <CalmCluster
            key={input.layer.id}
            input={input}
            slotX={slot.x}
            slotY={slot.y}
            scale={grid.scale}
            labelRoom={grid.labelRoom}
            facingRef={facing}
          />
        );
      })}
    </group>
  );
}
