import { strataAssignment, strata, type StratumId } from "../strata/strataSpec";
import type { LayerDefinition } from "./registry";

export type LayerGroup = {
  id: StratumId | "other";
  layers: LayerDefinition[];
};

// The layers grouped by the stratum they stand on in the layer view (the
// table in strata/strataSpec.ts), top of the atmosphere first, so the list
// reads in the same order as the platforms. A layer the table does not list
// goes to a last group "other", so nothing is hidden. Empty groups are left
// out; the order inside a group is the order of `layers`.
export function groupLayers(layers: LayerDefinition[]): LayerGroup[] {
  const groups: LayerGroup[] = strata.map((item) => ({
    id: item.id,
    layers: layers.filter(
      (layer) => strataAssignment(layer.id)?.stratum === item.id,
    ),
  }));
  groups.push({
    id: "other",
    layers: layers.filter((layer) => !strataAssignment(layer.id)),
  });
  return groups.filter((group) => group.layers.length > 0);
}
