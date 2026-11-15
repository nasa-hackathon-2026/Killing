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
import { useI18n } from "../i18n";
import { placeName, variableName } from "../i18n/names";
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
  const { t } = useI18n();
  return (
    <div className="scroll">
      <table className="similar-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>{t("mining.similar.column.series")}</th>
            <th>{t("mining.similar.column.lines")}</th>
            <th className="number">{t("mining.similar.column.similarity")}</th>
            <th className="number">{t("mining.similar.column.detrended")}</th>
            <th>{t("mining.similar.column.below")}</th>
            <th>{t("mining.similar.column.notes")}</th>
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
  const { t } = useI18n();
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
      <h2 id="similar-title">{t("mining.sections.similar")}</h2>
      <p className="asks">
        <strong>{t("mining.label.asks")}</strong> {t("mining.similar.asks")}
      </p>
      <p className="note">
        <strong>{t("mining.label.method")}</strong>{" "}
        {t("mining.similar.method", {
          months: file.window.n_months,
          first: file.window.first_month.slice(0, 7),
          last: file.window.last_month.slice(0, 7),
          note: file.note,
          series: summary.n_series,
          pairs: summary.n_candidate_pairs,
          significant: summary.n_candidate_pairs_significant,
          detrended: summary.n_candidate_pairs_significant_detrended,
        })}
      </p>
      <div className="controls">
        <label>
          {t("mining.control.place")}{" "}
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
                      {placeName(id, item.name_en)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          {t("mining.control.variable")}{" "}
          <select
            value={selection.variableId}
            onChange={(event) =>
              choose(selection.locationId, event.target.value)
            }
          >
            {variablesAt(file, selection.locationId).map((id) => (
              <option key={id} value={id}>
                {variableName(id, file.variable_names[id] ?? id)}
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
          <dt>{t("mining.extra.listed_pairs")}</dt>
          <dd>
            {summary.n_listed} listed over all series;{" "}
            {summary.n_listed_significant} below the limit,{" "}
            {summary.n_listed_significant_detrended} after removing trends;{" "}
            {summary.n_listed_trend_sensitive} marked as changing when trends
            are removed.
          </dd>
          <dt>{t("mining.extra.check")}</dt>
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
