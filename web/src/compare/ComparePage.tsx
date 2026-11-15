import { useEffect, useState } from "react";
import {
  breakMonths,
  chartSeries,
  formatMonth,
  formatSigned,
  groupsOf,
  linePath,
  loadModelVsObs,
  monthToYear,
  pairCaveat,
  valueRange,
  type ModelVsObsFile,
  type Pair,
} from "../analysis/modelVsObs";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { useAnalysisFile } from "../analysis/useAnalysisFile";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { carryChoices, localNumber, t, tOptional, useI18n } from "../i18n";
import { LanguageMenu, ModeSwitch } from "../i18n/ChoiceControls";
import {
  placeName as localPlace,
  variableName as localVariable,
} from "../i18n/names";

// Numbers of this page in the active language's decimal convention.
function signed(value: number | null | undefined, digits = 2): string {
  return localNumber(formatSigned(value, digits));
}

const WIDTH = 960;
const HEIGHT = 320;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 44 };

function KindTag({
  file,
  variable,
}: {
  file: ModelVsObsFile;
  variable: string;
}) {
  const kind = file.variables[variable]?.data_kind ?? "unknown";
  return (
    <span className={`tag kind-${kind}`}>
      {t(`common.dataKind.${kind}.label`)}
    </span>
  );
}

function variableName(file: ModelVsObsFile, variable: string): string {
  return localVariable(variable, file.variables[variable]?.name_en ?? variable);
}

function locationName(file: ModelVsObsFile, location: string): string {
  return localPlace(location, file.locations[location]?.name_en ?? location);
}

function modelPlace(file: ModelVsObsFile, pair: Pair): string {
  const { detail } = pair.model;
  if (pair.model.source === "grid_cube_cell") {
    const where = detail.containing_cell
      ? t("compare.modelPlace.containingCell")
      : t("compare.modelPlace.nearestCell");
    return detail.distance_km === undefined
      ? where
      : t("compare.modelPlace.cellDistance", {
          where,
          km: detail.distance_km.toFixed(0),
        });
  }
  if (pair.model.location_id !== pair.location_id) {
    const place = locationName(file, pair.model.location_id);
    return detail.distance_km === undefined
      ? t("compare.modelPlace.pointSeries", { place })
      : t("compare.modelPlace.pointSeriesDistance", {
          place,
          km: detail.distance_km.toFixed(0),
        });
  }
  return t("compare.modelPlace.sameLocation");
}

function PairChart({ file, pair }: { file: ModelVsObsFile; pair: Pair }) {
  const { t, tm } = useI18n();
  const series = chartSeries(pair);
  if (!series || !series.time.length) {
    return <p className="note">{t("compare.chart.empty")}</p>;
  }
  const first = Math.floor(series.time[0] ?? 0);
  const last = Math.ceil(series.time.at(-1) ?? first + 1);
  const [low, high] = valueRange(series);
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (time: number) =>
    MARGIN.left + ((time - first) / (last - first)) * innerWidth;
  const y = (value: number) =>
    MARGIN.top + ((high - value) / (high - low)) * innerHeight;
  const years: number[] = [];
  for (let year = first; year <= last; year += 1) {
    if (year % 5 === 0) years.push(year);
  }
  const ticks = [low, low / 2, 0, high / 2, high];
  const breaks = breakMonths(pair, file.known_issues);
  const step = pair.difference?.largest_step_month ?? null;
  return (
    <figure className="compare-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t("compare.chart.aria", {
          model: variableName(file, pair.model.variable_id),
          obs: variableName(file, pair.obs.variable_id),
          place: locationName(file, pair.location_id),
        })}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 0 ? "axis-zero" : "axis-grid"}
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className="axis-label"
              x={MARGIN.left - 6}
              y={y(tick) + 4}
              textAnchor="end"
            >
              {signed(tick, Number.isInteger(tick * 10) ? 1 : 2)}
            </text>
          </g>
        ))}
        {years.map((year) => (
          <text
            key={year}
            className="axis-label"
            x={x(year)}
            y={HEIGHT - 8}
            textAnchor="middle"
          >
            {year}
          </text>
        ))}
        {breaks.map((month) => (
          <line
            key={month}
            className="mark-break"
            x1={x(monthToYear(month))}
            x2={x(monthToYear(month))}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
          />
        ))}
        {step ? (
          <line
            className="mark-step"
            x1={x(monthToYear(step))}
            x2={x(monthToYear(step))}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
          />
        ) : null}
        <path
          className="line-difference"
          d={linePath(series.time, series.difference, x, y)}
        />
        <path
          className="line-obs"
          d={linePath(series.time, series.obs, x, y)}
        />
        <path
          className="line-model"
          d={linePath(series.time, series.model, x, y)}
        />
      </svg>
      <figcaption>
        <span className="key key-model" /> {t("compare.chart.keyModel")}{" "}
        <span className="key key-obs" /> {t("compare.chart.keyObs")}{" "}
        <span className="key key-difference" />{" "}
        {t("compare.chart.keyDifference")}{" "}
        {breaks.length ? (
          <>
            <span className="key key-break" />{" "}
            {t("compare.chart.keyBreak", {
              months: breaks.map(formatMonth).join(", "),
            })}{" "}
          </>
        ) : null}
        {step ? (
          <>
            <span className="key key-step" />{" "}
            {t("compare.chart.keyStep", { month: formatMonth(step) })}
          </>
        ) : null}
        <br />
        {series.resolution === "month"
          ? t("compare.chart.monthly")
          : t("compare.chart.annual")}{" "}
        {tm("compare.chart.baseline")}
      </figcaption>
    </figure>
  );
}

// The section of the selected pair; a link with ?pair= scrolls to it.
const PAIR_SECTION_ID = "pair";

function PairDetail({ file, pair }: { file: ModelVsObsFile; pair: Pair }) {
  const { t, mode } = useI18n();
  const caveat = pairCaveat(pair, file.known_issues);
  const difference = pair.difference;
  const trendValue = (trend: {
    slope_per_decade: number;
    ci_per_decade: [number, number];
  }) =>
    t("compare.stats.trendValue", {
      slope: signed(trend.slope_per_decade),
      low: signed(trend.ci_per_decade[0]),
      high: signed(trend.ci_per_decade[1]),
    });
  const full =
    difference && pair.model_trend && pair.obs_trend ? (
      <dl>
        <dt>{t("compare.stats.commonMonths")}</dt>
        <dd>
          {t("compare.stats.commonMonthsValue", {
            count: pair.n_common_months,
            first: formatMonth(pair.first_common_month),
            last: formatMonth(pair.last_common_month),
          })}
        </dd>
        <dt>{t("compare.stats.modelTrend")}</dt>
        <dd>{trendValue(pair.model_trend)}</dd>
        <dt>{t("compare.stats.obsTrend")}</dt>
        <dd>{trendValue(pair.obs_trend)}</dd>
        <dt>{t("compare.stats.differenceTrend")}</dt>
        <dd>
          {t("compare.stats.differenceTrendValue", {
            slope: signed(difference.trend.slope_per_decade),
            low: signed(difference.trend.ci_per_decade[0]),
            high: signed(difference.trend.ci_per_decade[1]),
            p: t(
              difference.trend.significant
                ? "compare.stats.pBelow"
                : "compare.stats.pAtLeast",
              { alpha: localNumber(String(file.parameters.alpha)) },
            ),
          })}
        </dd>
        <dt>{t("compare.stats.difference")}</dt>
        <dd>
          {t("compare.stats.differenceValue", {
            sd: localNumber(difference.sd.toFixed(2)),
            rmse: localNumber(difference.rmse.toFixed(2)),
          })}
        </dd>
        <dt>{t("compare.stats.largestStep")}</dt>
        <dd>
          {t("compare.stats.largestStepValue", {
            step: signed(difference.largest_step),
            month: formatMonth(difference.largest_step_month),
          })}
        </dd>
      </dl>
    ) : null;
  return (
    <section id={PAIR_SECTION_ID}>
      <h2>{locationName(file, pair.location_id)}</h2>
      <p>
        {variableName(file, pair.model.variable_id)}
        <KindTag file={file} variable={pair.model.variable_id} /> (
        {modelPlace(file, pair)})
        <br />
        {variableName(file, pair.obs.variable_id)}
        <KindTag file={file} variable={pair.obs.variable_id} />
      </p>
      {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
      <PairChart file={file} pair={pair} />
      {!full || !difference || !pair.model_trend || !pair.obs_trend ? (
        <p className="note">
          {t("compare.stats.tooFew", { count: pair.n_common_months })}
        </p>
      ) : mode === "research" ? (
        full
      ) : (
        <>
          <dl>
            <dt>{t("compare.stats.modelTrend")}</dt>
            <dd>
              {t("compare.stats.trendValuePlain", {
                slope: signed(pair.model_trend.slope_per_decade),
              })}
            </dd>
            <dt>{t("compare.stats.obsTrend")}</dt>
            <dd>
              {t("compare.stats.trendValuePlain", {
                slope: signed(pair.obs_trend.slope_per_decade),
              })}
            </dd>
          </dl>
          <p>
            {difference.trend.significant
              ? t("compare.stats.gapChanging", {
                  slope: signed(difference.trend.slope_per_decade),
                })
              : t("compare.stats.gapUnclear")}
          </p>
          <details className="method">
            <summary>{t("common.action.details")}</summary>
            {full}
          </details>
        </>
      )}
    </section>
  );
}

function PairTable({
  file,
  pairs,
  selected,
  onSelect,
}: {
  file: ModelVsObsFile;
  pairs: Pair[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, mode } = useI18n();
  const research = mode === "research";
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>{t("compare.table.location")}</th>
            <th>{t("compare.table.model")}</th>
            <th>{t("compare.table.obs")}</th>
            {research ? (
              <>
                <th className="number">{t("compare.table.months")}</th>
                <th className="number">{t("compare.table.r")}</th>
              </>
            ) : null}
            <th className="number">{t("compare.table.modelTrend")}</th>
            <th className="number">{t("compare.table.obsTrend")}</th>
            {research ? (
              <>
                <th className="number">{t("compare.table.difference")}</th>
                <th>{t("compare.table.largestStep")}</th>
              </>
            ) : null}
            <th>{t("compare.table.knownIssues")}</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair) => {
            const caveat = pairCaveat(pair, file.known_issues);
            return (
              <tr
                key={pair.pair_id}
                className={pair.pair_id === selected ? "selected" : undefined}
              >
                <td>
                  <button
                    type="button"
                    className="pair-button"
                    aria-pressed={pair.pair_id === selected}
                    onClick={() => onSelect(pair.pair_id)}
                  >
                    {locationName(file, pair.location_id)}
                  </button>
                </td>
                <td title={pair.model.variable_id}>
                  {variableName(file, pair.model.variable_id)}
                  <KindTag file={file} variable={pair.model.variable_id} />
                </td>
                <td title={pair.obs.variable_id}>
                  {variableName(file, pair.obs.variable_id)}
                  <KindTag file={file} variable={pair.obs.variable_id} />
                </td>
                {research ? (
                  <>
                    <td className="number">{pair.n_common_months}</td>
                    <td className="number">
                      {pair.correlation === null ||
                      pair.correlation === undefined
                        ? "—"
                        : localNumber(pair.correlation.toFixed(2))}
                    </td>
                  </>
                ) : null}
                <td className="number">
                  {signed(pair.model_trend?.slope_per_decade)}
                </td>
                <td className="number">
                  {signed(pair.obs_trend?.slope_per_decade)}
                </td>
                {research ? (
                  <>
                    <td className="number">{signed(pair.slope_difference)}</td>
                    <td>
                      {formatMonth(pair.difference?.largest_step_month)} (
                      {signed(pair.difference?.largest_step)})
                    </td>
                  </>
                ) : null}
                <td>{caveat ? <TrendCaveatNote caveat={caveat} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// `?group=world_city&pair=<pair_id>` opens the page on that group and pair.
function initialSelection(file: ModelVsObsFile): {
  group: string;
  pair: string | null;
} {
  const groups = groupsOf(file);
  const params = new URLSearchParams(window.location.search);
  const pair = file.pairs.find((item) => item.pair_id === params.get("pair"));
  const group = pair?.group ?? params.get("group") ?? "";
  return {
    group: groups.includes(group) ? group : (groups[0] ?? ""),
    pair: pair?.pair_id ?? null,
  };
}

function Comparison({ file }: { file: ModelVsObsFile }) {
  const { t, tm } = useI18n();
  const groups = groupsOf(file);
  const [initial] = useState(() => initialSelection(file));
  const [group, setGroup] = useState(initial.group);
  const [selected, setSelected] = useState<string | null>(initial.pair);
  const pairs = file.pairs.filter((pair) => pair.group === group);
  const pair = pairs.find((item) => item.pair_id === selected) ?? pairs[0];
  // A link that names a pair (the start card's example, the Layers panel)
  // opens on that pair's chart, which sits below the table.
  useEffect(() => {
    if (!initial.pair) return;
    document.getElementById(PAIR_SECTION_ID)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [initial.pair]);
  return (
    <>
      <div className="controls">
        <label>
          {t("compare.group.label")}{" "}
          <select
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setSelected(null);
            }}
          >
            {groups.map((id) => (
              <option key={id} value={id}>
                {t("compare.group.option", {
                  name: tOptional(`compare.group.${id}`) ?? id,
                  count: file.summary.n_pairs_by_group[id] ?? 0,
                })}
              </option>
            ))}
          </select>
        </label>
        <span className="note">{tm("compare.tableNote")}</span>
      </div>
      <PairTable
        file={file}
        pairs={pairs}
        selected={pair?.pair_id ?? null}
        onSelect={setSelected}
      />
      {pair ? <PairDetail file={file} pair={pair} /> : null}
      {file.skipped.length ? (
        <p className="note">
          {t("compare.notPaired", {
            list: file.skipped
              .map((item) => `${item.pair_id} (${item.reason})`)
              .join("; "),
          })}
        </p>
      ) : null}
    </>
  );
}

export function ComparePage() {
  const { t, tm } = useI18n();
  const state = useAnalysisFile(loadModelVsObs);
  const window =
    state.status === "ready"
      ? {
          start: formatMonth(state.data.parameters.window_start),
          end: formatMonth(state.data.parameters.window_end),
        }
      : { start: "2001-01", end: "2025-12" };

  return (
    <main className="mining compare">
      <p className="page-bar">
        <a href={carryChoices(import.meta.env.BASE_URL)}>{t("compare.back")}</a>
        <LanguageMenu />
        <ModeSwitch />
      </p>
      <h1>{t("compare.title")}</h1>
      <p>{tm("compare.intro", window)}</p>
      <p className="verdict">{tm("compare.verdict")}</p>
      {state.status === "loading" ? <p>{t("common.status.loading")}</p> : null}
      {state.status === "error" ? <p>{t("compare.error")}</p> : null}
      {state.status === "ready" ? <Comparison file={state.data} /> : null}
    </main>
  );
}
