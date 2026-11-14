import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  SphereGeometry,
  Vector3,
  type Camera,
} from "three";
import {
  atomPositions,
  elements,
  type MoleculeId,
} from "../chemistry/molecules";
import { motionScale } from "../forms/reducedMotion";
import { closeUp, type CloseUpId } from "./closeUps";
import { labelingPainter, type CloseUpLabel } from "./labels";
import {
  ANGSTROM,
  ATOM_RADIUS_FRACTION,
  backdropFor,
  MAX_CLOSEUP_ATOMS,
  MAX_CLOSEUP_BLOBS,
  MAX_CLOSEUP_SOLIDS,
  scripts,
  WATER_SURFACE_Y,
  type Painter,
} from "./scripts";

type CloseUpSceneProps = {
  id: CloseUpId;
  value: number;
  kelvin: number | null;
  // The element whose child spans are the label pool (see CloseUpPanel).
  // Labels are plain HTML over the canvas, placed every frame.
  labelLayer?: RefObject<HTMLDivElement | null>;
};

type Atom = { x: number; y: number; radius: number; color: Color };

const moleculeIds: MoleculeId[] = [
  "H2O",
  "NO2",
  "O3",
  "N2",
  "O2",
  "CO2",
  "NO",
  "O",
];

function atomTable(): Record<MoleculeId, Atom[]> {
  const table = {} as Record<MoleculeId, Atom[]>;
  for (const id of moleculeIds) {
    table[id] = atomPositions(id).map((atom) => ({
      x: atom.x * ANGSTROM,
      y: atom.y * ANGSTROM,
      radius:
        elements[atom.element].vdwRadius * ATOM_RADIUS_FRACTION * ANGSTROM,
      color: new Color(elements[atom.element].cpkColor),
    }));
  }
  return table;
}

// Moves the pooled label spans of `layer` onto the labelled things.
function placeLabels(
  layer: HTMLElement,
  labels: CloseUpLabel[],
  camera: Camera,
  size: { width: number; height: number },
  point: Vector3,
) {
  const spans = layer.children;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index] as HTMLElement;
    const label = labels[index];
    if (!label) {
      span.hidden = true;
      continue;
    }
    point.set(label.x, label.y, label.z).project(camera);
    const left = (point.x * 0.5 + 0.5) * size.width;
    const top = (0.5 - point.y * 0.5) * size.height;
    if (span.textContent !== label.text) span.textContent = label.text;
    span.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) translate(-50%, -100%)`;
    span.hidden = false;
  }
}

// 100 nm across at the scale of the molecules: 1000 angstrom.
const AEROSOL_RADIUS = 500 * ANGSTROM;

// Draws one close-up: its script paints molecules, photons, grains and water
// into three instanced meshes, so a view costs three draw calls plus its
// backdrop.
export function CloseUpScene({
  id,
  value,
  kelvin,
  labelLayer,
}: CloseUpSceneProps) {
  const atoms = useRef<InstancedMesh>(null);
  const solids = useRef<InstancedMesh>(null);
  const blobs = useRef<InstancedMesh>(null);
  const time = useRef(0);
  const sphere = useMemo(() => new SphereGeometry(1, 16, 12), []);
  const rough = useMemo(() => new IcosahedronGeometry(1, 1), []);
  const table = useMemo(() => atomTable(), []);
  const scratch = useRef({
    dummy: new Object3D(),
    color: new Color(),
    point: new Vector3(),
    labels: [] as CloseUpLabel[],
  });
  const scene = closeUp(id)?.scene ?? "reaction";
  const backdrop = backdropFor[scene];
  useEffect(
    () => () => {
      sphere.dispose();
      rough.dispose();
    },
    [sphere, rough],
  );

  useFrame((state, delta) => {
    const atomMesh = atoms.current;
    const solidMesh = solids.current;
    const blobMesh = blobs.current;
    if (!atomMesh || !solidMesh || !blobMesh) return;
    time.current += Math.min(delta, 0.1) * motionScale();
    const { dummy, color, point, labels } = scratch.current;
    labels.length = 0;
    let atomCount = 0;
    let solidCount = 0;
    let blobCount = 0;
    dummy.rotation.set(0, 0, 0);
    const painter: Painter = {
      molecule(molecule, x, y, z, rotation, scale = 1) {
        if (scale <= 0.001) return;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        for (const atom of table[molecule]) {
          if (atomCount >= MAX_CLOSEUP_ATOMS) return;
          dummy.position.set(
            x + (atom.x * cos - atom.y * sin) * scale,
            y + (atom.x * sin + atom.y * cos) * scale,
            z,
          );
          dummy.scale.setScalar(atom.radius * scale);
          dummy.updateMatrix();
          atomMesh.setMatrixAt(atomCount, dummy.matrix);
          atomMesh.setColorAt(atomCount, atom.color);
          atomCount += 1;
        }
      },
      solid(x, y, z, radius, hex) {
        if (solidCount >= MAX_CLOSEUP_SOLIDS) return;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(radius);
        dummy.updateMatrix();
        solidMesh.setMatrixAt(solidCount, dummy.matrix);
        solidMesh.setColorAt(solidCount, color.set(hex));
        solidCount += 1;
      },
      blob(x, y, z, radius) {
        if (blobCount >= MAX_CLOSEUP_BLOBS || radius <= 0.001) return;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(radius);
        dummy.updateMatrix();
        blobMesh.setMatrixAt(blobCount, dummy.matrix);
        blobCount += 1;
      },
    };
    scripts[id](
      { time: time.current, value, kelvin },
      labelingPainter(painter, labels),
    );
    // Labels do not depend on the clock advancing, so they are also placed
    // when the system asks for reduced motion.
    const layer = labelLayer?.current;
    if (layer) placeLabels(layer, labels, state.camera, state.size, point);
    atomMesh.count = atomCount;
    solidMesh.count = solidCount;
    blobMesh.count = blobCount;
    atomMesh.instanceMatrix.needsUpdate = true;
    solidMesh.instanceMatrix.needsUpdate = true;
    blobMesh.instanceMatrix.needsUpdate = true;
    if (atomMesh.instanceColor) atomMesh.instanceColor.needsUpdate = true;
    if (solidMesh.instanceColor) solidMesh.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[2, 3, 5]} intensity={1.3} />
      <instancedMesh
        ref={atoms}
        args={[sphere, undefined, MAX_CLOSEUP_ATOMS]}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.35} metalness={0.02} />
      </instancedMesh>
      <instancedMesh
        ref={solids}
        args={[rough, undefined, MAX_CLOSEUP_SOLIDS]}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh
        ref={blobs}
        args={[sphere, undefined, MAX_CLOSEUP_BLOBS]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#5aa9e6"
          transparent
          opacity={0.38}
          roughness={0.15}
          depthWrite={false}
        />
      </instancedMesh>
      {backdrop === "water" ? (
        <mesh position={[0, WATER_SURFACE_Y - 1.5, -0.3]}>
          <boxGeometry args={[9, 3, 1]} />
          <meshStandardMaterial
            color="#2f6fad"
            transparent
            opacity={0.45}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {backdrop === "aerosol" ? (
        <mesh position={[0, -AEROSOL_RADIUS - 0.9, -1]}>
          <sphereGeometry args={[AEROSOL_RADIUS, 96, 64]} />
          <meshStandardMaterial color="#9a948c" roughness={0.95} />
        </mesh>
      ) : null}
      {backdrop === "leaf" ? (
        <mesh position={[0, 0, -0.4]} scale={[1.15, 0.8, 0.4]}>
          <sphereGeometry args={[1, 32, 20]} />
          <meshStandardMaterial
            color="#2f9e57"
            transparent
            opacity={0.7}
            roughness={0.6}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </>
  );
}
