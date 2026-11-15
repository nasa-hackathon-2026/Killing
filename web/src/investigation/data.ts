// Facts the investigation panel needs besides the merged trends: which FDR
// family a series belongs to (and how big it is), and each variable's
// product and catalog name. Both are read from the published files.
import { analysisUrl, WORLD_ANALYSIS } from "../analysis/trends";
import { snapshotUrl } from "../snapshot/loadSnapshot";

export type PanelFacts = {
  // Keys of the world subset's trends (their q values are its own family).
  worldKeys: Set<string>;
  familySizes: { core: number; world: number };
  products: Record<string, string>;
};

type TrendsSummary = {
  summary?: { n_analyzed?: number };
  series: Record<string, unknown>;
};

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}

export async function loadPanelFacts(): Promise<PanelFacts> {
  const [core, world, catalog] = await Promise.all([
    json<TrendsSummary>(analysisUrl("trends.json")),
    json<TrendsSummary>(analysisUrl(`${WORLD_ANALYSIS}trends.json`)).catch(
      () => null,
    ),
    json<{ variables: { id: string; product?: string }[] }>(
      snapshotUrl("catalog.json"),
    ).catch(() => ({ variables: [] })),
  ]);
  const products: Record<string, string> = {};
  for (const variable of catalog.variables) {
    if (variable.product) products[variable.id] = variable.product;
  }
  return {
    worldKeys: new Set(Object.keys(world?.series ?? {})),
    familySizes: {
      core: core.summary?.n_analyzed ?? Object.keys(core.series).length,
      world:
        world?.summary?.n_analyzed ?? Object.keys(world?.series ?? {}).length,
    },
    products,
  };
}
