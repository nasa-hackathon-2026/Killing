import {
  analysisUrl,
  mergeSeriesFiles,
  WORLD_ANALYSIS,
} from "../analysis/trends";
import type { AnomalySeries } from "./seriesMath";

// data/analysis/anomalies.json, written with trends.json by
// `uv run python -m trend_detective.trends`, plus the world subset's
// (data/analysis/world/anomalies.json) when it is published. Keys are the
// same as in trends.json.
export type AnomaliesFile = {
  series: Record<string, AnomalySeries>;
};

async function read(file: string): Promise<AnomaliesFile> {
  const response = await fetch(analysisUrl(file));
  if (!response.ok) throw new Error(`${response.status} ${file}`);
  return (await response.json()) as AnomaliesFile;
}

export async function loadAnomalies(): Promise<AnomaliesFile> {
  const [core, world] = await Promise.all([
    read("anomalies.json"),
    read(`${WORLD_ANALYSIS}anomalies.json`).catch(() => null),
  ]);
  return mergeSeriesFiles(core, world);
}
