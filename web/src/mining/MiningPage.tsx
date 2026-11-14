import { useState } from "react";
import {
  filterRules,
  formatParameter,
  formatRule,
  formatShare,
  loadMining,
  nextSort,
  sortRules,
  type DecisionTreeFile,
  type FpGrowthFile,
  type Parameters,
  type RuleSort,
  type RuleSortKey,
} from "../analysis/mining";
import { useAnalysisFile } from "../analysis/useAnalysisFile";

const columns: { key: RuleSortKey; label: string }[] = [
  { key: "rule", label: "Rule" },
  { key: "support", label: "Support" },
  { key: "confidence", label: "Confidence" },
  { key: "lift", label: "Lift" },
];

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
  const [hideSame, setHideSame] = useState(false);
  const [sort, setSort] = useState<RuleSort>({ key: "lift", descending: true });
  const table = file.tables[tableId];
  if (!table) return null;
  const set = lagged ? table.lagged_one_month : table.same_month;
  const shown = sortRules(filterRules(set.rules, hideSame), sort);

  return (
    <section>
      <h2>Association rules (FP-growth)</h2>
      <p className="note">
        Each monthly anomaly is labelled low, normal or high against that
        series&apos; own quantiles. One location in one month is one
        transaction. Support is the share of transactions that contain every
        item of the rule, confidence is the share of transactions with the left
        side that also have the right side, and lift is confidence divided by
        how common the right side is on its own.
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
        <label>
          <input
            type="checkbox"
            checked={hideSame}
            onChange={() => setHideSame((value) => !value)}
          />{" "}
          Hide rules that repeat a variable on both sides
        </label>
      </div>
      <p className="note">
        {table.first_month?.slice(0, 7)} to {table.last_month?.slice(0, 7)} ·{" "}
        {set.n_transactions} transactions · locations:{" "}
        {table.locations.join(", ")} · {table.n_missing_cells} of{" "}
        {table.n_cells} cells missing · showing {shown.length} of {set.n_rules}{" "}
        rules
        {table.dropped_series.length
          ? ` · left out (not enough data): ${table.dropped_series
              .map((item) => `${item.variable_id} at ${item.location_id}`)
              .join(", ")}`
          : ""}
      </p>
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
              <tr key={formatRule(rule)}>
                <td>{formatRule(rule)}</td>
                <td className="number">{formatShare(rule.support)}</td>
                <td className="number">{formatShare(rule.confidence)}</td>
                <td className="number">{rule.lift.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 ? (
        <p className="note">No rule passes the thresholds.</p>
      ) : null}
      <h3>Parameters</h3>
      <ParameterList parameters={file.parameters} />
    </section>
  );
}

function TreeSection({ file }: { file: DecisionTreeFile }) {
  const baseline = file.baseline_majority_class;
  const classes = file.target_classes;

  return (
    <section>
      <h2>Decision tree</h2>
      <p className="note">
        Target: the low, normal or high state of {file.target} in the{" "}
        {file.table} table. Features: the same month&apos;s anomalies of the
        other variables. Earlier months train the tree and later months test it;
        the target&apos;s quantiles come from the training months only.
      </p>
      <dl>
        <dt>Training months</dt>
        <dd>
          {file.split.train_first_month.slice(0, 7)} to{" "}
          {file.split.train_last_month.slice(0, 7)} ({file.split.n_train} rows)
        </dd>
        <dt>Test months</dt>
        <dd>
          {file.split.test_first_month.slice(0, 7)} to{" "}
          {file.split.test_last_month.slice(0, 7)} ({file.split.n_test} rows)
        </dd>
        <dt>Accuracy, training</dt>
        <dd>{formatShare(file.accuracy.train)}</dd>
        <dt>Accuracy, test</dt>
        <dd>{formatShare(file.accuracy.test)}</dd>
        <dt>Baseline, test</dt>
        <dd>
          {formatShare(baseline.test_accuracy)} (always guess &quot;
          {baseline.predicted_class}&quot;, the most common training class
          {baseline.tie ? "; the training classes are tied" : ""})
        </dd>
        <dt>Best single guess, test</dt>
        <dd>
          {formatShare(baseline.best_constant_on_test.test_accuracy)} (always
          guess &quot;{baseline.best_constant_on_test.predicted_class}&quot;;
          known only after seeing the test months)
        </dd>
        <dt>Rows used</dt>
        <dd>
          {Object.entries(file.rows_by_location)
            .map(
              ([location, rows]) =>
                `${location} ${rows.n_complete_rows} of ${rows.n_rows}` +
                (rows.missing_variables.length
                  ? ` (no ${rows.missing_variables.join(", ")})`
                  : ""),
            )
            .join(" · ")}
        </dd>
      </dl>
      <h3>Tree</h3>
      <pre>{file.tree_text}</pre>
      <h3>Test months: actual state (rows) against predicted state</h3>
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
                    {file.confusion_matrix_test[actual]?.[predicted] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Feature importance</h3>
      <div className="scroll">
        <table>
          <tbody>
            {file.feature_importances.map((item) => (
              <tr key={item.feature}>
                <td>{item.feature}</td>
                <td className="number">{item.importance.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Parameters</h3>
      <ParameterList parameters={file.parameters} />
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
            {state.data.rules.input.snapshot_generated_at.slice(0, 10)}.
            Variables are shown by their snapshot ids.
          </p>
          <RulesSection file={state.data.rules} />
          <TreeSection file={state.data.tree} />
        </>
      ) : null}
    </main>
  );
}
