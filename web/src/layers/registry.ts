import { mockVariables, type MockVariable } from "../mock/snapshot";

export type LayerDefinition = MockVariable & {
  shellRadius: number;
};

// One entry is one layer. Add a variable here; GlassParticleLayer draws it.
export const layerRegistry: LayerDefinition[] = mockVariables.map(
  (variable, index) => ({
    ...variable,
    shellRadius: 1.045 + index * 0.012,
  }),
);

export function initialLayerVisibility(id: string): boolean {
  return id === "imerg_precip";
}
