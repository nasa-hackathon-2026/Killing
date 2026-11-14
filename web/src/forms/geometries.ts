import { BufferGeometry, IcosahedronGeometry, SphereGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  atomPositions,
  elements,
  type MoleculeId,
} from "../chemistry/molecules";

// One angstrom in scene units for the far-away molecule shapes. Not to scale
// with the Earth, of course; chosen so a molecule reads as a small particle.
const ANGSTROM = 0.0075;

// Space-filling shape of one molecule: a sphere per atom at the bond length
// and angle from chemistry/molecules.ts, each with its van der Waals radius.
export function moleculeGeometry(id: MoleculeId): BufferGeometry {
  const parts = atomPositions(id).map((atom) => {
    const sphere = new SphereGeometry(
      elements[atom.element].vdwRadius * ANGSTROM,
      8,
      6,
    );
    sphere.translate(atom.x * ANGSTROM, atom.y * ANGSTROM, 0);
    return sphere;
  });
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged ?? new SphereGeometry(ANGSTROM, 8, 6);
}

export function thermalPointGeometry(): BufferGeometry {
  return new IcosahedronGeometry(0.011, 1);
}

// An irregular grain: an icosahedron with its corners pushed in and out by a
// fixed pattern. Schematic; real aerosol shapes vary by type.
export function aerosolGrainGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.014, 0);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const warp = 1 + 0.32 * Math.sin(x * 900 + y * 500 + z * 700);
    position.setXYZ(index, x * warp, y * warp * 0.8, z * warp);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A flat lens of water lying on the ground (+y is up, away from the Earth).
export function soilLensGeometry(): BufferGeometry {
  const geometry = new SphereGeometry(0.02, 10, 6);
  geometry.scale(1, 0.18, 1);
  return geometry;
}

// A leaf: a thin pointed oval lying flat (+y is up, away from the Earth).
export function leafGeometry(): BufferGeometry {
  const geometry = new SphereGeometry(0.022, 10, 6);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const taper = 1 - Math.pow(Math.abs(x) / 0.022, 1.6);
    position.setZ(index, position.getZ(index) * 0.55 * taper);
    position.setY(index, position.getY(index) * 0.1);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A teardrop (+y is the pointed end). Used by WaterDroplets and by the layer
// view.
export function dropletGeometry(): BufferGeometry {
  const geometry = new SphereGeometry(0.018, 10, 12);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    const along = (y + 0.018) / 0.036;
    const pinch = 1 - Math.pow(Math.max(0, along - 0.42) / 0.58, 1.35);
    position.setX(index, position.getX(index) * (0.28 + 0.72 * pinch));
    position.setZ(index, position.getZ(index) * (0.28 + 0.72 * pinch));
    if (along > 0.42) position.setY(index, y + (along - 0.42) * 0.028);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// The round air particle of RoundAirParticles and of the layer view.
export function roundAirGeometry(): BufferGeometry {
  return new SphereGeometry(0.02, 10, 8);
}
