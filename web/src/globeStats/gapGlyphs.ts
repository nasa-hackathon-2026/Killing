import { issueAffectsTrend } from "../analysis/trendReliability";
import { placeName, variableName } from "../i18n/names";
import { GLOBE_STATS_TEXT as T } from "./globeStatsText";
import {
  formatSigned,
  type ModelVsObsFile,
  type Pair,
} from "../analysis/modelVsObs";

export type GapGlyph = {
  pairId: string;
  placeId: string;
  placeName: string;
  lat: number | null;
  lon: number | null;
  modelVariableId: string;
  modelName: string;
  unit: string;
  observationVariableId: string;
  observationName: string;
  modelSlope: number;
  observationSlope: number;
  correlation: number | null;
  commonMonths: number;
  disagreement: number | null;
  ringWidthPx: number;
  modelUnreliable: boolean;
  observationUnreliable: boolean;
  summary: string;
};

function stationPriority(variableId: string): number {
  if (variableId === "station_temp") return 0;
  if (variableId === "ghcnm_tavg") return 1;
  if (variableId === "ghcnm_tavg_unadj") return 2;
  return Number.POSITIVE_INFINITY;
}

function hasTrendAffectingIssue(
  issueIds: string[],
  issues: ModelVsObsFile["known_issues"],
): boolean {
  return issueIds.some((id) => {
    const kind = issues[id]?.kind;
    return kind !== undefined && issueAffectsTrend(kind);
  });
}

function ringWidth(correlation: number | null): number {
  if (correlation === null || !Number.isFinite(correlation)) return 2;
  const disagreement = Math.max(0, Math.min(2, 1 - correlation));
  return 2 + (5 * disagreement) / 2;
}

function gapSummary(
  placeName: string,
  modelName: string,
  observationName: string,
  modelSlope: number,
  observationSlope: number,
  correlation: number | null,
  unit: string,
): string {
  const unitText = unit ? ` ${unit}` : "";
  const correlationText =
    correlation === null
      ? `${T.correlation}: ${T.noResult}`
      : `r ${formatSigned(correlation)}`;
  return `${placeName}: ${modelName} ${formatSigned(modelSlope)}${unitText} ${T.perDecade}; ${observationName} ${formatSigned(observationSlope)}${unitText} ${T.perDecade}; ${correlationText}.`;
}

function isStationPair(pair: Pair): boolean {
  return Number.isFinite(stationPriority(pair.obs.variable_id));
}

export function buildGapGlyphs(
  file: ModelVsObsFile,
  modelVariableId: string,
): GapGlyph[] {
  const candidates = file.pairs
    .filter(
      (pair) =>
        pair.status === "analyzed" &&
        pair.model.variable_id === modelVariableId &&
        isStationPair(pair) &&
        pair.model_trend !== undefined &&
        pair.obs_trend !== undefined,
    )
    .sort((first, second) => {
      const priority =
        stationPriority(first.obs.variable_id) -
        stationPriority(second.obs.variable_id);
      return priority || first.pair_id.localeCompare(second.pair_id);
    });
  const selected = new Map<string, Pair>();
  for (const pair of candidates) {
    if (!selected.has(pair.location_id)) selected.set(pair.location_id, pair);
  }

  return [...selected.values()].map((pair) => {
    const location = file.locations[pair.location_id];
    const modelSlope = pair.model_trend?.slope_per_decade ?? 0;
    const observationSlope = pair.obs_trend?.slope_per_decade ?? 0;
    const correlation = pair.correlation ?? null;
    const model = file.variables[pair.model.variable_id];
    const observation = file.variables[pair.obs.variable_id];
    const modelName = variableName(
      pair.model.variable_id,
      model?.name_en ?? undefined,
    );
    const observationName = variableName(
      pair.obs.variable_id,
      observation?.name_en ?? undefined,
    );
    const unit =
      model?.unit === "K" || model?.unit === "C" || model?.unit === "degC"
        ? "°C"
        : (model?.unit ?? "");
    const modelUnreliable = hasTrendAffectingIssue(
      pair.model.known_issues,
      file.known_issues,
    );
    const observationUnreliable = hasTrendAffectingIssue(
      pair.obs.known_issues,
      file.known_issues,
    );
    return {
      pairId: pair.pair_id,
      placeId: pair.location_id,
      placeName: placeName(pair.location_id, location?.name_en ?? undefined),
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      modelVariableId: pair.model.variable_id,
      modelName,
      unit,
      observationVariableId: pair.obs.variable_id,
      observationName,
      modelSlope,
      observationSlope,
      correlation,
      commonMonths: pair.n_common_months,
      disagreement: correlation === null ? null : 1 - correlation,
      ringWidthPx: ringWidth(correlation),
      modelUnreliable,
      observationUnreliable,
      summary: gapSummary(
        placeName(pair.location_id, location?.name_en ?? undefined),
        modelName,
        observationName,
        modelSlope,
        observationSlope,
        correlation,
        unit,
      ),
    };
  });
}
