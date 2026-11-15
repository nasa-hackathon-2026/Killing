import { useMemo, useState } from "react";
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
import { carryChoices, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { similarLink } from "../analysis/miningPlus";
import { TimelineBar } from "./TimelineBar";
import { useTimeline } from "./TimelineContext";
import { InvestigationPanel } from "../investigation/InvestigationPanel";
import { parseTab, type TabId } from "../investigation/logic";
import type { Place } from "../snapshot/places";
import { requestedTab } from "../urlParams";

type TimelineDockProps = {
  // Point series of the current place.
  series: LoadedSeries[];
  // Variables in panel order, with their display names.
  variables: { id: string; nameEn: string }[];
  // Ids of the layers that are switched on.
  visibleIds: string[];
  locationName: string;
  // Aggregation of the place's series in the trend keys ("point" except
  // for the global mean).
  aggregation?: string;
  trends: AnalysisState<TrendsFile>;
  // Every place of the menu, for the "Where" tab's small charts, and the
  // place menu's own action (the camera flies there).
  places?: Place[];
  onSelectLocation?: (id: string) => void;
  // The guided tour's tab: set again whenever `key` changes (each step).
  tourTab?: { tab: TabId; key: number } | null;
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
  aggregation = "point",
  trends,
  places = [],
  onSelectLocation,
  tourTab = null,
}: TimelineDockProps) {
  const { months, locationId, selectedVariableId, setSelectedVariableId } =
    useTimeline();
  useI18n();
  // The investigation panel's tab, width and folding outlive a change of
  // variable or place.
  const [tab, setTab] = useState<TabId>(() => parseTab(requestedTab()));
  const [wide, setWide] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tourTabSeen, setTourTabSeen] = useState<number | null>(null);
  if (tourTab && tourTab.key !== tourTabSeen) {
    setTourTabSeen(tourTab.key);
    setTab(tourTab.tab);
    setCollapsed(false);
  }
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

  const stripKey = stripId ? trendKey(stripId, locationId, aggregation) : "";
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

  const key = selected ? trendKey(selected.id, locationId, aggregation) : "";

  return (
    <>
      {selected ? (
        <InvestigationPanel
          variableId={selected.id}
          variableName={variableName(selected.id, selected.nameEn)}
          locationId={locationId}
          locationName={locationName}
          aggregation={aggregation}
          series={
            series.find((item) => item.variableId === selected.id) ?? null
          }
          anomalies={anomalies}
          trends={trendsData}
          breaks={stepsOf(key)}
          similarHref={carryChoices(
            similarLink(import.meta.env.BASE_URL, locationId, selected.id),
          )}
          places={places}
          variables={variables}
          tab={tab}
          onTab={setTab}
          wide={wide}
          onWide={setWide}
          collapsed={collapsed}
          onCollapsed={setCollapsed}
          onSelectVariable={setSelectedVariableId}
          onSelectLocation={onSelectLocation}
          onClose={() => setSelectedVariableId(null)}
        />
      ) : null}
      <TimelineBar
        strip={bars}
        stripName={
          stripVariable
            ? variableName(stripVariable.id, stripVariable.nameEn)
            : null
        }
        breaks={stepsOf(stripKey)
          .map((month) => months.indexOf(month))
          .filter((index) => index >= 0)}
      />
    </>
  );
}
