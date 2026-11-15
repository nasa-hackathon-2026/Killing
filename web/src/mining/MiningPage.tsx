import { useEffect, useState, type ReactNode } from "react";
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
import {
  filterRulesByVariable,
  loadGapTree,
  loadSimilarSeries,
  loadVariableGraph,
  sectionFromHash,
  ruleChip,
  type GapTreeFile,
  type SimilarSeriesFile,
  type VariableGraphFile,
} from "../analysis/miningPlus";
import { useAnalysisFile } from "../analysis/useAnalysisFile";
import { carryChoices, t, useI18n } from "../i18n";
import { LanguageMenu, ModeSwitch } from "../i18n/ChoiceControls";
import { variableName } from "../i18n/names";
import { GapSection } from "./GapSection";
import { NetworkSection } from "./NetworkSection";
import { MethodDetails } from "./parts";
import { SimilarSection } from "./SimilarSection";

// Column headings are messages: mining.rules.column.<key>.
const columns: { key: RuleSortKey }[] = [
  { key: "rule" },
  { key: "support" },
  { key: "confidence" },
  { key: "lift" },
  { key: "q" },
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
      {t("mining.detail.excludedNote", {
        limit: formatParameter(limit ?? null),
      })}{" "}
      {excluded.length
        ? t("mining.detail.excludedList", {
            items: excluded
              .map((item) => formatExcluded(item, names))
              .join("; "),
          })
        : t("mining.detail.excludedNone")}
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

// One item of a rule as a small label: "Precipitation high".
function Chip({ item, names }: { item: string; names: VariableNames }) {
  const chip = ruleChip(item);
  return (
    <span className={`chip chip-${chip.state}`}>
      {variableName(chip.variableId, names[chip.variableId] ?? chip.variableId)}{" "}
      <strong>{chip.state}</strong>
      {chip.previousMonth ? " (month before)" : ""}
    </span>
  );
}

function RuleChips({
  rule,
  names,
}: {
  rule: { antecedents: string[]; consequent: string };
  names: VariableNames;
}) {
  const { t } = useI18n();
  return (
    <span className="rule-chips">
      {rule.antecedents.map((item, index) => (
        <span key={item} className="rule-part">
          {index > 0 ? (
            <span className="rule-word">{t("mining.extra.and")}</span>
          ) : null}
          <Chip item={item} names={names} />
        </span>
      ))}
      <span className="rule-part">
        <span className="rule-word" aria-label={t("mining.rules.goesWith")}>
          →
        </span>
        <Chip item={rule.consequent} names={names} />
      </span>
    </span>
  );
}

function RulesSection({ file }: { file: FpGrowthFile }) {
  const { t } = useI18n();
  const [variableId, setVariableId] = useState("all");
  const [tableId, setTableId] = useState("region");
  const [lagged, setLagged] = useState(false);
  const [showPersistence, setShowPersistence] = useState(false);
  const [sort, setSort] = useState<RuleSort>({ key: "lift", descending: true });
  const names = file.variable_names;
  const table = file.tables[tableId];
  if (!table) return null;
  const set = lagged ? table.lagged_one_month : table.same_month;
  const shown = filterRulesByVariable(
    sortRules(visibleRules(set, showPersistence), sort, names),
    variableId,
  );

  return (
    <section id="rules" aria-labelledby="rules-title">
      <h2 id="rules-title">{t("mining.sections.rules")}</h2>
      <p className="asks">
        <strong>{t("mining.label.asks")}</strong> {t("mining.rules.asks")}
      </p>
      <p className="note">
        <strong>{t("mining.label.method")}</strong>{" "}
        {t("mining.rules.method", {
          alpha: formatParameter(file.parameters.rule_alpha ?? null),
        })}
      </p>
      <div className="controls">
        <label>
          {t("mining.control.table")}{" "}
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
          {t("mining.control.timing")}{" "}
          <select
            value={lagged ? "lagged" : "same"}
            onChange={(event) => setLagged(event.target.value === "lagged")}
          >
            <option value="same">{t("mining.control.sameMonth")}</option>
            <option value="lagged">{t("mining.control.lagged")}</option>
          </select>
        </label>
        <label>
          {t("mining.control.variable")}{" "}
          <select
            value={variableId}
            onChange={(event) => setVariableId(event.target.value)}
          >
            <option value="all">{t("mining.control.allVariables")}</option>
            {table.variables.map((id) => (
              <option key={id} value={id}>
                {variableName(id, names[id] ?? id)}
              </option>
            ))}
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
      <div className="scroll tall">
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
                    {t(`mining.rules.column.${column.key}`)}
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
                <td>
                  <RuleChips rule={rule} names={names} />
                </td>
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
      <p className="note">
        Support: share of cases that contain every item of the rule. Confidence:
        share of the cases with the left side that also have the right side.
        Lift: confidence divided by how common the right side is on its own (1 =
        no more often than by chance).
      </p>
      <MethodDetails>
        <p>
          Each detrended monthly anomaly is labelled low, normal or high against
          that series&apos; own quantiles. One location in one month is one
          transaction. The two sides of a rule never use the same variable.
        </p>
        <p>q: {file.significance_note}</p>
        <ExcludedNote
          excluded={table.excluded_variables}
          names={names}
          limit={file.parameters.max_abs_correlation}
        />
        <h3>{t("mining.label.parameters")}</h3>
        <ParameterList parameters={file.parameters} />
      </MethodDetails>
    </section>
  );
}

function TreeSection({ file }: { file: DecisionTreeFile }) {
  const { t } = useI18n();
  const names = file.variable_names;
  const classes = file.target_classes;
  const summary = file.summary;
  const last = file.folds.at(-1);

  return (
    <section id="greenness" aria-labelledby="greenness-title">
      <h2 id="greenness-title">{t("mining.sections.greenness")}</h2>
      <p className="asks">
        <strong>{t("mining.label.asks")}</strong> {t("mining.greenness.asks")}
      </p>
      <p className="note">
        <strong>{t("mining.label.method")}</strong>{" "}
        {t("mining.detail.treeMethod", {
          target: formatFeature(file.target, names),
          table: file.table,
          targetLag: t(
            file.features.includes(`prev:${file.target}`)
              ? "mining.detail.targetLagIncluded"
              : "mining.detail.targetLagExcluded",
          ),
        })}{" "}
        {file.same_quantity_excluded.length
          ? t("mining.detail.sameQuantityExcluded", {
              names: file.same_quantity_excluded
                .map((id) => names[id] ?? id)
                .join(", "),
            })
          : ""}
        {t("mining.detail.validation")}
      </p>
      <p
        className={summary.above_all_in_every_fold ? "verdict" : "verdict warn"}
      >
        {summary.text_en}
      </p>
      <p className="note">
        {t("mining.detail.baselines", {
          folds: summary.n_folds,
          tree: formatShare(summary.mean_test_accuracy),
          training: formatShare(summary.mean_train_majority_accuracy),
          test: formatShare(summary.mean_test_majority_accuracy),
          persistence: formatShare(summary.mean_persistence_accuracy),
        })}
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>{t("mining.extra.fold")}</th>
              <th>{t("mining.extra.training_months")}</th>
              <th>{t("mining.extra.test_months")}</th>
              <th className="number">{t("mining.extra.tree_test")}</th>
              <th className="number">
                {t("mining.extra.training_majority_guess")}
              </th>
              <th className="number">
                {t("mining.extra.test_majority_guess")}
              </th>
              <th className="number">{t("mining.extra.persistence_guess")}</th>
              <th>{t("mining.extra.tree_against_baselines")}</th>
            </tr>
          </thead>
          <tbody>
            {file.folds.map((fold) => (
              <tr key={fold.fold}>
                <td>{fold.fold}</td>
                <td>
                  {t("mining.detail.monthRows", {
                    first: fold.train_first_month.slice(0, 7),
                    last: fold.train_last_month.slice(0, 7),
                    rows: fold.n_train,
                  })}
                </td>
                <td>
                  {t("mining.detail.monthRows", {
                    first: fold.test_first_month.slice(0, 7),
                    last: fold.test_last_month.slice(0, 7),
                    rows: fold.n_test,
                  })}
                </td>
                <td className="number">{formatShare(fold.accuracy.test)}</td>
                <td className="number">
                  {formatShare(fold.baselines.train_majority.test_accuracy)} (
                  {fold.baselines.train_majority.predicted_class}
                  {fold.baselines.train_majority.tie
                    ? t("mining.detail.tied")
                    : ""}
                  )
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
        <dt>{t("mining.extra.rows_used")}</dt>
        <dd>
          {Object.entries(file.rows_by_location)
            .map(
              ([location, rows]) =>
                t("mining.detail.rowsAtLocation", {
                  location,
                  complete: rows.n_complete_rows,
                  total: rows.n_rows,
                }) +
                (rows.missing_variables.length
                  ? t("mining.detail.missingVariables", {
                      names: rows.missing_variables
                        .map((id) => names[id] ?? id)
                        .join(", "),
                    })
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
            {t("mining.detail.foldTree", {
              fold: last.fold,
              first: last.train_first_month.slice(0, 7),
              last: last.train_last_month.slice(0, 7),
            })}
          </h3>
          <pre>{labelTreeText(last.tree_text, names)}</pre>
          <h3>{t("mining.detail.foldConfusion", { fold: last.fold })}</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("mining.extra.actual")}</th>
                  {classes.map((name) => (
                    <th key={name} className="number">
                      {t("mining.detail.predicted", { name })}
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
          <h3>{t("mining.detail.featureImportance", { fold: last.fold })}</h3>
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
      <MethodDetails>
        <h3>{t("mining.label.parameters")}</h3>
        <ParameterList parameters={file.parameters} />
      </MethodDetails>
    </section>
  );
}

// Numbers only: how the results change when gaps are filled or left missing.
function GapFillingSection({ data }: { data: MiningResults }) {
  const { t } = useI18n();
  const rules = data.rules.gap_filling_sensitivity;
  const tree = data.tree.gap_filling_sensitivity;
  if (!rules || !tree) return null;
  const runs = [rules.primary, rules.compared_with];
  const filled = tree.filled;
  const unfilled = tree.unfilled;

  return (
    <section id="gap-filling" aria-labelledby="gap-filling-title">
      <h2 id="gap-filling-title">{t("mining.sections.gapFilling")}</h2>
      <p className="note">
        {data.rules.gap_filling_note}{" "}
        {t("mining.detail.gapFillingNote", { run: rules.primary })}
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>{t("mining.extra.table")}</th>
              <th>{t("mining.extra.timing")}</th>
              <th className="number">{t("mining.detail.monthsFilled")}</th>
              {runs.map((run) => (
                <th key={run} className="number">
                  {t("mining.detail.missingCells", { run })}
                </th>
              ))}
              {runs.map((run) => (
                <th key={run} className="number">
                  {t("mining.detail.rulesRun", { run })}
                </th>
              ))}
              <th className="number">
                {t("mining.extra.listed_rules_in_both")}
              </th>
              <th>{t("mining.extra.top_rules")}</th>
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
                      ? t("mining.detail.topCount", {
                          count: row.comparison.top_rules_compared,
                        })
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
                <th>{t("mining.extra.decision_tree_fold")}</th>
                <th className="number">{t("mining.extra.test_rows_filled")}</th>
                <th className="number">{t("mining.extra.tree_filled")}</th>
                <th className="number">
                  {t("mining.extra.test_rows_unfilled")}
                </th>
                <th className="number">{t("mining.extra.tree_unfilled")}</th>
                <th className="number">
                  {t("mining.extra.training_majority_guess")}
                </th>
                <th className="number">
                  {t("mining.extra.test_majority_guess")}
                </th>
                <th className="number">
                  {t("mining.extra.persistence_guess")}
                </th>
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
          {t("mining.detail.gapFillingResults", {
            filledAbove: filled.summary.n_folds_above_all,
            filledTotal: filled.folds.length,
            unfilledAbove: unfilled.summary.n_folds_above_all,
            unfilledTotal: unfilled.folds.length,
            filledRows: filled.n_complete_rows,
            unfilledRows: unfilled.n_complete_rows,
          })}
        </p>
      ) : null}
    </section>
  );
}

// Numbers only: how the results change when series with verified step months
// are cut at those months before detrending.
function SegmentationSection({ data }: { data: MiningResults }) {
  const { t } = useI18n();
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
    <section id="segmentation" aria-labelledby="segmentation-title">
      <h2 id="segmentation-title">{t("mining.sections.segmentation")}</h2>
      <p className="note">
        {rules.note}{" "}
        {t("mining.detail.segmentedSeries", {
          series: stepped.length ? stepped.join("; ") : t("mining.format.none"),
        })}
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>{t("mining.extra.table")}</th>
              <th>{t("mining.extra.timing")}</th>
              {runs.map((run) => (
                <th key={run} className="number">
                  {t("mining.detail.rulesRun", { run })}
                </th>
              ))}
              <th className="number">
                {t("mining.extra.listed_rules_in_both")}
              </th>
              <th>{t("mining.extra.top_rules")}</th>
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
                    ? t("mining.detail.topCount", {
                        count: row.comparison.top_rules_compared,
                      })
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {primary && other ? (
        <p className="note">
          {t("mining.detail.segmentationResults", {
            unsegmented: primary.folds
              .map((fold) => formatShare(fold.test_accuracy))
              .join(", "),
            segmented: other.folds
              .map((fold) => formatShare(fold.test_accuracy))
              .join(", "),
            unsegmentedAbove: primary.summary.n_folds_above_all,
            unsegmentedTotal: primary.folds.length,
            segmentedAbove: other.summary.n_folds_above_all,
            segmentedTotal: other.folds.length,
          })}
        </p>
      ) : null}
    </section>
  );
}

// `label` is the message key under mining.sections.
const SECTIONS = [
  { id: "rules", label: "rules" },
  { id: "network", label: "network" },
  { id: "similar", label: "similar" },
  { id: "gap", label: "gap" },
  { id: "greenness", label: "greenness" },
  { id: "gap-filling", label: "sensitivity" },
];

// Every id a link's fragment may name: the sections of the list above and
// the second sensitivity check.
const SECTION_IDS = [...SECTIONS.map((section) => section.id), "segmentation"];

function Loaded<T>({
  state,
  what,
  children,
}: {
  state: ReturnType<typeof useAnalysisFile<T>>;
  what: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (state.status === "loading")
    return <p className="note">{t("mining.load.loadingPart", { what })}</p>;
  if (state.status === "error") {
    return <p className="note">{t("mining.load.errorPart", { what })}</p>;
  }
  return <>{children(state.data)}</>;
}

function Scope({
  data,
  graph,
  similar,
  gap,
}: {
  data: MiningResults;
  graph: VariableGraphFile | null;
  similar: SimilarSeriesFile | null;
  gap: GapTreeFile | null;
}) {
  const point = data.rules.tables.point;
  const region = data.rules.tables.region;
  return (
    <dl className="scope">
      <dt>{t("mining.extra.association_rules_greenness_tree")}</dt>
      <dd>
        {t("mining.detail.scopeRules", {
          points: point?.locations.length ?? 0,
          pointVariables: point?.variables.length ?? 0,
          pointFirst: point?.first_month?.slice(0, 7) ?? "",
          pointLast: point?.last_month?.slice(0, 7) ?? "",
          pointMonths: point?.same_month.n_transactions ?? 0,
          regions: region?.locations.length ?? 0,
          regionVariables: region?.variables.length ?? 0,
          regionFirst: region?.first_month?.slice(0, 7) ?? "",
          regionLast: region?.last_month?.slice(0, 7) ?? "",
          regionMonths: region?.same_month.n_transactions ?? 0,
        })}
      </dd>
      {graph ? (
        <>
          <dt>{t("mining.extra.variable_network")}</dt>
          <dd>
            {t("mining.detail.scopeNetwork", {
              points: graph.tables.point?.nodes.length ?? 0,
              regions: graph.tables.region?.nodes.length ?? 0,
            })}{" "}
            {graph.world_cities
              ? t("mining.detail.scopeCities", {
                  cities: graph.world_cities.cities.length,
                  variables: graph.world_cities.variables.length,
                })
              : ""}
          </dd>
        </>
      ) : null}
      {similar ? (
        <>
          <dt>{t("mining.extra.similar_series")}</dt>
          <dd>
            {t("mining.detail.scopeSimilar", {
              series: similar.summary.n_series,
              taiwan: similar.summary.n_series_by_group.taiwan ?? 0,
              cities: similar.summary.n_series_by_group.world_city ?? 0,
              global: similar.summary.n_series_by_group.global ?? 0,
              first: similar.window.first_month.slice(0, 7),
              last: similar.window.last_month.slice(0, 7),
              months: similar.window.n_months,
            })}
          </dd>
        </>
      ) : null}
      {gap ? (
        <>
          <dt>{t("mining.extra.models_and_observations")}</dt>
          <dd>
            {t("mining.detail.scopeGap", {
              pairs: gap.pairs.length,
              stations: new Set(gap.pairs.map((pair) => pair.station)).size,
              months: gap.pairs.reduce((sum, pair) => sum + pair.n_months, 0),
              rows: gap.variants[gap.primary_variant]?.n_rows ?? 0,
            })}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

export function MiningPage() {
  const { t, tm, locale } = useI18n();
  const state = useAnalysisFile(loadMining);
  const graph = useAnalysisFile(loadVariableGraph);
  const similar = useAnalysisFile(loadSimilarSeries);
  const gap = useAnalysisFile(loadGapTree);

  // A link such as mining/?place=tokyo&variable=imerg_precip#similar: the
  // sections exist only after the result files are read, so the browser has
  // nothing to scroll to when the page opens. Scroll once they are all in.
  const settled = [state, graph, similar, gap].every(
    (item) => item.status !== "loading",
  );
  useEffect(() => {
    if (!settled) return;
    const id = sectionFromHash(window.location.hash, SECTION_IDS);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [settled]);

  return (
    <main className="mining">
      <p className="page-bar">
        <a href={carryChoices(import.meta.env.BASE_URL)}>{t("mining.back")}</a>
        <LanguageMenu />
        <ModeSwitch />
      </p>
      {locale === "en" ? null : (
        <p className="note page-partial">{t("common.partial")}</p>
      )}
      <h1>
        {t("mining.title")} <span className="tag">{t("mining.tag")}</span>
      </h1>
      <p className="lead">
        {tm("mining.lead")} <strong>{t("mining.leadWarning")}</strong>
      </p>
      <nav className="toc" aria-label={t("mining.tocLabel")}>
        <ul>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>
                {t(`mining.sections.${section.label}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {state.status === "loading" ? <p>{t("common.status.loading")}</p> : null}
      {state.status === "error" ? <p>{t("mining.load.error")}</p> : null}
      {state.status === "ready" ? (
        <>
          <h2 className="scope-title">{t("mining.label.dataUsed")}</h2>
          <Scope
            data={state.data}
            graph={graph.status === "ready" ? graph.data : null}
            similar={similar.status === "ready" ? similar.data : null}
            gap={gap.status === "ready" ? gap.data : null}
          />
          <p className="note">
            Parameters were fixed before each run and are listed under
            &quot;Method details&quot;; they are adjustable defaults, not
            conclusions. Input: monthly anomalies from the snapshot of{" "}
            {state.data.rules.input.snapshot_generated_at.slice(0, 10)}.{" "}
            {state.data.rules.detrending_note} Locations left out:{" "}
            {formatParameter(
              state.data.rules.parameters.exclude_locations ?? null,
            )}{" "}
            (the taiwan box overlaps the other four regions, so the same
            observation would be counted twice).
          </p>
          <RulesSection file={state.data.rules} />
        </>
      ) : null}
      <Loaded state={graph} what={t("mining.load.network")}>
        {(data) => <NetworkSection file={data} />}
      </Loaded>
      <Loaded state={similar} what={t("mining.load.similar")}>
        {(data) => <SimilarSection file={data} />}
      </Loaded>
      <Loaded state={gap} what={t("mining.load.gap")}>
        {(data) => <GapSection file={data} />}
      </Loaded>
      {state.status === "ready" ? (
        <>
          <TreeSection file={state.data.tree} />
          <GapFillingSection data={state.data} />
          <SegmentationSection data={state.data} />
        </>
      ) : null}
    </main>
  );
}
