import { layerRegistry } from "../../layers/registry";
import { formSpec } from "../formMapping";
import { CalmClusters, type CalmLayerInput } from "./CalmClusters";

type CalmLayersProps = {
  lat: number;
  lon: number;
  layers: { id: string; visible: boolean; opacity: number }[];
  intensities: Record<string, number>;
  available: Record<string, boolean>;
  usual?: Record<string, number | null>;
  trendDirections?: Record<string, number>;
};

// Turns the scene's per-layer records into the clusters of the Calm style:
// the open layers, lowest height band (formMapping.ts) first.
export function CalmLayers({
  lat,
  lon,
  layers,
  intensities,
  available,
  usual,
  trendDirections,
}: CalmLayersProps) {
  const open: CalmLayerInput[] = layerRegistry
    .flatMap((layer) => {
      const control = layers.find((item) => item.id === layer.id);
      if (!control?.visible) return [];
      return [
        {
          layer,
          opacity: control.opacity,
          value: intensities[layer.id] ?? 0,
          hasData: available[layer.id] ?? false,
          usual: usual?.[layer.id] ?? null,
          trendDirection: trendDirections?.[layer.id] ?? 0,
        },
      ];
    })
    .sort(
      (a, b) =>
        (formSpec(a.layer.id)?.band[0] ?? 1) -
        (formSpec(b.layer.id)?.band[0] ?? 1),
    );
  return <CalmClusters lat={lat} lon={lon} layers={open} />;
}
