import type { ComponentType, RefObject } from "react";
import type { FormId } from "../mock/snapshot";
import {
  AerosolGrains,
  Leaves,
  OzoneMolecules,
  SoilWater,
  ThermalMotion,
  WaterVapor,
} from "./fieldForms";
import { RoundAirParticles } from "./RoundAirParticles";
import { WaterDroplets } from "./WaterDroplets";

export type SubstanceFormProps = {
  value: number;
  timeRef: RefObject<number>;
  opacityRef: RefObject<number>;
  color: string;
  // Which variable's row of formMapping.ts to use. Forms shared by several
  // variables need it; the two original forms ignore it.
  variableId?: string;
  // The most particles this layer may draw (its share of the whole-globe
  // budget). Defaults to the form's own maximum.
  maxCount?: number;
  // False for a month without data: the form draws nothing.
  hasData?: boolean;
};

export type FormDefinition = {
  id: FormId;
  nameEn: string;
  variableId: string;
  Component: ComponentType<SubstanceFormProps>;
};

// One entry is one form. Add a component here; the lab page and the earth
// layer both read this list. `variableId` is the form's example variable;
// which variables actually use a form is set in formMapping.ts.
export const formRegistry: FormDefinition[] = [
  {
    id: "water-droplet",
    nameEn: "Water droplets",
    variableId: "imerg_precip",
    Component: WaterDroplets,
  },
  {
    id: "round-air",
    nameEn: "Round air particles",
    variableId: "omi_no2",
    Component: RoundAirParticles,
  },
  {
    id: "thermal-motion",
    nameEn: "Thermal motion",
    variableId: "gldas_tair",
    Component: ThermalMotion,
  },
  {
    id: "water-vapor",
    nameEn: "Water vapor molecules",
    variableId: "airs_h2ovap",
    Component: WaterVapor,
  },
  {
    id: "soil-water",
    nameEn: "Soil water lenses",
    variableId: "gldas_soilmoist",
    Component: SoilWater,
  },
  {
    id: "ozone-molecule",
    nameEn: "Ozone molecules",
    variableId: "omi_o3",
    Component: OzoneMolecules,
  },
  {
    id: "aerosol-grain",
    nameEn: "Aerosol grains",
    variableId: "omi_aerosol",
    Component: AerosolGrains,
  },
  {
    id: "leaf",
    nameEn: "Leaves",
    variableId: "modis_ndvi",
    Component: Leaves,
  },
];
