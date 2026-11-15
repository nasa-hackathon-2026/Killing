import { useCallback, useEffect, useState } from "react";
import {
  loadSimilarSeries,
  type SimilarSeriesFile,
} from "../analysis/miningPlus";
import type { AnalysisState } from "../analysis/useAnalysisFile";
import type { ModelVsObsFile } from "../analysis/modelVsObs";
import type { TrendsFile } from "../analysis/trends";
import type { PointPlace } from "../snapshot/places";
import { useI18n } from "../i18n";
import { placeName, variableName } from "../i18n/names";
import { layerRegistry } from "../layers/registry";
import { requestedGlobe } from "../urlParams";
import { buildAlikeArcs, type AlikeArc } from "./alikeArcs";
import { buildGapGlyphs, type GapGlyph } from "./gapGlyphs";
import { parseGlobeParam, type GlobeMode } from "./globeStatsMode";
import { buildTrendGlyphs, type TrendGlyph } from "./trendGlyphs";

const MODEL_TEMPERATURES = ["gldas_tair", "merra2_t2m", "power_t2m"];

export type GlobeStatsState = {
  hidden: boolean;
  mode: GlobeMode;
  setMode: (mode: GlobeMode) => void;
  selectedVariableId: string | null;
  selectedVariableName: string;
  selectedLocationId: string;
  selectedLocationName: string;
  modelVariableId: string;
  setModelVariableId: (id: string) => void;
  modelVariables: { id: string; name: string }[];
  trends: AnalysisState<TrendsFile>;
  modelVsObs: AnalysisState<ModelVsObsFile>;
  similarSeries: AnalysisState<SimilarSeriesFile>;
  trendGlyphs: TrendGlyph[];
  gapGlyphs: GapGlyph[];
  alikeArcs: AlikeArc[];
  places: PointPlace[];
  onSelectLocation: (id: string) => void;
};

type UseGlobeStatsArgs = {
  hidden: boolean;
  places: PointPlace[];
  selectedLocationId: string;
  selectedVariableId: string | null;
  trends: AnalysisState<TrendsFile>;
  modelVsObs: AnalysisState<ModelVsObsFile>;
  onSelectLocation: (id: string) => void;
};

export function useGlobeStats({
  hidden,
  places,
  selectedLocationId,
  selectedVariableId,
  trends,
  modelVsObs,
  onSelectLocation,
}: UseGlobeStatsArgs): GlobeStatsState {
  useI18n();
  const [mode, setModeState] = useState<GlobeMode>(() =>
    parseGlobeParam(requestedGlobe()),
  );
  const [modelVariableId, setModelVariableId] = useState("gldas_tair");
  const [similarSeries, setSimilarSeries] = useState<
    AnalysisState<SimilarSeriesFile>
  >({ status: "loading" });

  const setMode = useCallback((next: GlobeMode) => {
    setModeState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("globe", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    const readLocation = () => setModeState(parseGlobeParam(requestedGlobe()));
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);

  useEffect(() => {
    if (mode !== "alike" || similarSeries.status !== "loading") return;
    let active = true;
    loadSimilarSeries()
      .then((data) => {
        if (active) setSimilarSeries({ status: "ready", data });
      })
      .catch(() => {
        if (active) setSimilarSeries({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [mode, similarSeries.status]);

  const selectedVariableName = selectedVariableId
    ? variableName(
        selectedVariableId,
        layerRegistry.find((layer) => layer.id === selectedVariableId)?.nameEn,
      )
    : "";
  const selectedLocationName = placeName(
    selectedLocationId,
    places.find((place) => place.id === selectedLocationId)?.nameEn,
  );
  const modelVariables = MODEL_TEMPERATURES.filter(
    (id) =>
      modelVsObs.status !== "ready" ||
      modelVsObs.data.variables[id] !== undefined,
  ).map((id) => ({
    id,
    name: variableName(
      id,
      modelVsObs.status === "ready"
        ? (modelVsObs.data.variables[id]?.name_en ?? id)
        : id,
    ),
  }));
  const trendGlyphs =
    mode === "trend" && selectedVariableId && trends.status === "ready"
      ? buildTrendGlyphs(
          places.map((place) => ({
            ...place,
            nameEn: placeName(place.id, place.nameEn),
          })),
          selectedVariableId,
          trends.data,
          selectedVariableName,
        )
      : [];
  const gapGlyphs =
    mode === "gap" && modelVsObs.status === "ready"
      ? buildGapGlyphs(modelVsObs.data, modelVariableId)
      : [];
  const alikeArcs =
    mode === "alike" && selectedVariableId && similarSeries.status === "ready"
      ? buildAlikeArcs(
          similarSeries.data,
          places,
          selectedLocationId,
          selectedVariableId,
        )
      : [];

  return {
    hidden,
    mode,
    setMode,
    selectedVariableId,
    selectedVariableName,
    selectedLocationId,
    selectedLocationName,
    modelVariableId,
    setModelVariableId,
    modelVariables,
    trends,
    modelVsObs,
    similarSeries,
    trendGlyphs,
    gapGlyphs,
    alikeArcs,
    places,
    onSelectLocation,
  };
}
