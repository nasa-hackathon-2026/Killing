import { useState } from "react";
import {
  formatR,
  formatSmall,
  runningMean,
  similarKey,
  similarSelection,
  sparkPath,
  variablesAt,
  type SimilarEntry,
  type SimilarSeriesFile,
} from "../analysis/miningPlus";
import { MethodDetails } from "./parts";

const SPARK_WIDTH = 220;
const SPARK_HEIGHT = 44;
const SPARK_LIMIT = 2;
const SMOOTH_MONTHS = 12;

const GROUP_LABELS: Record<string, string> = {
  taiwan: "Taiwan",
  world_city: "World cities",
  global: "Global mean",
};

function seriesLabel(file: SimilarSeriesFile, key: string): string {
  const item = file.series[key];
  if (!item) return key;
  const place = file.locations[item.location_id]?.name_en ?? item.location_id;
  return `${file.variable_names[item.variable_id] ?? item.variable_id} · ${place}`;
}

function Spark({
  file,
  queryKey,
  otherKey,
}: {
  file: SimilarSeriesFile;
  queryKey: string;
  otherKey: string;
}) {
  const query = runningMean(file.series[queryKey]?.z ?? [], SMOOTH_MONTHS);
  const other = runningMean(file.series[otherKey]?.z ?? [], SMOOTH_MONTHS);
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      role="img"
      aria-label={`Standardized anomalies of ${seriesLabel(file, queryKey)} and ${seriesLabel(file, otherKey)}, 12-month running means`}
    >
      <line
        className="spark-zero"
        x1={0}
        x2={SPARK_WIDTH}
        y1={SPARK_HEIGHT / 2}
        y2={SPARK_HEIGHT / 2}
      />
      <path
        className="spark-other"
        d={sparkPath(other, SPARK_WIDTH, SPARK_HEIGHT, SPARK_LIMIT)}
      />
      <path
        className="spark-query"
        d={sparkPath(query, SPARK_WIDTH, SPARK_HEIGHT, SPARK_LIMIT)}
      />
    </svg>
  );
}

function EntryTable({
  file,
  queryKey,
  entries,
  caption,
}: {
  file: SimilarSeriesFile;
  queryKey: string;
  entries: SimilarEntry[];
  caption: string;
}) {
  return (
    <div className="scroll">
      <table className="similar-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Series</th>
            <th>Both lines (selected in white)</th>
            <th className="number">Similarity</th>
            <th className="number">After removing trends</th>
            <th>Below the limit</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const item = file.series[entry.series];
            const notes = [
              entry.trend_sensitive ? "changes when trends are removed" : null,
              item?.known_issues.length ? "documented data issue" : null,
            ].filter((note) => note !== null);
            return (
              <tr key={entry.series}>
                <td>{seriesLabel(file, entry.series)}</td>
                <td>
                  <Spark
                    file={file}
                    queryKey={queryKey}
                    otherKey={entry.series}
                  />
                </td>
                <td className="number">{formatR(entry.cosine)}</td>
                <td className="number">{formatR(entry.cosine_detrended)}</td>
                <td>
                  <span
                    className={
                      entry.significant ? "pill pill-yes" : "pill pill-no"
                    }
                  >
                    {entry.significant ? "yes" : "no"} (q ={" "}
                    {formatSmall(entry.q)})
                  </span>{" "}
                  <span className="note">
                    after removing trends:{" "}
                    {entry.significant_detrended ? "yes" : "no"}
                  </span>
                </td>
                <td>{notes.length ? notes.join("; ") : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SimilarSection({ file }: { file: SimilarSeriesFile }) {
  const [selection, setSelection] = useState(() =>
    similarSelection(file, window.location.search),
  );
  const choose = (locationId: string, variableId: string) => {
    const next = similarSelection(
      file,
      `?place=${encodeURIComponent(locationId)}&variable=${encodeURIComponent(variableId)}`,
    );
    setSelection(next);
    window.history.replaceState(
      null,
      "",
      `?place=${encodeURIComponent(next.locationId)}&variable=${encodeURIComponent(next.variableId)}#similar`,
    );
  };
  const key = similarKey(file, selection.locationId, selection.variableId);
  const result = key ? file.results[key] : undefined;
  const groups = [
    ...new Set(Object.values(file.locations).map((item) => item.group)),
  ];
  const summary = file.summary;
  const selected = key ? file.series[key] : undefined;

  return (
    <section id="similar" aria-labelledby="similar-title">
      <h2 id="similar-title">Similar series</h2>
      <p className="asks">
        <strong>What this asks:</strong> for one variable at one place, which
        other variables — here or elsewhere — went above and below normal in the
        same months?
      </p>
      <p className="note">
        <strong>Method and limits:</strong> similarity is the correlation of the
        monthly anomalies of two series over {file.window.n_months} months (
        {file.window.first_month.slice(0, 7)} to{" "}
        {file.window.last_month.slice(0, 7)}), from +1 (always together) to −1
        (always opposite). {file.note} Among {summary.n_series} series there are{" "}
        {summary.n_candidate_pairs} possible pairs, so some similarity turns up
        by chance; {summary.n_candidate_pairs_significant} pairs are below the
        limit, {summary.n_candidate_pairs_significant_detrended} after the
        trends are removed.
      </p>
      <div className="controls">
        <label>
          Place{" "}
          <select
            value={selection.locationId}
            onChange={(event) =>
              choose(event.target.value, selection.variableId)
            }
          >
            {groups.map((group) => (
              <optgroup key={group} label={GROUP_LABELS[group] ?? group}>
                {Object.entries(file.locations)
                  .filter(([, item]) => item.group === group)
                  .map(([id, item]) => (
                    <option key={id} value={id}>
                      {item.name_en}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Variable{" "}
          <select
            value={selection.variableId}
            onChange={(event) =>
              choose(selection.locationId, event.target.value)
            }
          >
            {variablesAt(file, selection.locationId).map((id) => (
              <option key={id} value={id}>
                {file.variable_names[id] ?? id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {key && result ? (
        <>
          {selected?.known_issues.length ? (
            <p className="note">
              The selected series has a documented data issue (
              {selected.known_issues.join(", ")}).
            </p>
          ) : null}
          <EntryTable
            file={file}
            queryKey={key}
            entries={result.most_similar}
            caption={`Most similar to ${seriesLabel(file, key)}`}
          />
          <EntryTable
            file={file}
            queryKey={key}
            entries={result.least_similar}
            caption={`Least similar (most opposite) to ${seriesLabel(file, key)}`}
          />
          <p className="note">
            Lines are 12-month running means of the standardized anomalies
            (drawn from −2 to +2 standard deviations); the similarity is
            computed on the monthly values. Only other variables are listed, and
            not another product of the same quantity. &quot;Below the
            limit&quot; means q &lt; {file.parameters.alpha} after correcting
            for month-to-month persistence and for all{" "}
            {summary.n_candidate_pairs} pairs.
          </p>
        </>
      ) : (
        <p className="note">
          This variable has no series at this place in the similarity export.
        </p>
      )}
      <MethodDetails>
        <dl>
          {Object.entries(file.methods).map(([name, text]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
          <dt>listed pairs</dt>
          <dd>
            {summary.n_listed} listed over all series;{" "}
            {summary.n_listed_significant} below the limit,{" "}
            {summary.n_listed_significant_detrended} after removing trends;{" "}
            {summary.n_listed_trend_sensitive} marked as changing when trends
            are removed.
          </dd>
          <dt>check</dt>
          <dd>
            The similarities computed in the database (pgvector) and in Python{" "}
            {file.check.pgvector_matches_numpy ? "agree" : "do not agree"} to
            within {file.check.tolerance}.
          </dd>
        </dl>
      </MethodDetails>
    </section>
  );
}
