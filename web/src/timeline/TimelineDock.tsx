import { useMemo } from "react";
import { trendKey, type TrendsFile } from "../analysis/trends";
import {
  useAnalysisFile,
  type AnalysisState,
} from "../analysis/useAnalysisFile";
import type { LoadedSeries } from "../snapshot/loadSnapshot";
import { loadAnomalies } from "./loadAnomalies";
import {
  alignAnomalies,
  alignValues,
  breakMonths,
  calendarAnomalies,
  stripBars,
} from "./seriesMath";
import { TimelineBar } from "./TimelineBar";
import { useTimeline } from "./TimelineContext";
import { TimeSeriesPanel } from "./TimeSeriesPanel";

type TimelineDockProps = {
  // Point series of the current place.
  series: LoadedSeries[];
  // Variables in panel order, with their display names.
  variables: { id: string; nameEn: string }[];
  // Ids of the layers that are switched on.
  visibleIds: string[];
  locationName: string;
  trends: AnalysisState<TrendsFile>;
};

// Everything the timeline adds to the main view: the bar at the bottom and,
// once a variable is picked (the Chart button of a layer, or ?chart=), the
// time series panel. The anomaly strip follows the charted variable, or the
// first layer that is switched on.
export function TimelineDock({
  series,
  variables,
  visibleIds,
  locationName,
  trends,
}: TimelineDockProps) {
  const { months, locationId, selectedVariableId, setSelectedVariableId } =
    useTimeline();
  const anomaliesFile = useAnalysisFile(loadAnomalies);
  const anomalies =
    anomaliesFile.status === "ready" ? anomaliesFile.data.series : null;
  const trendsData = trends.status === "ready" ? trends.data : null;
  const selected =
    variables.find((item) => item.id === selectedVariableId) ?? null;
  const stripVariable =
    selected ??
    variables.find(
      (item) =>
        visibleIds.includes(item.id) &&
        series.some((entry) => entry.variableId === item.id),
    ) ??
    null;
  const stripId = stripVariable?.id ?? null;

  const stripKey = stripId ? trendKey(stripId, locationId, "point") : "";
  const stripPoints = series.find(
    (item) => item.variableId === stripId,
  )?.points;
  const stripKnown = anomalies?.[stripKey];
  const bars = useMemo(() => {
    if (!stripPoints) return [];
    return stripBars(
      stripKnown
        ? alignAnomalies(stripKnown, months)
        : calendarAnomalies(alignValues(stripPoints, months), months),
    );
  }, [stripPoints, stripKnown, months]);
  const stepsOf = (key: string): string[] => {
    const entry = trendsData?.series[key];
    return breakMonths(
      entry?.status === "analyzed" ? entry.known_issues : undefined,
      trendsData?.known_issues,
    );
  };

  const key = selected ? trendKey(selected.id, locationId, "point") : "";
  const trend = selected ? trendsData?.series[key] : undefined;

  return (
    <>
      {selected ? (
        <TimeSeriesPanel
          key={selected.id}
          variableId={selected.id}
          variableName={selected.nameEn}
          locationName={locationName}
          series={
            series.find((item) => item.variableId === selected.id) ?? null
          }
          anomalies={anomalies?.[key] ?? null}
          trend={trend}
          alpha={trendsData?.parameters.alpha ?? 0.05}
          breaks={stepsOf(key)}
          onClose={() => setSelectedVariableId(null)}
        />
      ) : null}
      <TimelineBar
        strip={bars}
        stripName={stripVariable?.nameEn ?? null}
        breaks={stepsOf(stripKey)
          .map((month) => months.indexOf(month))
          .filter((index) => index >= 0)}
      />
    </>
  );
}
