import { analysisUrl } from "../analysis/trends";
import type { AnomalySeries } from "./seriesMath";

// data/analysis/anomalies.json, written with trends.json by
// `uv run python -m trend_detective.trends`. Keys are the same as there.
export type AnomaliesFile = {
  series: Record<string, AnomalySeries>;
};

export async function loadAnomalies(): Promise<AnomaliesFile> {
  const response = await fetch(analysisUrl("anomalies.json"));
  if (!response.ok) throw new Error(`${response.status} anomalies.json`);
  return (await response.json()) as AnomaliesFile;
}
