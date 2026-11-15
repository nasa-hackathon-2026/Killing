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
import { carryChoices, t, useI18n } from "../i18n";
import { MethodDetails } from "./parts";

// Labels are messages: mining.gap.grouping.<id>.
const GROUPINGS = [
  { id: "by_product_season" },
  { id: "by_product_segment" },
  { id: "by_product_station" },
  { id: "by_product" },
];

function GapBars({ file, grouping }: { file: GapTreeFile; grouping: string }) {
  const rows: GapStat[] = file.descriptive[grouping] ?? [];
  const scale = barScale(rows) || 1;
  const percent = (value: number) => `${((value / scale) * 100).toFixed(1)}%`;
  return (
    <div className="scroll">
      <table className="gap-bars">
        <thead>
          <tr>
            <th>{t("mining.extra.model")}</th>
            <th>{t("mining.extra.group")}</th>
            <th className="bar-cell">
              {t("mining.extra.mean_absolute_difference_c_with_95_interval")}
            </th>
            <th className="number">{t("mining.extra.mean")}</th>
            <th className="number">{t("mining.extra.95_interval")}</th>
            <th className="number">{t("mining.extra.months")}</th>
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
                    ? t("mining.gap.detail.range", {
                        first: low.toFixed(2),
                        last: high.toFixed(2),
                      })
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
    return t("mining.gap.detail.heldOut", {
      station: stationName(file, fold.held_out_station),
    });
  }
  return t("mining.gap.detail.range", {
    first: fold.test_first_month?.slice(0, 7) ?? "",
    last: fold.test_last_month?.slice(0, 7) ?? "",
  });
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
            <th className="number">{t("mining.extra.training_rows")}</th>
            <th className="number">{t("mining.extra.test_rows")}</th>
            <th className="number">{t("mining.extra.tree_test_accuracy")}</th>
            <th className="number">{t("mining.extra.tree_macro_f1")}</th>
            <th className="number">
              {t("mining.extra.training_majority_guess")}
            </th>
            <th className="number">{t("mining.extra.persistence_guess")}</th>
            <th className="number">{t("mining.extra.calendar_month_guess")}</th>
            <th>{t("mining.extra.tree_against_baselines")}</th>
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
            <td>{t("mining.extra.mean")}</td>
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
              {t("mining.gap.detail.aboveFolds", {
                count: validation.summary.n_folds_above_all,
                total: validation.summary.n_folds,
              })}
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
            <th>{t("mining.extra.feature")}</th>
            <th className="number">{t("mining.extra.mean_importance")}</th>
            <th className="number">{t("mining.extra.lowest")}</th>
            <th className="number">{t("mining.extra.highest")}</th>
            <th className="number">{t("mining.extra.used_in")}</th>
            <th className="number">{t("mining.extra.ranked_first_in")}</th>
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
                {t("mining.gap.detail.of", {
                  count: item.n_folds_used,
                  total: validation.summary.n_folds,
                })}
              </td>
              <td className="number">
                {t("mining.gap.detail.of", {
                  count: item.n_folds_top,
                  total: validation.summary.n_folds,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GapSection({ file }: { file: GapTreeFile }) {
  const { t } = useI18n();
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
      <h2 id="gap-title">{t("mining.sections.gap")}</h2>
      <p className="asks">
        <strong>{t("mining.label.asks")}</strong> {t("mining.gap.asks")}
      </p>
      <p className="note">
        <strong>{t("mining.label.method")}</strong>{" "}
        {t("mining.gap.method", {
          pairs: file.pairs.length,
          stations: stations.length,
          months: totalMonths,
          note: file.note,
        })}{" "}
        <a href={carryChoices(`${import.meta.env.BASE_URL}compare/`)}>
          {t("mining.gap.compareLink")}
        </a>
      </p>

      <h3>{t("mining.gap.meansTitle")}</h3>
      <div className="controls">
        <label>
          {t("mining.control.groupBy")}{" "}
          <select
            value={grouping}
            onChange={(event) => setGrouping(event.target.value)}
          >
            {GROUPINGS.map((item) => (
              <option key={item.id} value={item.id}>
                {t(`mining.gap.grouping.${item.id}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GapBars file={file} grouping={grouping} />
      <p className="note">
        {t("mining.gap.detail.barNote", {
          months: file.gldas_break_months
            .map((month) => month.slice(0, 7))
            .join(", "),
        })}
      </p>

      <h3>{t("mining.gap.treeTitle")}</h3>
      <p
        className={
          walk.summary.n_folds_above_all === walk.summary.n_folds
            ? "verdict"
            : "verdict warn"
        }
      >
        <strong>{t("mining.extra.forward_in_time")}</strong>{" "}
        {walk.summary.text_en}
      </p>
      <p
        className={
          held.summary.n_folds_above_all === held.summary.n_folds
            ? "verdict"
            : "verdict warn"
        }
      >
        <strong>{t("mining.extra.new_station")}</strong> {held.summary.text_en}
      </p>
      <div className="controls">
        <label>
          {t("mining.control.run")}{" "}
          <select
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
          >
            {file.variants_run.map((id) => (
              <option key={id} value={id}>
                {t(`mining.gap.variants.${id}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="note">
          {t("mining.gap.detail.runRange", {
            rows: variant.n_rows,
            first: variant.first_month.slice(0, 7),
            last: variant.last_month.slice(0, 7),
          })}
        </span>
      </div>
      <p className="note">
        {t("mining.gap.detail.runsNote", { count: file.variants_run.length })}{" "}
        {variant.note}
      </p>

      <h4>
        {t(
          "mining.extra.forward_in_time_train_on_earlier_months_test_on_later_months",
        )}
      </h4>
      <FoldTable
        file={file}
        validation={walk}
        firstColumn={t("mining.extra.test_months")}
      />
      <h4>{t("mining.gap.detail.newStationTitle")}</h4>
      <FoldTable
        file={file}
        validation={held}
        firstColumn={t("mining.gap.detail.station")}
      />
      <p className="note">{t("mining.gap.detail.accuracyNote")}</p>

      {last ? (
        <>
          <h4>
            {t("mining.gap.detail.lastTree", {
              first: last.train_first_month?.slice(0, 7) ?? "",
              last: last.train_last_month?.slice(0, 7) ?? "",
            })}
          </h4>
          <pre>{labelGapTreeText(file, last.tree_text)}</pre>
          <p className="note">{t("mining.gap.detail.treeNote")}</p>
          <h4>{t("mining.gap.detail.confusionTitle")}</h4>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("mining.extra.actual")}</th>
                  {file.classes.map((name) => (
                    <th key={name} className="number">
                      {t("mining.gap.detail.predicted", { name })}
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

      <h4>
        {t(
          "mining.extra.which_features_the_trees_use_fold_by_fold_forward_in_time",
        )}
      </h4>
      <Stability file={file} validation={walk} />
      <h4>{t("mining.extra.which_features_the_trees_use_new_station")}</h4>
      <Stability file={file} validation={held} />

      <MethodDetails>
        <dl>
          {Object.entries(file.methods).map(([name, text]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
          <dt>{t("mining.extra.leakage_guards")}</dt>
          <dd>{file.leakage_guards.join("; ")}.</dd>
          <dt>{t("mining.extra.context_variables")}</dt>
          <dd>
            {file.context_variables
              .map((id) => file.variable_names[id] ?? id)
              .join(", ")}{" "}
            {t("mining.gap.detail.nearestPoint")} (
            {[
              ...new Set(
                file.pairs.map(
                  (pair) =>
                    `${stationName(file, pair.station)}: ${pair.context_point}, ${pair.context_distance_km} km`,
                ),
              ),
            ].join("; ")}
            ). {t("mining.gap.detail.notUsedTemperature")}{" "}
            {file.excluded_temperature_variables.join(", ")}.
          </dd>
          <dt>{t("mining.extra.rows_left_out")}</dt>
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
