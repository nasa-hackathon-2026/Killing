import type { ComponentType, RefObject } from "react";
import type { FormId } from "../mock/snapshot";
import { RoundAirParticles } from "./RoundAirParticles";
import { WaterDroplets } from "./WaterDroplets";

export type SubstanceFormProps = {
  value: number;
  timeRef: RefObject<number>;
  opacityRef: RefObject<number>;
  color: string;
};

export type FormDefinition = {
  id: FormId;
  nameEn: string;
  variableId: string;
  Component: ComponentType<SubstanceFormProps>;
};

// One entry is one form. Add a component here; the lab page and the earth
// layer both read this list.
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
];
