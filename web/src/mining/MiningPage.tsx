import { useState } from "react";
import {
  foldVerdict,
  formatExcluded,
  formatFeature,
  formatParameter,
  formatQ,
  formatRule,
  formatShare,
  formatTopRules,
  labelTreeText,
  loadMining,
  nextSort,
  ruleComparisonRows,
  sortRules,
  visibleRules,
  type DecisionTreeFile,
  type ExcludedVariable,
  type FpGrowthFile,
  type MiningResults,
  type Parameters,
  type RuleSort,
  type RuleSortKey,
  type VariableNames,
} from "../analysis/mining";
import { useAnalysisFile } from "../analysis/useAnalysisFile";

const columns: { key: RuleSortKey; label: string }[] = [
  { key: "rule", label: "Rule" },
  { key: "support", label: "Support" },
  { key: "confidence", label: "Confidence" },
  { key: "lift", label: "Lift" },
  { key: "q", label: "q" },
];

function ExcludedNote({
  excluded,
  names,
  limit,
}: {
  excluded: ExcludedVariable[];
  names: VariableNames;
  limit: Parameters[string] | undefined;
}) {
  return (
    <p className="note">
      Near-duplicate variables are left out by a fixed rule, not picked by hand:
      variables are taken in snapshot catalog order, and one is dropped when its
      detrended anomalies correlate above {formatParameter(limit ?? null)} (in
      absolute value) with a variable already kept.{" "}
      {excluded.length
        ? `Left out here: ${excluded.map((item) => formatExcluded(item, names)).join("; ")}.`
        : "None is left out here."}
    </p>
  );
}

function ParameterList({ parameters }: { parameters: Parameters }) {
  return (
    <dl>
      {Object.entries(parameters).map(([name, value]) => (
        <div key={name} style={{ display: "contents" }}>
          <dt>{name}</dt>
          <dd>{formatParameter(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function RulesSection({ file }: { file: FpGrowthFile }) {
  const [tableId, setTableId] = useState("region");
  const [lagged, setLagged] = useState(false);
  const [showPersistence, setShowPersistence] = useState(false);
  const [sort, setSort] = useState<RuleSort>({ key: "lift", descending: true });
  const names = file.variable_names;
  const table = file.tables[tableId];
  if (!table) return null;
  const set = lagged ? table.lagged_one_month : table.same_month;
  const shown = sortRules(visibleRules(set, showPersistence), sort, names);

  return (
    <section>
      <h2>Association rules (FP-growth)</h2>
      <p className="note">
        Each detrended monthly anomaly is labelled low, normal or high against
        that series&apos; own quantiles. One location in one month is one
        transaction. Support is the share of transactions that contain every
        item of the rule, confidence is the share of transactions with the left
        side that also have the right side, and lift is confidence divided by
        how common the right side is on its own. The two sides of a rule never
        use the same variable.
      </p>
      <p className="note">
        q: {file.significance_note} Only rules with q below{" "}
        {formatParameter(file.parameters.rule_alpha ?? null)} are kept.
      </p>
      <div className="controls">
        <label>
          Table{" "}
          <select
            value={tableId}
            onChange={(event) => setTableId(event.target.value)}
          >
            {Object.keys(file.tables).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timing{" "}
          <select
            value={lagged ? "lagged" : "same"}
            onChange={(event) => setLagged(event.target.value === "lagged")}
          >
            <option value="same">same month</option>
            <option value="lagged">previous month → this month</option>
          </select>
        </label>
        {lagged ? (
          <label>
            <input
              type="checkbox"
              checked={showPersistence}
              onChange={() => setShowPersistence((value) => !value)}
            />{" "}
            Also show same-variable persistence ({set.n_persistence_rules} rules
            where a variable stays in its state)
          </label>
        ) : null}
      </div>
      <p className="note">
        {table.first_month?.slice(0, 7)} to {table.last_month?.slice(0, 7)} ·{" "}
        {set.n_transactions} transactions · locations:{" "}
        {table.locations.join(", ")} · {table.n_missing_cells} of{" "}
        {table.n_cells} cells missing · {set.n_candidate_rules} rules pass the
        support, confidence and lift thresholds, {set.n_rules} of them have q
        below the limit · showing {shown.length}
        {table.dropped_series.length
          ? ` · left out (not enough data): ${table.dropped_series
              .map(
                (item) =>
                  `${names[item.variable_id] ?? item.variable_id} at ${item.location_id}`,
              )
              .join(", ")}`
          : ""}
      </p>
      <ExcludedNote
        excluded={table.excluded_variables}
        names={names}
        limit={file.parameters.max_abs_correlation}
      />
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.key === "rule" ? undefined : "number"}
                  aria-sort={
                    sort.key !== column.key
                      ? "none"
                      : sort.descending
                        ? "descending"
                        : "ascending"
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSort(nextSort(sort, column.key))}
                  >
                    {column.label}
                    {sort.key === column.key
                      ? sort.descending
                        ? " ↓"
                        : " ↑"
                      : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((rule) => (
              <tr key={formatRule(rule, {})}>
                <td>{formatRule(rule, names)}</td>
                <td className="number">{formatShare(rule.support)}</td>
                <td className="number">{formatShare(rule.confidence)}</td>
                <td className="number">{rule.lift.toFixed(2)}</td>
                <td className="number">{formatQ(rule.q)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 ? (
        <p className="note">
          No rule with different variables on the two sides passes the
          thresholds and the significance test.
        </p>
      ) : null}
      <h3>Parameters</h3>
      <ParameterList parameters={file.parameters} />
    </section>
  );
}

function TreeSection({ file }: { file: DecisionTreeFile }) {
  const names = file.variable_names;
  const classes = file.target_classes;
  const summary = file.summary;
  const last = file.folds.at(-1);

  return (
    <section>
      <h2>Decision tree</h2>
      <p className="note">
        Target: the low, normal or high state of{" "}
        {formatFeature(file.target, names)} in the {file.table} table. Features:
        the same month&apos;s detrended anomalies of the other variables, plus
        last month&apos;s value of each variable
        {file.features.includes(`prev:${file.target}`)
          ? " (including the target itself)"
          : " (not the target's own previous month)"}
        .{" "}
        {file.same_quantity_excluded.length
          ? `Not used as features because they measure the same quantity as the target: ${file.same_quantity_excluded
              .map((id) => names[id] ?? id)
              .join(", ")}. `
          : ""}
        Validation walks forward in time: each fold tests on the next block of
        months and trains on every month before it. Monthly means, the linear
        trend and the target&apos;s quantiles are estimated from the training
        months of each fold only.
      </p>
      <p
        className={summary.above_all_in_every_fold ? "verdict" : "verdict warn"}
      >
        {summary.text_en}
      </p>
      <p className="note">
        Three baselines per fold, all scored on the test months and none using
        any other variable: always guess the most common class of the training
        months; always guess the most common class of the test months (known
        only afterwards); guess that the target stays in last month&apos;s state
        (persistence). Mean test accuracy over {summary.n_folds} folds: tree{" "}
        {formatShare(summary.mean_test_accuracy)}, training-majority guess{" "}
        {formatShare(summary.mean_train_majority_accuracy)}, test-majority guess{" "}
        {formatShare(summary.mean_test_majority_accuracy)}, persistence guess{" "}
        {formatShare(summary.mean_persistence_accuracy)}.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Fold</th>
              <th>Training months</th>
              <th>Test months</th>
              <th className="number">Tree, test</th>
              <th className="number">Training-majority guess</th>
              <th className="number">Test-majority guess</th>
              <th className="number">Persistence guess</th>
              <th>Tree against baselines</th>
            </tr>
          </thead>
          <tbody>
            {file.folds.map((fold) => (
              <tr key={fold.fold}>
                <td>{fold.fold}</td>
                <td>
                  {fold.train_first_month.slice(0, 7)} to{" "}
                  {fold.train_last_month.slice(0, 7)} ({fold.n_train} rows)
                </td>
                <td>
                  {fold.test_first_month.slice(0, 7)} to{" "}
                  {fold.test_last_month.slice(0, 7)} ({fold.n_test} rows)
                </td>
                <td className="number">{formatShare(fold.accuracy.test)}</td>
                <td className="number">
                  {formatShare(fold.baselines.train_majority.test_accuracy)} (
                  {fold.baselines.train_majority.predicted_class}
                  {fold.baselines.train_majority.tie ? ", tied" : ""})
                </td>
                <td className="number">
                  {formatShare(fold.baselines.test_majority.test_accuracy)} (
                  {fold.baselines.test_majority.predicted_class})
                </td>
                <td className="number">
                  {formatShare(fold.baselines.persistence.test_accuracy)}
                </td>
                <td>{foldVerdict(fold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl>
        <dt>Rows used</dt>
        <dd>
          {Object.entries(file.rows_by_location)
            .map(
              ([location, rows]) =>
                `${location} ${rows.n_complete_rows} of ${rows.n_rows}` +
                (rows.missing_variables.length
                  ? ` (no ${rows.missing_variables
                      .map((id) => names[id] ?? id)
                      .join(", ")})`
                  : ""),
            )
            .join(" · ")}
        </dd>
      </dl>
      <ExcludedNote
        excluded={file.excluded_variables}
        names={names}
        limit={file.parameters.max_abs_correlation}
      />
      {last ? (
        <>
          <h3>
            Tree of fold {last.fold} (trained on{" "}
            {last.train_first_month.slice(0, 7)} to{" "}
            {last.train_last_month.slice(0, 7)})
          </h3>
          <pre>{labelTreeText(last.tree_text, names)}</pre>
          <h3>
            Fold {last.fold} test months: actual state (rows) against predicted
            state
          </h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Actual</th>
                  {classes.map((name) => (
                    <th key={name} className="number">
                      predicted {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((actual) => (
                  <tr key={actual}>
                    <td>{actual}</td>
                    {classes.map((predicted) => (
                      <td key={predicted} className="number">
                        {last.confusion_matrix_test[actual]?.[predicted] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Feature importance (fold {last.fold})</h3>
          <div className="scroll">
            <table>
              <tbody>
                {last.feature_importances
                  .filter((item) => item.importance > 0)
                  .map((item) => (
                    <tr key={item.feature}>
                      <td>{formatFeature(item.feature, names)}</td>
                      <td className="number">{item.importance.toFixed(3)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <h3>Parameters</h3>
      <ParameterList parameters={file.parameters} />
    </section>
  );
}

// Numbers only: how the results change when gaps are filled or left missing.
function GapFillingSection({ data }: { data: MiningResults }) {
  const rules = data.rules.gap_filling_sensitivity;
  const tree = data.tree.gap_filling_sensitivity;
  if (!rules || !tree) return null;
  const runs = [rules.primary, rules.compared_with];
  const filled = tree.filled;
  const unfilled = tree.unfilled;

  return (
    <section>
      <h2>Gap filling: filled and unfilled runs compared</h2>
      <p className="note">
        {data.rules.gap_filling_note} The tables and the tree above are the{" "}
        {rules.primary} run. Trend statistics are never gap-filled.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th>Timing</th>
              <th className="number">
                Months filled (interpolated / climatology)
              </th>
              {runs.map((run) => (
                <th key={run} className="number">
                  Missing cells, {run}
                </th>
              ))}
              {runs.map((run) => (
                <th key={run} className="number">
                  Rules, {run}
                </th>
              ))}
              <th className="number">Listed rules in both</th>
              <th>Top rules</th>
            </tr>
          </thead>
          <tbody>
            {ruleComparisonRows(data.rules).map((row) => {
              const filling = data.rules.tables[row.table]?.gap_filling;
              const cells = rules.tables[row.table]?.n_missing_cells ?? {};
              return (
                <tr key={`${row.table} ${row.timing}`}>
                  <td>{row.table}</td>
                  <td>{row.timing}</td>
                  <td className="number">
                    {filling
                      ? `${filling.n_filled_linear} / ${filling.n_filled_climatology}`
                      : "–"}
                  </td>
                  {runs.map((run) => (
                    <td key={run} className="number">
                      {cells[run] ?? "–"}
                    </td>
                  ))}
                  {runs.map((run) => (
                    <td key={run} className="number">
                      {row.comparison.n_rules[run] ?? "–"}
                    </td>
                  ))}
                  <td className="number">
                    {row.comparison.n_listed_rules_in_both}
                  </td>
                  <td>
                    {formatTopRules(row.comparison)}
                    {row.comparison.top_rules_compared
                      ? ` (top ${row.comparison.top_rules_compared})`
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filled && unfilled ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Decision tree fold</th>
                <th className="number">Test rows, filled</th>
                <th className="number">Tree, filled</th>
                <th className="number">Test rows, unfilled</th>
                <th className="number">Tree, unfilled</th>
                <th className="number">Training-majority guess</th>
                <th className="number">Test-majority guess</th>
                <th className="number">Persistence guess</th>
              </tr>
            </thead>
            <tbody>
              {filled.folds.map((fold, index) => {
                const other = unfilled.folds[index];
                return (
                  <tr key={fold.fold}>
                    <td>{fold.fold}</td>
                    <td className="number">{fold.n_test}</td>
                    <td className="number">
                      {formatShare(fold.test_accuracy)}
                    </td>
                    <td className="number">{other?.n_test ?? "–"}</td>
                    <td className="number">
                      {other ? formatShare(other.test_accuracy) : "–"}
                    </td>
                    <td className="number">
                      {formatShare(fold.train_majority_accuracy)}
                    </td>
                    <td className="number">
                      {formatShare(fold.test_majority_accuracy)}
                    </td>
                    <td className="number">
                      {formatShare(fold.persistence_accuracy)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {filled && unfilled ? (
        <p className="note">
          Baselines are those of the filled run. Folds above all three
          baselines: {filled.summary.n_folds_above_all} of {filled.folds.length}{" "}
          filled, {unfilled.summary.n_folds_above_all} of{" "}
          {unfilled.folds.length} unfilled. Rows usable for the tree:{" "}
          {filled.n_complete_rows} filled, {unfilled.n_complete_rows} unfilled.
        </p>
      ) : null}
    </section>
  );
}

// Numbers only: how the results change when series with verified step months
// are cut at those months before detrending.
function SegmentationSection({ data }: { data: MiningResults }) {
  const rules = data.rules.segmentation_sensitivity;
  const tree = data.tree.segmentation_sensitivity;
  if (!rules || !tree) return null;
  const runs = [rules.primary, rules.compared_with];
  const names = data.rules.variable_names;
  const stepped = [
    ...new Set(
      Object.values(rules.tables).flatMap((table) =>
        table.segmented_series.map(
          (item) =>
            `${names[item.variable_id] ?? item.variable_id} (${item.break_months
              .map((month) => month.slice(0, 7))
              .join(", ")})`,
        ),
      ),
    ),
  ];
  const primary = tree.unsegmented;
  const other = tree.segmented;

  return (
    <section>
      <h2>Known step months: segmented and unsegmented runs compared</h2>
      <p className="note">
        {rules.note} Series cut in the segmented run:{" "}
        {stepped.length ? stepped.join("; ") : "none"}.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th>Timing</th>
              {runs.map((run) => (
                <th key={run} className="number">
                  Rules, {run}
                </th>
              ))}
              <th className="number">Listed rules in both</th>
              <th>Top rules</th>
            </tr>
          </thead>
          <tbody>
            {ruleComparisonRows(data.rules, "segmentation").map((row) => (
              <tr key={`${row.table} ${row.timing}`}>
                <td>{row.table}</td>
                <td>{row.timing}</td>
                {runs.map((run) => (
                  <td key={run} className="number">
                    {row.comparison.n_rules[run] ?? "–"}
                  </td>
                ))}
                <td className="number">
                  {row.comparison.n_listed_rules_in_both}
                </td>
                <td>
                  {formatTopRules(row.comparison)}
                  {row.comparison.top_rules_compared
                    ? ` (top ${row.comparison.top_rules_compared})`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {primary && other ? (
        <p className="note">
          Decision tree test accuracy by fold: unsegmented{" "}
          {primary.folds
            .map((fold) => formatShare(fold.test_accuracy))
            .join(", ")}
          ; segmented{" "}
          {other.folds
            .map((fold) => formatShare(fold.test_accuracy))
            .join(", ")}
          . Folds above all three baselines: {primary.summary.n_folds_above_all}{" "}
          of {primary.folds.length} unsegmented,{" "}
          {other.summary.n_folds_above_all} of {other.folds.length} segmented.
        </p>
      ) : null}
    </section>
  );
}

export function MiningPage() {
  const state = useAnalysisFile(loadMining);

  return (
    <main className="mining">
      <p>
        <a href={import.meta.env.BASE_URL}>← Globe</a>
      </p>
      <h1>
        Data mining <span className="tag">exploratory</span>
      </h1>
      {state.status === "loading" ? <p>Loading…</p> : null}
      {state.status === "error" ? (
        <p>Could not read the mining results.</p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p>{state.data.rules.note}</p>
          <p className="note">
            Parameters are adjustable defaults, not conclusions. Input: monthly
            anomalies from the snapshot of{" "}
            {state.data.rules.input.snapshot_generated_at.slice(0, 10)}.{" "}
            {state.data.rules.detrending_note} Locations left out:{" "}
            {formatParameter(
              state.data.rules.parameters.exclude_locations ?? null,
            )}{" "}
            (the taiwan box overlaps the other four regions, so the same
            observation would be counted twice).
          </p>
          <RulesSection file={state.data.rules} />
          <TreeSection file={state.data.tree} />
          <GapFillingSection data={state.data} />
          <SegmentationSection data={state.data} />
        </>
      ) : null}
    </main>
  );
}
