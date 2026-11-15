// ② Where is it changing? One small chart per place (Taiwan, world cities,
// global mean): monthly anomalies, the trend line, the change per decade
// and the same mark as the Layers panel. Clicking a cell switches place.
import { useMemo, useState } from "react";
import { trendLabel, trendSignal } from "../forms/encoding";
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import { formatSlope, trendKey, type TrendsFile } from "../analysis/trends";
import { t, tm, useI18n } from "../i18n";
import { UnitText } from "../snapshot/UnitText";
import {
  displayPlaceName,
  groupedPlaces,
  placeGroupLabel,
  type Place,
} from "../snapshot/places";
import { paddedExtent } from "../timeline/chartGeometry";
import { trendLine, type AnomalySeries } from "../timeline/seriesMath";
import { monthNumber } from "../timeline/timelineMath";
import { TREND_MAP_VARIABLES } from "../trendmap/trendMapConfig";
import { Sparkline } from "./charts";

function monthsOf(series: AnomalySeries): string[] {
  const first = monthNumber(series.first_month);
  return series.values.map((_, at) => {
    const number = first + at;
    const year = Math.floor(number / 12);
    const month = (number % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}-01`;
  });
}

export function WhereTab({
  variableId,
  locationId,
  places,
  anomalies,
  trends,
  onSelectLocation,
}: {
  variableId: string;
  locationId: string;
  places: Place[];
  anomalies: Record<string, AnomalySeries> | null;
  trends: TrendsFile | null;
  onSelectLocation?: (id: string) => void;
}) {
  const { voice } = useI18n();
  const [own, setOwn] = useState(false);
  const cells = useMemo(
    () =>
      places.map((place) => {
        const key = trendKey(variableId, place.id, place.aggregation);
        const series = anomalies?.[key];
        const entry = trends?.series[key];
        const months = series ? monthsOf(series) : [];
        const values = series?.values ?? [];
        const line =
          entry?.status === "analyzed" && series
            ? trendLine(
                entry.ols.slope_per_decade,
                entry.ols.ci_per_decade,
                months,
                values,
                values,
              )
            : null;
        return { place, entry, months, values, line };
      }),
    [places, variableId, anomalies, trends],
  );
  const withData = cells.filter((cell) => cell.values.length > 0);
  const span: [number, number] = [
    Math.min(...withData.map((cell) => monthNumber(cell.months[0] ?? ""))),
    Math.max(...withData.map((cell) => monthNumber(cell.months.at(-1) ?? ""))),
  ];
  const shared = paddedExtent(withData.map((cell) => cell.values));
  const hasMap = TREND_MAP_VARIABLES.some((item) => item.id === variableId);

  return (
    <>
      <div className="investigation-where-head">
        <h4 className="investigation-subtitle">
          {t("investigation.where.title")}
        </h4>
        <div
          className="timeline-modes"
          role="group"
          aria-label={t("investigation.where.scaleAria")}
        >
          <button
            type="button"
            aria-pressed={!own}
            onClick={() => setOwn(false)}
          >
            {t("investigation.where.sameScale")}
          </button>
          <button type="button" aria-pressed={own} onClick={() => setOwn(true)}>
            {t("investigation.where.ownScale")}
          </button>
        </div>
      </div>
      {groupedPlaces(places).map((group) => (
        <div key={group.id}>
          <h5 className="investigation-place-group">
            {placeGroupLabel(group.id)}
          </h5>
          <ul className="investigation-cells">
            {group.places.map((place) => {
              const cell = cells.find((item) => item.place.id === place.id);
              if (!cell) return null;
              const name = displayPlaceName(place);
              const signal = trendSignal(cell.entry, trends?.known_issues);
              const label = trendLabel(signal, voice);
              const change =
                cell.entry?.status === "analyzed"
                  ? formatSlope(
                      cell.entry.ols.slope_per_decade,
                      cell.entry.ols.ci_per_decade,
                      cell.entry.unit,
                    )
                  : null;
              const here = place.id === locationId;
              return (
                <li key={place.id}>
                  <button
                    type="button"
                    className={`investigation-cell${here ? " investigation-cell-here" : ""}`}
                    aria-current={here ? "true" : undefined}
                    disabled={!onSelectLocation}
                    aria-label={
                      change
                        ? t("investigation.where.cellAria", {
                            place: name,
                            label,
                            change,
                          })
                        : t("investigation.where.cellAriaNone", {
                            place: name,
                            label: cell.values.length
                              ? label
                              : t("investigation.where.noData"),
                          })
                    }
                    onClick={() => onSelectLocation?.(place.id)}
                  >
                    <span className="investigation-cell-name">
                      {name}
                      {here ? ` · ${t("investigation.where.here")}` : ""}
                    </span>
                    {cell.values.length ? (
                      <Sparkline
                        values={cell.values}
                        months={cell.months}
                        line={cell.line}
                        span={span}
                        extent={own ? null : shared}
                      />
                    ) : (
                      <span className="investigation-cell-empty">
                        {t("investigation.where.noData")}
                      </span>
                    )}
                    <span className="investigation-cell-foot">
                      <TrendMarkIcon signal={signal} />
                      {change ? <UnitText text={change} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="timeline-chart-note">{tm("investigation.where.note")}</p>
      {hasMap ? (
        <p className="timeline-chart-note">
          {t("investigation.where.mapHint")}
        </p>
      ) : null}
    </>
  );
}
