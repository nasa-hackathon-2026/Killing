import type { BufferGeometry } from "three";
import type { FormId } from "../../mock/snapshot";
import {
  aerosolGrainGeometry,
  dropletGeometry,
  leafGeometry,
  moleculeGeometry,
  roundAirGeometry,
  soilLensGeometry,
  thermalPointGeometry,
} from "../geometries";

const SHAPES: Record<FormId, () => BufferGeometry> = {
  "water-droplet": dropletGeometry,
  "round-air": roundAirGeometry,
  "thermal-motion": thermalPointGeometry,
  "water-vapor": () => moleculeGeometry("H2O"),
  "soil-water": soilLensGeometry,
  "ozone-molecule": () => moleculeGeometry("O3"),
  "aerosol-grain": aerosolGrainGeometry,
  leaf: leafGeometry,
};

// The flat forms lie on the ground in the Lively style; here they are
// tipped towards the reader so they do not show edge-on.
const TILT: Partial<Record<FormId, number>> = {
  "soil-water": Math.PI / 3,
  leaf: Math.PI / 2.4,
};

// One unit of the Calm style: the form's own far-away shape, centered and
// sized to fit a sphere of radius 1. A round particle when the layer has no
// form.
export function calmUnitGeometry(formId: FormId | null): BufferGeometry {
  const geometry = (formId ? SHAPES[formId] : roundAirGeometry)();
  const tilt = formId ? TILT[formId] : undefined;
  if (tilt) geometry.rotateX(tilt);
  geometry.center();
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 1;
  geometry.scale(1 / radius, 1 / radius, 1 / radius);
  geometry.computeVertexNormals();
  return geometry;
}
