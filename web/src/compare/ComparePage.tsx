import { useEffect, useState } from "react";
import {
  DATA_KIND_LABELS,
  GROUP_LABELS,
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
  return <span className={`tag kind-${kind}`}>{DATA_KIND_LABELS[kind]}</span>;
}

function variableName(file: ModelVsObsFile, variable: string): string {
  return file.variables[variable]?.name_en ?? variable;
}

function locationName(file: ModelVsObsFile, location: string): string {
  return file.locations[location]?.name_en ?? location;
}

function modelPlace(pair: Pair): string {
  const { detail } = pair.model;
  if (pair.model.source === "grid_cube_cell") {
    const where = detail.containing_cell
      ? "grid cell containing the station"
      : "nearest grid cell with values";
    return detail.distance_km === undefined
      ? where
      : `${where}, centre ${detail.distance_km.toFixed(0)} km away`;
  }
  if (pair.model.location_id !== pair.location_id) {
    return detail.distance_km === undefined
      ? `point series at ${pair.model.location_id}`
      : `point series at ${pair.model.location_id}, ${detail.distance_km.toFixed(0)} km away`;
  }
  return "series at the same location";
}

function PairChart({ file, pair }: { file: ModelVsObsFile; pair: Pair }) {
  const series = chartSeries(pair);
  if (!series || !series.time.length) {
    return <p className="note">No series to plot for this pair.</p>;
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
        aria-label={`Anomalies of ${variableName(file, pair.model.variable_id)} and ${variableName(file, pair.obs.variable_id)} at ${locationName(file, pair.location_id)}, and their difference`}
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
              {formatSigned(tick, Number.isInteger(tick * 10) ? 1 : 2)}
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
        <span className="key key-model" /> Model anomaly{" "}
        <span className="key key-obs" /> Observation anomaly{" "}
        <span className="key key-difference" /> Difference (model − observation){" "}
        {breaks.length ? (
          <>
            <span className="key key-break" /> Known step month (
            {breaks.map(formatMonth).join(", ")}){" "}
          </>
        ) : null}
        {step ? (
          <>
            <span className="key key-step" /> Largest step of the difference (
            {formatMonth(step)})
          </>
        ) : null}
        <br />
        {series.resolution === "month"
          ? "Monthly anomalies, °C."
          : "Calendar-year means of the monthly anomalies, °C (this group has no monthly values in the file)."}{" "}
        Each series is shown relative to its own mean of the same calendar month
        over the months both have.
      </figcaption>
    </figure>
  );
}

// The section of the selected pair; a link with ?pair= scrolls to it.
const PAIR_SECTION_ID = "pair";

function PairDetail({ file, pair }: { file: ModelVsObsFile; pair: Pair }) {
  const caveat = pairCaveat(pair, file.known_issues);
  const difference = pair.difference;
  return (
    <section id={PAIR_SECTION_ID}>
      <h2>{locationName(file, pair.location_id)}</h2>
      <p>
        {variableName(file, pair.model.variable_id)}
        <KindTag file={file} variable={pair.model.variable_id} /> (
        {modelPlace(pair)})
        <br />
        {variableName(file, pair.obs.variable_id)}
        <KindTag file={file} variable={pair.obs.variable_id} />
      </p>
      {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
      <PairChart file={file} pair={pair} />
      {difference && pair.model_trend && pair.obs_trend ? (
        <dl>
          <dt>Common months</dt>
          <dd>
            {pair.n_common_months} ({formatMonth(pair.first_common_month)} to{" "}
            {formatMonth(pair.last_common_month)})
          </dd>
          <dt>Model trend</dt>
          <dd>
            {formatSigned(pair.model_trend.slope_per_decade)} °C per decade (95%
            CI {formatSigned(pair.model_trend.ci_per_decade[0])} to{" "}
            {formatSigned(pair.model_trend.ci_per_decade[1])})
          </dd>
          <dt>Observation trend</dt>
          <dd>
            {formatSigned(pair.obs_trend.slope_per_decade)} °C per decade (95%
            CI {formatSigned(pair.obs_trend.ci_per_decade[0])} to{" "}
            {formatSigned(pair.obs_trend.ci_per_decade[1])})
          </dd>
          <dt>Trend of the difference</dt>
          <dd>
            {formatSigned(difference.trend.slope_per_decade)} °C per decade (95%
            CI {formatSigned(difference.trend.ci_per_decade[0])} to{" "}
            {formatSigned(difference.trend.ci_per_decade[1])};{" "}
            {difference.trend.significant
              ? `p < ${file.parameters.alpha}`
              : `p ≥ ${file.parameters.alpha}`}
            )
          </dd>
          <dt>Difference</dt>
          <dd>
            standard deviation {difference.sd.toFixed(2)} °C, RMSE{" "}
            {difference.rmse.toFixed(2)} °C
          </dd>
          <dt>Largest step</dt>
          <dd>
            {formatSigned(difference.largest_step)} °C at{" "}
            {formatMonth(difference.largest_step_month)} (mean of the 6 months
            from that month minus the 6 months before)
          </dd>
        </dl>
      ) : (
        <p className="note">
          Too few common months ({pair.n_common_months}) for statistics.
        </p>
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
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Model product</th>
            <th>Observation source</th>
            <th className="number">Months</th>
            <th className="number">r</th>
            <th className="number">Model trend</th>
            <th className="number">Obs. trend</th>
            <th className="number">Difference</th>
            <th>Largest step</th>
            <th>Known issues</th>
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
                <td className="number">{pair.n_common_months}</td>
                <td className="number">
                  {pair.correlation === null || pair.correlation === undefined
                    ? "—"
                    : pair.correlation.toFixed(2)}
                </td>
                <td className="number">
                  {formatSigned(pair.model_trend?.slope_per_decade)}
                </td>
                <td className="number">
                  {formatSigned(pair.obs_trend?.slope_per_decade)}
                </td>
                <td className="number">
                  {formatSigned(pair.slope_difference)}
                </td>
                <td>
                  {formatMonth(pair.difference?.largest_step_month)} (
                  {formatSigned(pair.difference?.largest_step)})
                </td>
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
          Group{" "}
          <select
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setSelected(null);
            }}
          >
            {groups.map((id) => (
              <option key={id} value={id}>
                {GROUP_LABELS[id] ?? id} (
                {file.summary.n_pairs_by_group[id] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <span className="note">
          Trends in °C per decade over the common months. Select a location to
          plot the pair.
        </span>
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
          Not paired:{" "}
          {file.skipped
            .map((item) => `${item.pair_id} (${item.reason})`)
            .join("; ")}
          .
        </p>
      ) : null}
    </>
  );
}

export function ComparePage() {
  const state = useAnalysisFile(loadModelVsObs);

  return (
    <main className="mining compare">
      <p>
        <a href={import.meta.env.BASE_URL}>← Globe</a>
      </p>
      <h1>Model vs observation</h1>
      <p>
        Near-surface air temperature from models and reanalyses next to
        observations of the same quantity at the same place. Both series are
        turned into anomalies over the months they share (
        {state.status === "ready"
          ? `${formatMonth(state.data.parameters.window_start)} to ${formatMonth(state.data.parameters.window_end)}`
          : "2001-01 to 2025-12"}
        ): each minus its own mean of the same calendar month, so different
        baselines and units can be compared.
      </p>
      <p className="verdict">
        A difference between a model and an observation does not by itself say
        which one is right. A station is a point and a model value is a grid
        cell; GISTEMP is a 2° gridded analysis of station and ship observations.
      </p>
      {state.status === "loading" ? <p>Loading…</p> : null}
      {state.status === "error" ? (
        <p>Could not read the comparison results.</p>
      ) : null}
      {state.status === "ready" ? <Comparison file={state.data} /> : null}
    </main>
  );
}
