"""資料探勘（#55，探索性）：月距平的 FP-growth 關聯規則與決策樹。

    uv run python -m trend_detective.trends   # 先有月距平
    uv run python -m trend_detective.mining

輸入是 `data/analysis/anomalies.json` 與 `trends.json`（由 `trend_detective.trends` 產生），
輸出到同一個目錄（不連網）：

- `fpgrowth.json`、`fpgrowth.run.json`：頻繁項目集與關聯規則（同月份，以及延遲一個月）。
- `decision_tree.json`、`decision_tree.run.json`：決策樹的結構、特徵重要度與按時間切的驗證。

這些結果是探索性的（結果檔標 `exploratory: true`）：沒有顯著性檢定，不取代
`trends.json`，也不代表因果。方法與預設參數是隊伍指定的，數字怎麼解讀留給隊伍。

做法：

1. 寬表：一列是「地點 × 月份」，一欄是一個變數的月距平。點位一張（`aggregation = "point"`）、
   區域一張（`area_mean`）。期間取「表內所有序列都有資料」的共同起訖月。趨勢統計標記為資料
   不足的序列、`exclude_variables` 列出的變數不放進表。
2. 狀態：每條序列用自己在共同期間的分位數（預設三分位）把距平分成 low／normal／high。
3. FP-growth：每一列是一筆交易，項目是 `變數=狀態`；缺的格子就沒有那個項目（支持度的分母仍是
   全部交易）。規則只取單一後項，指標是支持度、信賴度、lift。延遲版的交易是「前一個月的狀態
   （`prev:變數=狀態`）加這個月的狀態」，只留前項全在前一個月、後項在這個月的規則。
4. 決策樹：目標是某個變數的狀態，特徵是同一列其他變數的距平（連續值）。只用特徵與目標都齊的
   列。按月份切：前段訓練、後段測試；目標的分位數門檻只用訓練期間算，再套到測試期間。和
   「永遠猜訓練期間最多的那一類」的基準比較。

資料沒變時重跑，結果檔逐位元組相同（時間戳只在執行紀錄）。
"""

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from mlxtend.frequent_patterns import fpgrowth
from sklearn.tree import DecisionTreeClassifier

from trend_detective.trends import ANALYSIS_DIR, _dump, _round, index_month, month_index

SCHEMA_VERSION = 1
PACKAGES = ("numpy", "pandas", "mlxtend", "scikit-learn")
STATES = ("low", "normal", "high")
TABLE_AGGREGATION = {"point": "point", "region": "area_mean"}
NOTE = (
    "Exploratory data mining on monthly anomalies. It has no significance test, "
    "does not replace the trend statistics, and does not show cause and effect."
)

Transaction = frozenset[str]


@dataclass(frozen=True)
class MiningParams:
    """可調的參數；預設值只是起點，會寫進結果檔。"""

    # 距平低於／高於序列自己的這兩個分位數，分別是 low／high；中間是 normal
    low_quantile: float = 1 / 3
    high_quantile: float = 2 / 3
    # 不放進寬表的變數。預設排除兩個與其他變數幾乎重複的：power_t2m 與 merra2_t2m 同源；
    # modis_ndvi_pc 與 modis_ndvi 是同一顆衛星的 NDVI。不排除的話規則會被它們佔滿。
    exclude_variables: tuple[str, ...] = ("power_t2m", "modis_ndvi_pc")
    # FP-growth
    min_support: float = 0.1
    min_confidence: float = 0.6
    min_lift: float = 1.2
    max_itemset_size: int = 3
    # 結果檔最多列幾條規則／幾個項目集（依 lift／支持度排序；總數另外記）
    max_rules: int = 200
    max_itemsets: int = 200
    # 決策樹
    tree_table: str = "region"
    tree_target: str = "modis_ndvi"
    tree_max_depth: int = 3
    tree_min_samples_leaf: int = 20
    tree_train_fraction: float = 0.8
    tree_random_state: int = 0


@dataclass(frozen=True)
class WideTable:
    """`values[地點][變數]` 是共同期間內逐月的距平（NaN 是缺）；月份由 `first_index` 起連續。"""

    kind: str
    first_index: int
    n_months: int
    locations: list[str]
    variables: list[str]
    values: dict[str, dict[str, np.ndarray]]
    dropped_series: list[dict[str, str]]

    @property
    def months(self) -> list[str]:
        return [index_month(self.first_index + i) for i in range(self.n_months)]


def build_table(
    anomalies: dict[str, Any],
    trends: dict[str, Any] | None,
    kind: str,
    params: MiningParams,
) -> WideTable:
    """從月距平組「地點 × 月份」寬表，期間是表內所有序列共同有資料的起訖月。"""
    aggregation = TABLE_AGGREGATION[kind]
    kept: dict[tuple[str, str], tuple[int, np.ndarray]] = {}
    dropped: list[dict[str, str]] = []
    for key in sorted(anomalies["series"]):
        series = anomalies["series"][key]
        if series["aggregation"] != aggregation:
            continue
        variable, location = series["variable_id"], series["location_id"]
        if variable in params.exclude_variables:
            continue
        status = (trends or {}).get("series", {}).get(key, {}).get("status", "analyzed")
        if status != "analyzed":
            dropped.append(
                {"variable_id": variable, "location_id": location, "reason": status}
            )
            continue
        values = np.array(
            [np.nan if v is None else v for v in series["values"]], dtype=float
        )
        kept[(location, variable)] = (month_index(series["first_month"]), values)
    if not kept:
        return WideTable(kind, 0, 0, [], [], {}, dropped)
    first = max(start for start, _ in kept.values())
    last = min(start + len(values) - 1 for start, values in kept.values())
    n_months = max(0, last - first + 1)
    locations = sorted({location for location, _ in kept})
    variables = sorted({variable for _, variable in kept})
    table: dict[str, dict[str, np.ndarray]] = {location: {} for location in locations}
    for (location, variable), (start, values) in kept.items():
        table[location][variable] = values[first - start : first - start + n_months]
    return WideTable(kind, first, n_months, locations, variables, table, dropped)


def thresholds(values: np.ndarray, params: MiningParams) -> tuple[float, float]:
    """序列自己的兩個分位數門檻（忽略 NaN）。"""
    valid = values[~np.isnan(values)]
    low, high = np.quantile(valid, [params.low_quantile, params.high_quantile])
    return float(low), float(high)


def discretize(values: np.ndarray, low: float, high: float) -> list[str | None]:
    """低於 `low` 是 low、高於 `high` 是 high、其餘 normal；NaN 是 None。"""
    states: list[str | None] = []
    for value in values:
        if np.isnan(value):
            states.append(None)
        elif value < low:
            states.append("low")
        elif value > high:
            states.append("high")
        else:
            states.append("normal")
    return states


def state_table(
    table: WideTable, params: MiningParams
) -> dict[str, dict[str, list[str | None]]]:
    return {
        location: {
            variable: discretize(values, *thresholds(values, params))
            for variable, values in by_variable.items()
        }
        for location, by_variable in table.values.items()
    }


def same_month_transactions(
    states: dict[str, dict[str, list[str | None]]], n_months: int
) -> list[Transaction]:
    """每個地點 × 月份一筆交易；項目是 `變數=狀態`。"""
    transactions = []
    for location in sorted(states):
        for i in range(n_months):
            items = {
                f"{variable}={series[i]}"
                for variable, series in states[location].items()
                if series[i] is not None
            }
            transactions.append(frozenset(items))
    return transactions


def lagged_transactions(
    states: dict[str, dict[str, list[str | None]]], n_months: int
) -> list[Transaction]:
    """每個地點 × 月份（第一個月除外）一筆：前一個月的 `prev:變數=狀態` 加這個月的狀態。"""
    transactions = []
    for location in sorted(states):
        for i in range(1, n_months):
            items = set()
            for variable, series in states[location].items():
                if series[i - 1] is not None:
                    items.add(f"prev:{variable}={series[i - 1]}")
                if series[i] is not None:
                    items.add(f"{variable}={series[i]}")
            transactions.append(frozenset(items))
    return transactions


def frequent_itemsets(
    transactions: list[Transaction], params: MiningParams
) -> dict[Transaction, float]:
    """FP-growth（mlxtend）：項目集 → 支持度（含該項目集的交易數 ÷ 全部交易數）。"""
    items = sorted(set().union(*transactions)) if transactions else []
    if not items:
        return {}
    onehot = pd.DataFrame(
        [[item in transaction for item in items] for transaction in transactions],
        columns=items,
        dtype=bool,
    )
    found = fpgrowth(
        onehot,
        min_support=params.min_support,
        use_colnames=True,
        max_len=params.max_itemset_size,
    )
    return {
        frozenset(itemset): float(support)
        for itemset, support in zip(found["itemsets"], found["support"], strict=True)
    }


def variable_of(item: str) -> str:
    return item.removeprefix("prev:").split("=")[0]


def association_rules(
    itemsets: dict[Transaction, float],
    params: MiningParams,
    *,
    lagged: bool = False,
) -> list[dict[str, Any]]:
    """單一後項的規則：信賴度 = 支持度(前項 ∪ 後項) ÷ 支持度(前項)，lift = 信賴度 ÷ 支持度(後項)。

    `lagged` 時只留「前項全是 prev:、後項不是 prev:」的規則。
    """
    rules = []
    for itemset, support in itemsets.items():
        if len(itemset) < 2:
            continue
        for consequent in itemset:
            antecedent = itemset - {consequent}
            if lagged and (
                consequent.startswith("prev:")
                or not all(item.startswith("prev:") for item in antecedent)
            ):
                continue
            antecedent_support = itemsets[antecedent]
            consequent_support = itemsets[frozenset({consequent})]
            confidence = support / antecedent_support
            lift = confidence / consequent_support
            if confidence < params.min_confidence or lift < params.min_lift:
                continue
            rules.append(
                {
                    "antecedents": sorted(antecedent),
                    "consequent": consequent,
                    "support": support,
                    "confidence": confidence,
                    "lift": lift,
                    "antecedent_support": antecedent_support,
                    "consequent_support": consequent_support,
                    # 後項的變數也出現在前項（延遲版就是同一個變數的持續性）
                    "same_variable": variable_of(consequent)
                    in {variable_of(item) for item in antecedent},
                }
            )
    rules.sort(
        key=lambda rule: (
            -rule["lift"],
            -rule["confidence"],
            rule["antecedents"],
            rule["consequent"],
        )
    )
    return rules


def mine(
    transactions: list[Transaction], params: MiningParams, *, lagged: bool = False
) -> dict[str, Any]:
    itemsets = frequent_itemsets(transactions, params)
    rules = association_rules(itemsets, params, lagged=lagged)
    multi = sorted(
        ((sorted(itemset), support) for itemset, support in itemsets.items()),
        key=lambda pair: (-pair[1], pair[0]),
    )
    return {
        "n_transactions": len(transactions),
        "n_frequent_itemsets": len(itemsets),
        "frequent_itemsets": [
            {"items": items, "support": support}
            for items, support in multi[: params.max_itemsets]
        ],
        "n_rules": len(rules),
        "rules": rules[: params.max_rules],
    }


def describe_table(table: WideTable) -> dict[str, Any]:
    cells = sum(len(by_variable) for by_variable in table.values.values())
    missing = sum(
        int(np.isnan(values).sum())
        for by_variable in table.values.values()
        for values in by_variable.values()
    )
    months = table.months
    return {
        "locations": table.locations,
        "variables": table.variables,
        "variables_by_location": {
            location: sorted(table.values[location]) for location in table.locations
        },
        "first_month": months[0] if months else None,
        "last_month": months[-1] if months else None,
        "n_months": table.n_months,
        "n_cells": cells * table.n_months,
        "n_missing_cells": missing,
        "dropped_series": table.dropped_series,
    }


def run_fpgrowth(
    anomalies: dict[str, Any], trends: dict[str, Any] | None, params: MiningParams
) -> dict[str, Any]:
    tables = {}
    for kind in TABLE_AGGREGATION:
        table = build_table(anomalies, trends, kind, params)
        states = state_table(table, params)
        tables[kind] = {
            **describe_table(table),
            "same_month": mine(same_month_transactions(states, table.n_months), params),
            "lagged_one_month": mine(
                lagged_transactions(states, table.n_months), params, lagged=True
            ),
        }
    return {"tables": tables}


def time_split(months: list[int], train_fraction: float) -> int:
    """回傳切點月序：小於它的月份訓練，其餘測試。依「不重複的月份」切，不是依列數。"""
    unique = sorted(set(months))
    n_train = int(len(unique) * train_fraction)
    if n_train < 1 or n_train >= len(unique):
        raise ValueError("月份太少，切不出訓練與測試兩段")
    return unique[n_train]


def majority_baseline(
    train_labels: list[str], test_labels: list[str]
) -> dict[str, Any]:
    """永遠猜訓練期間最多的那一類（同數時取 STATES 順序在前的，並標 `tie`）。

    `best_constant_on_test` 是事後才知道的對照：測試期間最多的那一類所佔的比例。
    訓練與測試期間的類別分布不同時（例如序列有趨勢），它會比訓練期間的基準高很多。
    """
    counts = {state: train_labels.count(state) for state in STATES}
    majority = max(STATES, key=lambda state: counts[state])
    test_counts = {state: test_labels.count(state) for state in STATES}
    best = max(STATES, key=lambda state: test_counts[state])
    return {
        "predicted_class": majority,
        "tie": list(counts.values()).count(counts[majority]) > 1,
        "train_accuracy": counts[majority] / len(train_labels),
        "test_accuracy": test_counts[majority] / len(test_labels),
        "best_constant_on_test": {
            "predicted_class": best,
            "test_accuracy": test_counts[best] / len(test_labels),
        },
    }


def tree_text(node: dict[str, Any], depth: int = 0) -> str:
    """把 `_tree_nodes` 的結構排成縮排文字；門檻用 4 位有效數字。"""
    pad = "  " * depth
    if "feature" not in node:
        counts = ", ".join(f"{k} {v}" for k, v in node["class_counts"].items())
        return (
            f"{pad}-> {node['predicted_class']} (n = {node['n_samples']}: {counts})\n"
        )
    test = f"{node['feature']} <= {node['threshold']:.4g}"
    return (
        f"{pad}if {test}:\n{tree_text(node['left'], depth + 1)}"
        f"{pad}else:\n{tree_text(node['right'], depth + 1)}"
    )


def _tree_nodes(model: DecisionTreeClassifier, features: list[str]) -> dict[str, Any]:
    tree = model.tree_
    classes = [str(label) for label in model.classes_]

    def node(i: int) -> dict[str, Any]:
        # sklearn 的 value 是各類別的比例；乘上樣本數還原成筆數
        counts = np.rint(tree.value[i][0] * tree.n_node_samples[i]).astype(int)
        out: dict[str, Any] = {
            "n_samples": int(tree.n_node_samples[i]),
            "class_counts": dict(zip(classes, counts.tolist(), strict=True)),
            "predicted_class": classes[int(np.argmax(tree.value[i][0]))],
        }
        if tree.children_left[i] != -1:
            out["feature"] = features[int(tree.feature[i])]
            out["threshold"] = float(tree.threshold[i])
            # 左：feature <= threshold；右：feature > threshold
            out["left"] = node(int(tree.children_left[i]))
            out["right"] = node(int(tree.children_right[i]))
        return out

    return node(0)


def run_decision_tree(
    anomalies: dict[str, Any], trends: dict[str, Any] | None, params: MiningParams
) -> dict[str, Any]:
    table = build_table(anomalies, trends, params.tree_table, params)
    target = params.tree_target
    if target not in table.variables:
        raise ValueError(f"目標變數 {target} 不在 {params.tree_table} 寬表裡")
    features = [variable for variable in table.variables if variable != target]
    rows: list[tuple[str, int, list[float], float]] = []
    rows_by_location = {}
    for location in table.locations:
        by_variable = table.values[location]
        complete = 0
        if all(variable in by_variable for variable in [target, *features]):
            for i in range(table.n_months):
                x = [float(by_variable[variable][i]) for variable in features]
                y = float(by_variable[target][i])
                if not np.isnan(y) and not np.isnan(x).any():
                    rows.append((location, table.first_index + i, x, y))
                    complete += 1
        rows_by_location[location] = {
            "n_rows": table.n_months,
            "n_complete_rows": complete,
            "missing_variables": sorted({target, *features} - set(by_variable)),
        }
    split = time_split([row[1] for row in rows], params.tree_train_fraction)
    # 目標的門檻：每個地點各自、只用訓練期間的值
    cut = {}
    for location in {row[0] for row in rows}:
        train_values = np.array(
            [r[3] for r in rows if r[0] == location and r[1] < split]
        )
        cut[location] = thresholds(train_values, params)
    labels = [
        discretize(np.array([row[3]]), *cut[row[0]])[0] or "normal" for row in rows
    ]
    is_train = [row[1] < split for row in rows]
    x_train = np.array(
        [row[2] for row, train in zip(rows, is_train, strict=True) if train]
    )
    x_test = np.array(
        [row[2] for row, train in zip(rows, is_train, strict=True) if not train]
    )
    y_train = [label for label, train in zip(labels, is_train, strict=True) if train]
    y_test = [label for label, train in zip(labels, is_train, strict=True) if not train]
    model = DecisionTreeClassifier(
        max_depth=params.tree_max_depth,
        min_samples_leaf=params.tree_min_samples_leaf,
        random_state=params.tree_random_state,
    )
    model.fit(x_train, y_train)
    predicted = [str(label) for label in model.predict(x_test)]
    confusion = {
        actual: {
            guess: sum(
                1
                for a, g in zip(y_test, predicted, strict=True)
                if (a, g) == (actual, guess)
            )
            for guess in STATES
        }
        for actual in STATES
    }
    train_months = sorted({row[1] for row in rows if row[1] < split})
    test_months = sorted({row[1] for row in rows if row[1] >= split})
    importances = sorted(
        zip(features, (float(v) for v in model.feature_importances_), strict=True),
        key=lambda pair: (-pair[1], pair[0]),
    )
    nodes = _tree_nodes(model, features)
    return {
        "table": params.tree_table,
        "target": target,
        "target_classes": list(STATES),
        "features": features,
        "rows_by_location": rows_by_location,
        "dropped_series": table.dropped_series,
        "split": {
            "method": "by month: earlier months train, later months test",
            "train_first_month": index_month(train_months[0]),
            "train_last_month": index_month(train_months[-1]),
            "test_first_month": index_month(test_months[0]),
            "test_last_month": index_month(test_months[-1]),
            "n_train_months": len(train_months),
            "n_test_months": len(test_months),
            "n_train": len(y_train),
            "n_test": len(y_test),
        },
        "target_thresholds": {
            location: {"low": cut[location][0], "high": cut[location][1]}
            for location in sorted(cut)
        },
        "class_counts": {
            "train": {state: y_train.count(state) for state in STATES},
            "test": {state: y_test.count(state) for state in STATES},
        },
        "accuracy": {
            "train": float(model.score(x_train, y_train)),
            "test": float(model.score(x_test, y_test)),
        },
        "baseline_majority_class": majority_baseline(y_train, y_test),
        "confusion_matrix_test": confusion,
        "feature_importances": [
            {"feature": feature, "importance": importance}
            for feature, importance in importances
        ],
        "tree": nodes,
        "tree_text": tree_text(nodes),
    }


FPGROWTH_PARAMS = (
    "low_quantile",
    "high_quantile",
    "exclude_variables",
    "min_support",
    "min_confidence",
    "min_lift",
    "max_itemset_size",
    "max_rules",
    "max_itemsets",
)
TREE_PARAMS = (
    "low_quantile",
    "high_quantile",
    "exclude_variables",
    "tree_table",
    "tree_target",
    "tree_max_depth",
    "tree_min_samples_leaf",
    "tree_train_fraction",
    "tree_random_state",
)


def _header(
    anomalies: dict[str, Any], params: MiningParams, names: tuple[str, ...]
) -> dict[str, Any]:
    everything = asdict(params)
    return {
        "schema_version": SCHEMA_VERSION,
        "exploratory": True,
        "note": NOTE,
        "input": {
            "anomalies": "data/analysis/anomalies.json",
            "snapshot_generated_at": anomalies["input"]["snapshot_generated_at"],
            "trend_parameters": anomalies["parameters"],
        },
        "parameters": {name: everything[name] for name in names},
        "packages": {name: version(name) for name in PACKAGES},
    }


def run(
    anomalies: dict[str, Any], trends: dict[str, Any] | None, params: MiningParams
) -> tuple[dict[str, Any], dict[str, Any]]:
    """回傳 (fpgrowth, decision_tree) 兩個要寫出的結構。"""
    rules = {
        **_header(anomalies, params, FPGROWTH_PARAMS),
        **run_fpgrowth(anomalies, trends, params),
    }
    tree = {
        **_header(anomalies, params, TREE_PARAMS),
        **run_decision_tree(anomalies, trends, params),
    }
    return _round(rules), _round(tree)


def write_outputs(
    analysis_dir: Path,
    rules: dict[str, Any],
    tree: dict[str, Any],
    *,
    generated_at: str,
) -> None:
    command = "uv run python -m trend_detective.mining"
    for name, result, summary in (
        (
            "fpgrowth",
            rules,
            {
                kind: {
                    "n_transactions": table["same_month"]["n_transactions"],
                    "n_rules_same_month": table["same_month"]["n_rules"],
                    "n_rules_lagged_one_month": table["lagged_one_month"]["n_rules"],
                }
                for kind, table in rules["tables"].items()
            },
        ),
        (
            "decision_tree",
            tree,
            {
                "n_train": tree["split"]["n_train"],
                "n_test": tree["split"]["n_test"],
                "accuracy": tree["accuracy"],
                "baseline_majority_class": tree["baseline_majority_class"],
            },
        ),
    ):
        _dump(analysis_dir / f"{name}.json", result)
        _dump(
            analysis_dir / f"{name}.run.json",
            {
                "command": command,
                "generated_at": generated_at,
                "exploratory": True,
                "input": result["input"],
                "parameters": result["parameters"],
                "packages": result["packages"],
                "outputs": [f"{name}.json"],
                "summary": summary,
            },
        )


def main(argv: list[str] | None = None) -> int:
    d = MiningParams()
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    parser.add_argument("--low-quantile", type=float, default=d.low_quantile)
    parser.add_argument("--high-quantile", type=float, default=d.high_quantile)
    parser.add_argument(
        "--exclude-variable",
        action="append",
        help="不放進寬表的變數，可重複；給了就取代預設清單（給空字串表示都不排除）",
    )
    parser.add_argument("--min-support", type=float, default=d.min_support)
    parser.add_argument("--min-confidence", type=float, default=d.min_confidence)
    parser.add_argument("--min-lift", type=float, default=d.min_lift)
    parser.add_argument("--max-itemset-size", type=int, default=d.max_itemset_size)
    parser.add_argument("--max-rules", type=int, default=d.max_rules)
    parser.add_argument("--max-itemsets", type=int, default=d.max_itemsets)
    parser.add_argument(
        "--tree-table", choices=sorted(TABLE_AGGREGATION), default=d.tree_table
    )
    parser.add_argument("--tree-target", default=d.tree_target)
    parser.add_argument("--tree-max-depth", type=int, default=d.tree_max_depth)
    parser.add_argument(
        "--tree-min-samples-leaf", type=int, default=d.tree_min_samples_leaf
    )
    parser.add_argument(
        "--tree-train-fraction", type=float, default=d.tree_train_fraction
    )
    args = parser.parse_args(argv)
    exclude = (
        d.exclude_variables
        if args.exclude_variable is None
        else tuple(sorted(name for name in args.exclude_variable if name))
    )
    params = MiningParams(
        low_quantile=args.low_quantile,
        high_quantile=args.high_quantile,
        exclude_variables=exclude,
        min_support=args.min_support,
        min_confidence=args.min_confidence,
        min_lift=args.min_lift,
        max_itemset_size=args.max_itemset_size,
        max_rules=args.max_rules,
        max_itemsets=args.max_itemsets,
        tree_table=args.tree_table,
        tree_target=args.tree_target,
        tree_max_depth=args.tree_max_depth,
        tree_min_samples_leaf=args.tree_min_samples_leaf,
        tree_train_fraction=args.tree_train_fraction,
    )
    anomalies_path = args.analysis_dir / "anomalies.json"
    if not anomalies_path.exists():
        print(f"找不到 {anomalies_path}；先跑 uv run python -m trend_detective.trends")
        return 1
    anomalies = json.loads(anomalies_path.read_text(encoding="utf-8"))
    trends_path = args.analysis_dir / "trends.json"
    trends = (
        json.loads(trends_path.read_text(encoding="utf-8"))
        if trends_path.exists()
        else None
    )
    rules, tree = run(anomalies, trends, params)
    generated_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_outputs(args.analysis_dir, rules, tree, generated_at=generated_at)
    for kind, table in rules["tables"].items():
        if table["first_month"] is None:
            print(f"FP-growth {kind}：寬表是空的")
            continue
        print(
            f"FP-growth {kind}：{table['first_month'][:7]} 至 {table['last_month'][:7]}，"
            f"{table['same_month']['n_transactions']} 筆交易，"
            f"同月規則 {table['same_month']['n_rules']} 條，"
            f"延遲一個月 {table['lagged_one_month']['n_rules']} 條"
        )
    baseline = tree["baseline_majority_class"]
    print(
        f"決策樹（{tree['table']}，目標 {tree['target']}）："
        f"訓練 {tree['split']['n_train']} 列、測試 {tree['split']['n_test']} 列；"
        f"準確率 訓練 {tree['accuracy']['train']:.3f}、測試 {tree['accuracy']['test']:.3f}；"
        f"基準（永遠猜 {baseline['predicted_class']}）測試 {baseline['test_accuracy']:.3f}"
    )
    print(f"已寫出 {args.analysis_dir}/fpgrowth.json、decision_tree.json 與執行紀錄")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
