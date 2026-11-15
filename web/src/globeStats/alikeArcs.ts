import {
  similarKey,
  type SimilarEntry,
  type SimilarSeriesFile,
} from "../analysis/miningPlus";
import { hasCoordinates, type Place } from "../snapshot/places";
import { formatSigned } from "../analysis/modelVsObs";
import { placeName, variableName } from "../i18n/names";
import { GLOBE_STATS_TEXT as T } from "./globeStatsText";

export type AlikeArc = {
  seriesKey: string;
  sourceLocationId: string;
  sourceName: string;
  sourceVariableId: string;
  sourceVariableName: string;
  sourceLat: number | null;
  sourceLon: number | null;
  targetLocationId: string;
  targetName: string;
  targetVariableId: string;
  targetVariableName: string;
  targetLat: number | null;
  targetLon: number | null;
  samePlace: boolean;
  draw: boolean;
  cosine: number;
  detrendedCosine: number;
  significant: boolean;
  significantDetrended: boolean;
  trendSensitive: boolean;
  positive: boolean;
  dashed: boolean;
  widthPx: number;
  summary: string;
};

function namedLocation(
  places: Place[],
  locationId: string,
  fallback: string,
): { name: string; lat: number | null; lon: number | null } {
  const place = places.find((item) => item.id === locationId);
  return place && hasCoordinates(place)
    ? {
        name: placeName(locationId, place.nameEn),
        lat: place.lat,
        lon: place.lon,
      }
    : {
        name: placeName(locationId, place?.nameEn ?? fallback),
        lat: null,
        lon: null,
      };
}

function arcSummary(
  sourceName: string,
  sourceVariableName: string,
  targetName: string,
  targetVariableName: string,
  entry: SimilarEntry,
): string {
  return `${sourceName}, ${sourceVariableName} → ${targetName}, ${targetVariableName}: ${T.similarity} ${formatSigned(entry.cosine)}; ${T.similarityDetrended} ${formatSigned(entry.cosine_detrended)}.`;
}

export function buildAlikeArcs(
  file: SimilarSeriesFile,
  places: Place[],
  sourceLocationId: string,
  sourceVariableId: string,
): AlikeArc[] {
  const sourceKey = similarKey(file, sourceLocationId, sourceVariableId);
  const sourceSeries = sourceKey ? file.series[sourceKey] : undefined;
  const sourceLocation = file.locations[sourceLocationId];
  const sourcePlace = namedLocation(
    places,
    sourceLocationId,
    sourceLocation?.name_en ?? sourceLocationId,
  );
  if (
    !sourceKey ||
    !sourceSeries ||
    !sourceLocation ||
    !file.results[sourceKey]
  ) {
    return [];
  }
  const sourceVariableName = variableName(
    sourceVariableId,
    file.variable_names[sourceVariableId],
  );
  const seenLocations = new Set<string>();
  const entries = file.results[sourceKey]?.most_similar ?? [];
  const arcs: AlikeArc[] = [];
  for (const entry of entries) {
    const targetSeries = file.series[entry.series];
    if (!targetSeries || seenLocations.has(targetSeries.location_id)) continue;
    seenLocations.add(targetSeries.location_id);
    const targetLocation = file.locations[targetSeries.location_id];
    if (!targetLocation) continue;
    const targetPlace = namedLocation(
      places,
      targetSeries.location_id,
      targetLocation.name_en,
    );
    const samePlace = targetSeries.location_id === sourceLocationId;
    const draw =
      !samePlace &&
      sourcePlace.lat !== null &&
      sourcePlace.lon !== null &&
      targetPlace.lat !== null &&
      targetPlace.lon !== null;
    const targetVariableName = variableName(
      targetSeries.variable_id,
      file.variable_names[targetSeries.variable_id],
    );
    const positive = entry.cosine >= 0;
    arcs.push({
      seriesKey: entry.series,
      sourceLocationId,
      sourceName: sourcePlace.name,
      sourceVariableId,
      sourceVariableName,
      sourceLat: sourcePlace.lat,
      sourceLon: sourcePlace.lon,
      targetLocationId: targetSeries.location_id,
      targetName: targetPlace.name,
      targetVariableId: targetSeries.variable_id,
      targetVariableName,
      targetLat: targetPlace.lat,
      targetLon: targetPlace.lon,
      samePlace,
      draw,
      cosine: entry.cosine,
      detrendedCosine: entry.cosine_detrended,
      significant: entry.significant,
      significantDetrended: entry.significant_detrended,
      trendSensitive: entry.trend_sensitive,
      positive,
      dashed: !entry.significant_detrended || entry.trend_sensitive,
      widthPx: 1 + Math.min(1, Math.abs(entry.cosine)) * 5,
      summary: arcSummary(
        sourcePlace.name,
        sourceVariableName,
        targetPlace.name,
        targetVariableName,
        entry,
      ),
    });
  }
  return arcs;
}
