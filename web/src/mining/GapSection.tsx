import { useState } from "react";
import { formatParameter, formatShare } from "../analysis/mining";
import {
  barScale,
  gapFeatureLabel,
  gapFoldVerdict,
  gapGroupLabel,
  labelGapTreeText,
  stationName,
  type GapFold,
  type GapStat,
  type GapTreeFile,
  type GapValidation,
} from "../analysis/miningPlus";
import { MethodDetails } from "./parts";

const GROUPINGS = [
  { id: "by_product_season", label: "Season" },
  { id: "by_product_segment", label: "GLDAS segment" },
  { id: "by_product_station", label: "Station" },
  { id: "by_product", label: "All months" },
];

const VARIANT_LABELS: Record<string, string> = {
  with_segment: "main run (with GLDAS segment number)",
  without_segment: "without GLDAS segment number",
  with_target_lag: "reference: also uses the previous month's class",
};

function GapBars({ file, grouping }: { file: GapTreeFile; grouping: string }) {
  const rows: GapStat[] = file.descriptive[grouping] ?? [];
  const scale = barScale(rows) || 1;
  const percent = (value: number) => `${((value / scale) * 100).toFixed(1)}%`;
  return (
    <div className="scroll">
      <table className="gap-bars">
        <thead>
          <tr>
            <th>Model</th>
            <th>Group</th>
            <th className="bar-cell">
              Mean absolute difference (°C), with 95% interval
            </th>
            <th className="number">Mean</th>
            <th className="number">95% interval</th>
            <th className="number">Months</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const [low, high] = row.ci;
            return (
              <tr key={`${row.model} ${row.group}`}>
                <td>{file.variable_names[row.model] ?? row.model}</td>
                <td>{gapGroupLabel(file, grouping, row.group)}</td>
                <td className="bar-cell">
                  <div className="bar-track" aria-hidden="true">
                    <div
                      className={`bar bar-${row.model}`}
                      style={{ width: percent(row.mean_abs_difference) }}
                    />
                    {low !== null && high !== null ? (
                      <div
                        className="bar-interval"
                        style={{
                          left: percent(low),
                          width: percent(high - low),
                        }}
                      />
                    ) : null}
                  </div>
                </td>
                <td className="number">{row.mean_abs_difference.toFixed(2)}</td>
                <td className="number">
                  {low !== null && high !== null
                    ? `${low.toFixed(2)} to ${high.toFixed(2)}`
                    : "–"}
                </td>
                <td className="number">{row.n_months}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function foldLabel(file: GapTreeFile, fold: GapFold): string {
  if (fold.held_out_station) {
    return `${stationName(file, fold.held_out_station)} held out`;
  }
  return `${fold.test_first_month?.slice(0, 7)} to ${fold.test_last_month?.slice(0, 7)}`;
}

function FoldTable({
  file,
  validation,
  firstColumn,
}: {
  file: GapTreeFile;
  validation: GapValidation;
  firstColumn: string;
}) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th className="number">Training rows</th>
            <th className="number">Test rows</th>
            <th className="number">Tree, test accuracy</th>
            <th className="number">Tree, macro-F1</th>
            <th className="number">Training-majority guess</th>
            <th className="number">Persistence guess</th>
            <th className="number">Calendar-month guess</th>
            <th>Tree against baselines</th>
          </tr>
        </thead>
        <tbody>
          {validation.folds.map((fold) => (
            <tr key={fold.fold}>
              <td>{foldLabel(file, fold)}</td>
              <td className="number">{fold.n_train}</td>
              <td className="number">{fold.n_test}</td>
              <td className="number">{formatShare(fold.accuracy.test)}</td>
              <td className="number">{fold.macro_f1.test.toFixed(2)}</td>
              <td className="number">
                {formatShare(fold.baselines.train_majority.test_accuracy)}
              </td>
              <td className="number">
                {formatShare(fold.baselines.persistence.test_accuracy)}
              </td>
              <td className="number">
                {formatShare(fold.baselines.calendar_month.test_accuracy)}
              </td>
              <td>
                <span
                  className={
                    fold.above_all_baselines ? "pill pill-yes" : "pill pill-no"
                  }
                >
                  {gapFoldVerdict(fold)}
                </span>
              </td>
            </tr>
          ))}
          <tr className="mean-row">
            <td>Mean</td>
            <td />
            <td />
            <td className="number">
              {formatShare(validation.summary.mean_test_accuracy)}
            </td>
            <td className="number">
              {validation.summary.mean_macro_f1.toFixed(2)}
            </td>
            <td className="number">
              {formatShare(validation.summary.mean_train_majority_accuracy)}
            </td>
            <td className="number">
              {formatShare(validation.summary.mean_persistence_accuracy)}
            </td>
            <td className="number">
              {formatShare(validation.summary.mean_calendar_month_accuracy)}
            </td>
            <td>
              above all three in {validation.summary.n_folds_above_all} of{" "}
              {validation.summary.n_folds}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Stability({
  file,
  validation,
}: {
  file: GapTreeFile;
  validation: GapValidation;
}) {
  const used = validation.importance_stability.filter((item) => item.max > 0);
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th className="number">Mean importance</th>
            <th className="number">Lowest</th>
            <th className="number">Highest</th>
            <th className="number">Used in</th>
            <th className="number">Ranked first in</th>
          </tr>
        </thead>
        <tbody>
          {used.map((item) => (
            <tr key={item.feature}>
              <td>{gapFeatureLabel(file, item.feature)}</td>
              <td className="number">{item.mean.toFixed(3)}</td>
              <td className="number">{item.min.toFixed(3)}</td>
              <td className="number">{item.max.toFixed(3)}</td>
              <td className="number">
                {item.n_folds_used} of {validation.summary.n_folds}
              </td>
              <td className="number">
                {item.n_folds_top} of {validation.summary.n_folds}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GapSection({ file }: { file: GapTreeFile }) {
  const [grouping, setGrouping] = useState("by_product_season");
  const [variantId, setVariantId] = useState(file.primary_variant);
  const variant = file.variants[variantId];
  if (!variant) return null;
  const walk = variant.walk_forward;
  const held = variant.leave_one_location_out;
  const last = walk.folds.at(-1);
  const stations = [...new Set(file.pairs.map((pair) => pair.station))];
  const totalMonths = file.pairs.reduce((sum, pair) => sum + pair.n_months, 0);

  return (
    <section id="gap" aria-labelledby="gap-title">
      <h2 id="gap-title">Where do models and observations differ?</h2>
      <p className="asks">
        <strong>What this asks:</strong> in which months, at which stations and
        for which model product is the monthly difference between a model
        temperature anomaly and the station anomaly larger?
      </p>
      <p className="note">
        <strong>Method and limits:</strong> {file.pairs.length} pairs of a
        Taiwan weather station with GLDAS or MERRA-2 at the same place (
        {stations.length} stations, {totalMonths} pair-months). A table of group
        means comes first; a decision tree then tries to predict whether the
        difference of a month is small, medium or large and is compared with
        three simple guesses. {file.note} The pairs and their time series are on
        the{" "}
        <a href={`${import.meta.env.BASE_URL}compare/`}>Model vs observation</a>{" "}
        page.
      </p>

      <h3>Mean size of the difference by group</h3>
      <div className="controls">
        <label>
          Group by{" "}
          <select
            value={grouping}
            onChange={(event) => setGrouping(event.target.value)}
          >
            {GROUPINGS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GapBars file={file} grouping={grouping} />
      <p className="note">
        The bar is the mean of |model anomaly − station anomaly| over the months
        of the group; the line on it is a 95% interval from a bootstrap that
        resamples whole calendar years. GLDAS segments start at the documented
        step months of the GLDAS air temperature (
        {file.gldas_break_months.map((month) => month.slice(0, 7)).join(", ")});
        MERRA-2 is split at the same months only for comparison. GLDAS has no
        land cell at Lanyu, so that station has a MERRA-2 pair only.
      </p>

      <h3>Decision tree: small, medium or large difference</h3>
      <p
        className={
          walk.summary.n_folds_above_all === walk.summary.n_folds
            ? "verdict"
            : "verdict warn"
        }
      >
        <strong>Forward in time:</strong> {walk.summary.text_en}
      </p>
      <p
        className={
          held.summary.n_folds_above_all === held.summary.n_folds
            ? "verdict"
            : "verdict warn"
        }
      >
        <strong>New station:</strong> {held.summary.text_en}
      </p>
      <div className="controls">
        <label>
          Run{" "}
          <select
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
          >
            {file.variants_run.map((id) => (
              <option key={id} value={id}>
                {VARIANT_LABELS[id] ?? id}
              </option>
            ))}
          </select>
        </label>
        <span className="note">
          {variant.n_rows} rows, {variant.first_month.slice(0, 7)} to{" "}
          {variant.last_month.slice(0, 7)}
        </span>
      </div>
      <p className="note">
        All {file.variants_run.length} runs that were made are listed here; no
        other settings were tried. {variant.note}
      </p>

      <h4>Forward in time (train on earlier months, test on later months)</h4>
      <FoldTable file={file} validation={walk} firstColumn="Test months" />
      <h4>
        New station (train on the other stations, test on the one held out)
      </h4>
      <FoldTable file={file} validation={held} firstColumn="Station" />
      <p className="note">
        Accuracy is the share of test rows put in the right class; with three
        classes of about equal size a blind guess is right about a third of the
        time. The three guesses use no other variable: the most common class of
        the training rows, the pair&apos;s class of the previous month
        (persistence), and the most common training class of the same calendar
        month. Training and test rows of the new-station check cover the same
        months, so it checks a new place, not the future.
      </p>

      {last ? (
        <>
          <h4>
            Tree of the last forward fold (trained on{" "}
            {last.train_first_month?.slice(0, 7)} to{" "}
            {last.train_last_month?.slice(0, 7)})
          </h4>
          <pre>{labelGapTreeText(file, last.tree_text)}</pre>
          <p className="note">
            States are −1 (low), 0 (normal), 1 (high); a test like &quot;station
            is Taipei &lt;= 0.5&quot; is true for every other station. The
            counts at the leaves are training rows.
          </p>
          <h4>
            Last forward fold, test rows: actual class (rows) against predicted
            class
          </h4>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Actual</th>
                  {file.classes.map((name) => (
                    <th key={name} className="number">
                      predicted {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {file.classes.map((actual) => (
                  <tr key={actual}>
                    <td>{actual}</td>
                    {file.classes.map((predicted) => (
                      <td key={predicted} className="number">
                        {last.confusion_matrix_test[actual]?.[predicted] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h4>Which features the trees use, fold by fold (forward in time)</h4>
      <Stability file={file} validation={walk} />
      <h4>Which features the trees use (new station)</h4>
      <Stability file={file} validation={held} />

      <MethodDetails>
        <dl>
          {Object.entries(file.methods).map(([name, text]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
          <dt>leakage guards</dt>
          <dd>{file.leakage_guards.join("; ")}.</dd>
          <dt>context variables</dt>
          <dd>
            {file.context_variables
              .map((id) => file.variable_names[id] ?? id)
              .join(", ")}{" "}
            at the nearest core point (
            {[
              ...new Set(
                file.pairs.map(
                  (pair) =>
                    `${stationName(file, pair.station)}: ${pair.context_point}, ${pair.context_distance_km} km`,
                ),
              ),
            ].join("; ")}
            ). Not used (temperature):{" "}
            {file.excluded_temperature_variables.join(", ")}.
          </dd>
          <dt>rows left out</dt>
          <dd>
            {Object.entries(variant.rows_dropped)
              .map(([reason, count]) => `${reason}: ${count}`)
              .join(", ")}
          </dd>
          {Object.entries(file.parameters).map(([name, value]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>
                {formatParameter(
                  value as Parameters<typeof formatParameter>[0],
                )}
              </dd>
            </div>
          ))}
        </dl>
      </MethodDetails>
    </section>
  );
}
