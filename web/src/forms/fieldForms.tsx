// The forms drawn by SubstanceField. One component per form so the registry
// keeps its "one entry is one form" shape.
import {
  aerosolGrainGeometry,
  leafGeometry,
  moleculeGeometry,
  soilLensGeometry,
  thermalPointGeometry,
} from "./geometries";
import type { SubstanceFormProps } from "./registry";
import { SubstanceField, type FieldStyle } from "./SubstanceField";

const thermal: FieldStyle = {
  geometry: thermalPointGeometry,
  roughness: 0.35,
  opacity: 0.9,
};
const vapor: FieldStyle = {
  geometry: () => moleculeGeometry("H2O"),
  roughness: 0.25,
  opacity: 0.85,
};
const soil: FieldStyle = {
  geometry: soilLensGeometry,
  roughness: 0.15,
  opacity: 0.8,
};
const ozone: FieldStyle = {
  geometry: () => moleculeGeometry("O3"),
  roughness: 0.4,
  opacity: 0.85,
};
const aerosol: FieldStyle = {
  geometry: aerosolGrainGeometry,
  roughness: 0.9,
  opacity: 0.85,
};
const leaf: FieldStyle = {
  geometry: leafGeometry,
  roughness: 0.6,
  opacity: 0.9,
};

export function ThermalMotion(props: SubstanceFormProps) {
  return (
    <SubstanceField {...props} style={thermal} defaultVariableId="gldas_tair" />
  );
}

export function WaterVapor(props: SubstanceFormProps) {
  return (
    <SubstanceField {...props} style={vapor} defaultVariableId="airs_h2ovap" />
  );
}

export function SoilWater(props: SubstanceFormProps) {
  return (
    <SubstanceField
      {...props}
      style={soil}
      defaultVariableId="gldas_soilmoist"
    />
  );
}

export function OzoneMolecules(props: SubstanceFormProps) {
  return <SubstanceField {...props} style={ozone} defaultVariableId="omi_o3" />;
}

export function AerosolGrains(props: SubstanceFormProps) {
  return (
    <SubstanceField
      {...props}
      style={aerosol}
      defaultVariableId="omi_aerosol"
    />
  );
}

export function Leaves(props: SubstanceFormProps) {
  return (
    <SubstanceField {...props} style={leaf} defaultVariableId="modis_ndvi" />
  );
}
