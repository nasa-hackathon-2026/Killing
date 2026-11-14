"""資料探勘（#55、#59，探索性）：去趨勢月距平的 FP-growth 關聯規則與決策樹。

    uv run python -m trend_detective.trends   # 先有月距平
    uv run python -m trend_detective.mining

輸入是 `data/analysis/anomalies.json` 與 `trends.json`（由 `trend_detective.trends` 產生），
以及 `data/snapshot/catalog.json`（只取變數的順序與英文名）。輸出到分析目錄（不連網）：

- `fpgrowth.json`、`fpgrowth.run.json`：頻繁項目集與關聯規則（同月份，以及延遲一個月）。
- `decision_tree.json`、`decision_tree.run.json`：依時間往前走的多折驗證與每折的樹。

這些結果是探索性的（結果檔標 `exploratory: true`），不取代 `trends.json`，也不代表因果。
預設參數是 #59 依規則選定的起點，數字怎麼解讀留給隊伍。

做法：

1. 寬表：一列是「地點 × 月份」，一欄是一個變數的月距平。點位一張（`aggregation = "point"`）、
   區域一張（`area_mean`）。期間取「表內所有序列都有資料」的共同起訖月。趨勢統計標記為資料
   不足的序列、`exclude_variables` 的變數、`exclude_locations` 的地點（預設 `taiwan`：它的
   bbox 與其他四個區域重疊，同一筆觀測會被算兩次）不放進表。
2. 去趨勢：每條序列的距平減掉自己的線性趨勢（斜率用 `trends.ols_trend`，與趨勢統計同一套
   最小平方法），狀態反映逐月的變動而不是長期趨勢。FP-growth 與變數篩選是描述性的，用表內
   全期估計趨勢；決策樹每一折只用該折的訓練期估計（見 5）。
3. 近乎重複的變數：依固定優先順序（`catalog.json` 的變數順序，先出現的優先）逐一檢查，去趨
   勢距平與任何已保留變數的相關係數絕對值超過 `max_abs_correlation` 就排除。相關係數把該表
   所有地點、兩個變數都有值的月份合併起來算。排除了誰、和誰相關多高寫在 `excluded_variables`。
   篩選用的是「排除前」那張表的共同期間；排除後共同期間可能變長，再重新去趨勢。
4. 狀態與 FP-growth：每條序列用自己的分位數（預設三分位）把去趨勢距平分成 low／normal／
   high。每一列是一筆交易，項目是 `變數=狀態`；缺的格子就沒有那個項目（支持度的分母仍是全部
   交易）。規則只取單一後項，左右兩邊不得是同一個變數；延遲版的交易是「前一個月的狀態
   （`prev:變數=狀態`）加這個月的狀態」，只留前項全在前一個月、後項在這個月的規則。通過支持
   度、信賴度、lift 門檻的候選規則各做 Fisher 精確檢定（「左邊成立與否 × 右邊成立與否」的
   2×2 列聯表，單尾、檢定正相關），同一張表、同一種時間設定的候選規則一起做 BH-FDR，只保留
   q < `rule_alpha` 的。同一變數的持續性（延遲規則的後項變數也在前項）另外放在
   `persistence_rules`，自成一組做 FDR。交易彼此不獨立（相鄰月份、相鄰地點），p 值偏樂觀。
5. 決策樹：目標是某個變數的狀態，特徵是同一列其他變數的值，加上各變數前一個月的值
   （`prev:變數`）。兩種特徵預設不用，因為等於拿目標預測目標：目標自己的前一個月
   （`tree_include_target_lag`），以及與目標同一個物理量的變數（`same_quantity_groups`，
   例如兩套 NDVI 產品；這條規則和 3 的相關係數無關，排除了誰記在 `same_quantity_excluded`）。驗證依月份往前
   走：最前面 `tree_min_train_months` 個月只當訓練，其餘月份切成 `tree_n_folds` 段不重疊的
   測試折，每折的訓練期是該折之前的全部月份。為了不外洩，每一折都只用訓練期重新估計：各月份
   的平均（重新置中）、線性趨勢、目標的分位數門檻，再套到測試期。每折同時報告三種基準：永遠
   猜訓練期最多的類別、永遠猜測試期最多的類別（事後才知道）、猜「和目標自己前一個月的狀態
   一樣」（持續性）。變數篩選（3）用的是全期資料。

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
from scipy import stats
from sklearn.tree import DecisionTreeClassifier

from trend_detective.trends import (
    ANALYSIS_DIR,
    SNAPSHOT_DIR,
    _dump,
    _round,
    benjamini_hochberg,
    index_month,
    month_index,
    ols_trend,
)

SCHEMA_VERSION = 2
PACKAGES = ("numpy", "pandas", "scipy", "mlxtend", "scikit-learn")
STATES = ("low", "normal", "high")
TABLE_AGGREGATION = {"point": "point", "region": "area_mean"}
NOTE = (
    "Exploratory data mining on detrended monthly anomalies. It does not replace "
    "the trend statistics and does not show cause and effect."
)
SIGNIFICANCE_NOTE = (
    "Each rule has a one-sided Fisher exact test on the 2x2 table of left side "
    "holds or not by right side holds or not, with Benjamini-Hochberg correction "
    "across all candidate rules of the same table and timing. Transactions are "
    "not independent (neighbouring months, neighbouring locations), so the p and "
    "q values are optimistic."
)
DETRENDING_NOTE = (
    "Each series has its own least-squares linear trend removed before states "
    "are assigned. Rules and the variable screening use the trend of the whole "
    "table period (descriptive). The decision tree re-estimates monthly means, "
    "trend and target thresholds from the training months of each fold only."
)

Transaction = frozenset[str]


@dataclass(frozen=True)
class MiningParams:
    """可調的參數；預設值只是起點，會寫進結果檔。"""

    # 距平低於／高於序列自己的這兩個分位數，分別是 low／high；中間是 normal
    low_quantile: float = 1 / 3
    high_quantile: float = 2 / 3
    # 不放進寬表的變數（手動指定）。預設不指定：近乎重複的變數由 max_abs_correlation 決定
    exclude_variables: tuple[str, ...] = ()
    # 不放進寬表的地點。taiwan 的 bbox 與其他四個區域重疊
    exclude_locations: tuple[str, ...] = ("taiwan",)
    # 去趨勢距平與已保留變數的相關係數絕對值超過這個值就排除（依固定優先順序）
    max_abs_correlation: float = 0.85
    # FP-growth
    min_support: float = 0.05
    min_confidence: float = 0.6
    min_lift: float = 1.5
    max_itemset_size: int = 3
    # Fisher 精確檢定經 BH-FDR 校正後的 q 值要低於這個值，規則才保留
    rule_alpha: float = 0.05
    # 結果檔最多列幾條規則／幾個項目集（依 lift／支持度排序；總數另外記）
    max_rules: int = 200
    max_itemsets: int = 200
    # 決策樹
    tree_table: str = "region"
    tree_target: str = "modis_ndvi"
    tree_max_depth: int = 3
    tree_min_samples_leaf: int = 20
    # 走動驗證：測試折數；最前面至少這麼多個月只當訓練
    tree_n_folds: int = 3
    tree_min_train_months: int = 120
    # 特徵含不含目標變數自己前一個月的值。預設不含：那等於拿目標預測目標
    tree_include_target_lag: bool = False
    # 同一個物理量的變數組。目標在某一組裡時，同組的其他變數（含前一個月）不當特徵；
    # 這和「依相關係數排除」是兩條獨立的規則
    same_quantity_groups: tuple[tuple[str, ...], ...] = (
        ("modis_ndvi", "modis_ndvi_pc"),
        ("modis_lst", "modis_lst_pc"),
        ("gldas_tair", "merra2_t2m", "airs_tsurf", "power_t2m"),
    )
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
        if location in params.exclude_locations:
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


def fit_trend(index: np.ndarray, values: np.ndarray) -> tuple[float, float, int]:
    """最小平方法直線：回傳 (每年斜率, 截距, 起算月序)，直線是 截距 + 斜率 × (月序 − 起算) / 12。

    斜率來自 `trends.ols_trend`（趨勢統計用的同一個函式）；最小平方法的直線通過兩個平均值，
    所以截距 = 平均值 − 斜率 × 平均時間。
    """
    if index.size < 3:
        raise ValueError("可用月份少於 3 個，估不出線性趨勢")
    origin = int(index[0])
    slope = ols_trend(index, values, 0.05)["slope_per_decade"] / 10
    years = (index - origin) / 12
    return slope, float(values.mean() - slope * years.mean()), origin


def detrend(index: np.ndarray, values: np.ndarray) -> np.ndarray:
    """減掉用全部非缺值月份估計的線性趨勢；NaN 保持 NaN。"""
    valid = ~np.isnan(values)
    slope, intercept, origin = fit_trend(index[valid], values[valid])
    return values - (intercept + slope * (index - origin) / 12)


def fold_residuals(values: np.ndarray, first_index: int, train_stop: int) -> np.ndarray:
    """決策樹一折用的去趨勢距平：估計只用位置小於 `train_stop` 的月份（訓練期）。

    先把每個月份（1 至 12 月）減掉訓練期該月份的平均（輸入的距平是用全期平均算的，這一步
    改成只用訓練期），再減掉訓練期的線性趨勢。整條序列（含測試期）都套用同一組估計值。
    """
    positions = np.arange(values.size)
    index = first_index + positions
    train = (positions < train_stop) & ~np.isnan(values)
    centred = values.copy()
    for calendar_month in range(12):
        month = index % 12 == calendar_month
        if (train & month).any():
            centred[month] -= values[train & month].mean()
    slope, intercept, origin = fit_trend(index[train], centred[train])
    return centred - (intercept + slope * (index - origin) / 12)


def detrend_table(table: WideTable) -> WideTable:
    """每條序列各自去趨勢（用表內全期）。"""
    index = table.first_index + np.arange(table.n_months)
    values = {
        location: {
            variable: detrend(index, series) for variable, series in by_variable.items()
        }
        for location, by_variable in table.values.items()
    }
    return WideTable(
        table.kind,
        table.first_index,
        table.n_months,
        table.locations,
        table.variables,
        values,
        table.dropped_series,
    )


def priority_order(variables: list[str], priority: tuple[str, ...]) -> list[str]:
    """`priority` 裡有的依它的順序排前面，其餘依名稱排在後面。"""
    rank = {variable: i for i, variable in enumerate(priority)}
    return sorted(variables, key=lambda v: (rank.get(v, len(rank)), v))


def pooled_correlation(
    table: WideTable, first: str, second: str
) -> tuple[float | None, int]:
    """兩個變數在所有地點、都有值的月份合併後的相關係數與配對數；算不出來時是 None。"""
    xs, ys = [], []
    for by_variable in table.values.values():
        if first in by_variable and second in by_variable:
            x, y = by_variable[first], by_variable[second]
            both = ~np.isnan(x) & ~np.isnan(y)
            xs.append(x[both])
            ys.append(y[both])
    x = np.concatenate(xs) if xs else np.array([])
    y = np.concatenate(ys) if ys else np.array([])
    if x.size < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return None, int(x.size)
    return float(np.corrcoef(x, y)[0, 1]), int(x.size)


def select_variables(
    detrended: WideTable, priority: tuple[str, ...], params: MiningParams
) -> tuple[list[str], list[dict[str, Any]]]:
    """依優先順序保留變數；與已保留變數的 |相關係數| 超過門檻的排除。

    回傳 (保留的變數, 排除紀錄)。排除紀錄記下相關最高的那個已保留變數與相關係數。
    """
    kept: list[str] = []
    excluded: list[dict[str, Any]] = []
    for variable in priority_order(detrended.variables, priority):
        strongest: tuple[float, str, int] | None = None
        for other in kept:
            correlation, n_pairs = pooled_correlation(detrended, variable, other)
            if correlation is not None and (
                strongest is None or abs(correlation) > abs(strongest[0])
            ):
                strongest = (correlation, other, n_pairs)
        if strongest is not None and abs(strongest[0]) > params.max_abs_correlation:
            excluded.append(
                {
                    "variable_id": variable,
                    "correlated_with": strongest[1],
                    "correlation": strongest[0],
                    "n_pairs": strongest[2],
                }
            )
        else:
            kept.append(variable)
    return kept, excluded


def select_table(
    anomalies: dict[str, Any],
    trends: dict[str, Any] | None,
    kind: str,
    params: MiningParams,
    priority: tuple[str, ...],
) -> tuple[WideTable, list[dict[str, Any]]]:
    """排除近乎重複的變數之後的寬表（距平還沒去趨勢）與排除紀錄。"""
    full = build_table(anomalies, trends, kind, params)
    if full.n_months < 3:
        return full, []
    _, excluded = select_variables(detrend_table(full), priority, params)
    if not excluded:
        return full, []
    narrowed = MiningParams(
        **{
            **asdict(params),
            "exclude_variables": (
                *params.exclude_variables,
                *(item["variable_id"] for item in excluded),
            ),
        }
    )
    return build_table(anomalies, trends, kind, narrowed), excluded


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


def fisher_p(
    n_both: int, n_antecedent: int, n_consequent: int, n_transactions: int
) -> float:
    """單尾 Fisher 精確檢定（檢定正相關）：左邊成立與否 × 右邊成立與否的 2×2 列聯表。"""
    table = [
        [n_both, n_antecedent - n_both],
        [
            n_consequent - n_both,
            n_transactions - n_antecedent - n_consequent + n_both,
        ],
    ]
    return float(stats.fisher_exact(table, alternative="greater")[1])  # pyright: ignore[reportIndexIssue, reportArgumentType]


def association_rules(
    itemsets: dict[Transaction, float],
    params: MiningParams,
    n_transactions: int,
    *,
    lagged: bool = False,
) -> list[dict[str, Any]]:
    """通過門檻的候選規則（單一後項），各附 Fisher 精確檢定的 `p`。

    信賴度 = 支持度(前項 ∪ 後項) ÷ 支持度(前項)，lift = 信賴度 ÷ 支持度(後項)。
    `lagged` 時只留「前項全是 prev:、後項不是 prev:」的規則。`same_variable` 標出後項的變數
    也出現在前項的規則（延遲版就是同一個變數的持續性）。
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
                    "p": fisher_p(
                        round(support * n_transactions),
                        round(antecedent_support * n_transactions),
                        round(consequent_support * n_transactions),
                        n_transactions,
                    ),
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


def significant_rules(
    candidates: list[dict[str, Any]], alpha: float
) -> list[dict[str, Any]]:
    """對整組候選規則的 `p` 做 BH-FDR，加上 `q`，只回傳 q < alpha 的（順序不變）。"""
    adjusted = benjamini_hochberg([rule["p"] for rule in candidates])
    return [
        {**rule, "q": q}
        for rule, q in zip(candidates, adjusted, strict=True)
        if q < alpha
    ]


def mine(
    transactions: list[Transaction], params: MiningParams, *, lagged: bool = False
) -> dict[str, Any]:
    itemsets = frequent_itemsets(transactions, params)
    candidates = association_rules(itemsets, params, len(transactions), lagged=lagged)
    # 左右兩邊不得是同一個變數；同變數的持續性另外一組，各自做 FDR
    cross = [rule for rule in candidates if not rule["same_variable"]]
    persistence = [rule for rule in candidates if rule["same_variable"]]
    rules = significant_rules(cross, params.rule_alpha)
    persistence_rules = significant_rules(persistence, params.rule_alpha)
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
        "n_candidate_rules": len(cross),
        "n_rules": len(rules),
        "rules": rules[: params.max_rules],
        "n_candidate_persistence_rules": len(persistence),
        "n_persistence_rules": len(persistence_rules),
        "persistence_rules": persistence_rules[: params.max_rules],
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
    anomalies: dict[str, Any],
    trends: dict[str, Any] | None,
    params: MiningParams,
    priority: tuple[str, ...] = (),
) -> dict[str, Any]:
    tables = {}
    for kind in TABLE_AGGREGATION:
        table, excluded = select_table(anomalies, trends, kind, params, priority)
        if table.n_months >= 3:
            table = detrend_table(table)
        states = state_table(table, params)
        tables[kind] = {
            **describe_table(table),
            "excluded_variables": excluded,
            "same_month": mine(same_month_transactions(states, table.n_months), params),
            "lagged_one_month": mine(
                lagged_transactions(states, table.n_months), params, lagged=True
            ),
        }
    return {"tables": tables}


def walk_forward_folds(
    months: list[int], n_folds: int, min_train_months: int
) -> list[tuple[list[int], list[int]]]:
    """依時間往前走的折：回傳每折的 (訓練月份, 測試月份)。

    依「不重複的月份」排序；最前面 `min_train_months` 個月只當訓練，其餘切成 `n_folds` 段
    連續、不重疊的測試折（除不盡時前面的折多一個月）。每折的訓練期是測試折之前的全部月份。
    """
    unique = sorted(set(months))
    rest = unique[min_train_months:]
    if n_folds < 1 or min_train_months < 1 or len(rest) < n_folds:
        raise ValueError(
            f"月份太少：{len(unique)} 個月扣掉最少訓練期 {min_train_months} 個月後，"
            f"切不出 {n_folds} 個測試折"
        )
    folds = []
    for block in np.array_split(np.array(rest), n_folds):
        test = [int(month) for month in block]
        folds.append(([month for month in unique if month < test[0]], test))
    return folds


def same_quantity_variables(target: str, params: MiningParams) -> list[str]:
    """與目標同一個物理量的其他變數（依 `same_quantity_groups`）。"""
    return sorted(
        {
            variable
            for group in params.same_quantity_groups
            if target in group
            for variable in group
            if variable != target
        }
    )


def majority_baselines(
    train_labels: list[str], test_labels: list[str]
) -> dict[str, Any]:
    """兩種只猜一個類別的基準，都以測試期的準確率表示。

    `train_majority`：永遠猜訓練期最多的類別（同數時取 STATES 順序在前的，並標 `tie`）。
    `test_majority`：永遠猜測試期最多的類別；這要看過測試期才知道，是事後的對照。
    """
    counts = {state: train_labels.count(state) for state in STATES}
    majority = max(STATES, key=lambda state: counts[state])
    test_counts = {state: test_labels.count(state) for state in STATES}
    best = max(STATES, key=lambda state: test_counts[state])
    return {
        "train_majority": {
            "predicted_class": majority,
            "tie": list(counts.values()).count(counts[majority]) > 1,
            "test_accuracy": test_counts[majority] / len(test_labels),
        },
        "test_majority": {
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


def summary_text(
    n_folds: int, n_all: int, n_train: int, n_test: int, n_persistence: int
) -> str:
    """給網頁直接顯示的中性說明：樹在幾折裡高於基準。"""
    text = (
        f"The tree's test accuracy is above all three baselines in {n_all} of "
        f"{n_folds} folds (above the training-majority guess in {n_train}, above "
        f"the test-majority guess in {n_test}, above the previous-month "
        f"persistence guess in {n_persistence})."
    )
    if n_all < n_folds:
        text += (
            f" In {n_folds - n_all} of {n_folds} folds the tree does not beat "
            "at least one guess that uses no other variable."
        )
    return text


def run_decision_tree(
    anomalies: dict[str, Any],
    trends: dict[str, Any] | None,
    params: MiningParams,
    priority: tuple[str, ...] = (),
) -> dict[str, Any]:
    table, excluded = select_table(
        anomalies, trends, params.tree_table, params, priority
    )
    target = params.tree_target
    if target not in table.variables:
        reason = next(
            (
                f"（與 {item['correlated_with']} 的相關係數 {item['correlation']:.3f}，"
                "已被排除）"
                for item in excluded
                if item["variable_id"] == target
            ),
            "",
        )
        raise ValueError(f"目標變數 {target} 不在 {params.tree_table} 寬表裡{reason}")
    # 與目標同一個物理量的變數不當特徵（同月與前一個月都不用）
    same_quantity = [
        variable
        for variable in same_quantity_variables(target, params)
        if variable in table.variables
    ]
    others = [
        variable
        for variable in table.variables
        if variable != target and variable not in same_quantity
    ]
    lagged = [
        variable
        for variable in table.variables
        if variable not in same_quantity
        and (variable != target or params.tree_include_target_lag)
    ]
    features = [*others, *(f"prev:{variable}" for variable in lagged)]
    n = table.n_months

    # 一列是「地點 × 月份」（每個地點的第一個月沒有前一個月，不成列）；缺任何一格就不用
    usable: dict[str, np.ndarray] = {}
    rows_by_location = {}
    for location in table.locations:
        by_variable = table.values[location]
        missing = sorted({target, *others, *lagged} - set(by_variable))
        complete = np.zeros(n, dtype=bool)
        if not missing and n > 1:
            # 目標這個月與前一個月都要有值（前一個月給持續性基準用）
            complete[1:] = ~np.isnan(by_variable[target][1:])
            complete[1:] &= ~np.isnan(by_variable[target][:-1])
            for variable in others:
                complete[1:] &= ~np.isnan(by_variable[variable][1:])
            for variable in lagged:
                complete[1:] &= ~np.isnan(by_variable[variable][:-1])
            usable[location] = complete
        rows_by_location[location] = {
            "n_rows": max(0, n - 1),
            "n_complete_rows": int(complete.sum()),
            "missing_variables": missing,
        }
    positions = sorted(
        {int(i) for complete in usable.values() for i in np.flatnonzero(complete)}
    )
    folds = []
    for number, (train_months, test_months) in enumerate(
        walk_forward_folds(
            positions, params.tree_n_folds, params.tree_min_train_months
        ),
        start=1,
    ):
        train_stop, test_stop = test_months[0], test_months[-1] + 1
        x_train: list[list[float]] = []
        x_test: list[list[float]] = []
        y_train: list[str] = []
        y_test: list[str] = []
        previous_test: list[str] = []
        cuts = {}
        for location in sorted(usable):
            # 趨勢、月份平均、目標門檻都只用這一折的訓練期（位置 < train_stop）估計
            residual = {
                variable: fold_residuals(series, table.first_index, train_stop)
                for variable, series in table.values[location].items()
                if variable not in same_quantity
            }
            low, high = thresholds(residual[target][:train_stop], params)
            cuts[location] = {"low": low, "high": high}
            labels = discretize(residual[target], low, high)
            for i in np.flatnonzero(usable[location][:test_stop]):
                x = [float(residual[variable][i]) for variable in others]
                x += [float(residual[variable][i - 1]) for variable in lagged]
                label = labels[i] or "normal"
                if i < train_stop:
                    x_train.append(x)
                    y_train.append(label)
                else:
                    x_test.append(x)
                    y_test.append(label)
                    previous_test.append(labels[i - 1] or "normal")
        model = DecisionTreeClassifier(
            max_depth=params.tree_max_depth,
            min_samples_leaf=params.tree_min_samples_leaf,
            random_state=params.tree_random_state,
        )
        model.fit(np.array(x_train), y_train)
        predicted = [str(label) for label in model.predict(np.array(x_test))]
        accuracy = sum(a == g for a, g in zip(y_test, predicted, strict=True)) / len(
            y_test
        )
        baselines = majority_baselines(y_train, y_test)
        # 持續性基準：猜「和目標自己前一個月的狀態一樣」，不用任何其他變數
        baselines["persistence"] = {
            "test_accuracy": sum(
                a == g for a, g in zip(y_test, previous_test, strict=True)
            )
            / len(y_test)
        }
        importances = sorted(
            zip(features, (float(v) for v in model.feature_importances_), strict=True),
            key=lambda pair: (-pair[1], pair[0]),
        )
        nodes = _tree_nodes(model, features)
        folds.append(
            {
                "fold": number,
                "train_first_month": index_month(table.first_index + train_months[0]),
                "train_last_month": index_month(table.first_index + train_months[-1]),
                "test_first_month": index_month(table.first_index + test_months[0]),
                "test_last_month": index_month(table.first_index + test_months[-1]),
                "n_train_months": len(train_months),
                "n_test_months": len(test_months),
                "n_train": len(y_train),
                "n_test": len(y_test),
                "class_counts": {
                    "train": {state: y_train.count(state) for state in STATES},
                    "test": {state: y_test.count(state) for state in STATES},
                },
                "target_thresholds": cuts,
                "accuracy": {
                    "train": float(model.score(np.array(x_train), y_train)),
                    "test": accuracy,
                },
                "baselines": baselines,
                "above_train_majority": accuracy
                > baselines["train_majority"]["test_accuracy"],
                "above_test_majority": accuracy
                > baselines["test_majority"]["test_accuracy"],
                "above_persistence": accuracy
                > baselines["persistence"]["test_accuracy"],
                "confusion_matrix_test": {
                    actual: {
                        guess: sum(
                            1
                            for a, g in zip(y_test, predicted, strict=True)
                            if (a, g) == (actual, guess)
                        )
                        for guess in STATES
                    }
                    for actual in STATES
                },
                "feature_importances": [
                    {"feature": feature, "importance": importance}
                    for feature, importance in importances
                ],
                "tree": nodes,
                "tree_text": tree_text(nodes),
            }
        )
    n_train = sum(fold["above_train_majority"] for fold in folds)
    n_test = sum(fold["above_test_majority"] for fold in folds)
    n_persistence = sum(fold["above_persistence"] for fold in folds)
    n_all = sum(
        fold["above_train_majority"]
        and fold["above_test_majority"]
        and fold["above_persistence"]
        for fold in folds
    )
    return {
        "table": params.tree_table,
        "target": target,
        "target_classes": list(STATES),
        "features": features,
        "rows_by_location": rows_by_location,
        "dropped_series": table.dropped_series,
        "excluded_variables": excluded,
        # 與目標同一個物理量、因此不當特徵的變數（另一條規則，與相關係數無關）
        "same_quantity_excluded": same_quantity,
        "validation": {
            "method": (
                "walk-forward by month: each fold tests on the next block of months "
                "and trains on every month before it; monthly means, linear trend "
                "and target thresholds are estimated from the training months only"
            ),
            "n_folds": len(folds),
            "min_train_months": params.tree_min_train_months,
        },
        "folds": folds,
        "summary": {
            "n_folds": len(folds),
            "n_folds_above_train_majority": n_train,
            "n_folds_above_test_majority": n_test,
            "n_folds_above_persistence": n_persistence,
            "n_folds_above_all": n_all,
            "above_all_in_every_fold": n_all == len(folds),
            "mean_test_accuracy": float(
                np.mean([fold["accuracy"]["test"] for fold in folds])
            ),
            "mean_train_majority_accuracy": float(
                np.mean(
                    [f["baselines"]["train_majority"]["test_accuracy"] for f in folds]
                )
            ),
            "mean_test_majority_accuracy": float(
                np.mean(
                    [f["baselines"]["test_majority"]["test_accuracy"] for f in folds]
                )
            ),
            "mean_persistence_accuracy": float(
                np.mean([f["baselines"]["persistence"]["test_accuracy"] for f in folds])
            ),
            "text_en": summary_text(len(folds), n_all, n_train, n_test, n_persistence),
        },
    }


COMMON_PARAMS = (
    "low_quantile",
    "high_quantile",
    "exclude_variables",
    "exclude_locations",
    "max_abs_correlation",
)
FPGROWTH_PARAMS = (
    *COMMON_PARAMS,
    "min_support",
    "min_confidence",
    "min_lift",
    "max_itemset_size",
    "rule_alpha",
    "max_rules",
    "max_itemsets",
)
TREE_PARAMS = (
    *COMMON_PARAMS,
    "tree_table",
    "tree_target",
    "tree_max_depth",
    "tree_min_samples_leaf",
    "tree_n_folds",
    "tree_min_train_months",
    "tree_include_target_lag",
    "same_quantity_groups",
    "tree_random_state",
)


def catalog_variables(snapshot_dir: Path) -> dict[str, str]:
    """`catalog.json` 的變數 id → 英文名，順序就是排除近乎重複變數時的優先順序。"""
    path = snapshot_dir / "catalog.json"
    if not path.exists():
        return {}
    catalog = json.loads(path.read_text(encoding="utf-8"))
    return {
        item["id"]: item.get("name_en") or item["id"] for item in catalog["variables"]
    }


def _header(
    anomalies: dict[str, Any],
    params: MiningParams,
    names: tuple[str, ...],
    variable_names: dict[str, str],
) -> dict[str, Any]:
    everything = asdict(params)
    present = sorted({item["variable_id"] for item in anomalies["series"].values()})
    priority = priority_order(present, tuple(variable_names))
    return {
        "schema_version": SCHEMA_VERSION,
        "exploratory": True,
        "note": NOTE,
        "detrending_note": DETRENDING_NOTE,
        "input": {
            "anomalies": "data/analysis/anomalies.json",
            "snapshot_generated_at": anomalies["input"]["snapshot_generated_at"],
            "trend_parameters": anomalies["parameters"],
        },
        "parameters": {name: everything[name] for name in names},
        "packages": {name: version(name) for name in PACKAGES},
        # 排除近乎重複變數時的優先順序（catalog.json 的順序；不在目錄裡的依名稱排在後面）
        "variable_priority": priority,
        "variable_names": {v: variable_names.get(v, v) for v in priority},
    }


def run(
    anomalies: dict[str, Any],
    trends: dict[str, Any] | None,
    params: MiningParams,
    variable_names: dict[str, str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """回傳 (fpgrowth, decision_tree) 兩個要寫出的結構。

    `variable_names` 是 id → 英文名，鍵的順序是排除近乎重複變數時的優先順序。
    """
    names = variable_names or {}
    priority = tuple(names)
    rules = {
        **_header(anomalies, params, FPGROWTH_PARAMS, names),
        "significance_note": SIGNIFICANCE_NOTE,
        **run_fpgrowth(anomalies, trends, params, priority),
    }
    tree = {
        **_header(anomalies, params, TREE_PARAMS, names),
        **run_decision_tree(anomalies, trends, params, priority),
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
                    "excluded_variables": table["excluded_variables"],
                }
                for kind, table in rules["tables"].items()
            },
        ),
        (
            "decision_tree",
            tree,
            {
                **tree["summary"],
                "folds": [
                    {
                        "fold": fold["fold"],
                        "n_train": fold["n_train"],
                        "n_test": fold["n_test"],
                        "test_accuracy": fold["accuracy"]["test"],
                        "train_majority_accuracy": fold["baselines"]["train_majority"][
                            "test_accuracy"
                        ],
                        "test_majority_accuracy": fold["baselines"]["test_majority"][
                            "test_accuracy"
                        ],
                        "persistence_accuracy": fold["baselines"]["persistence"][
                            "test_accuracy"
                        ],
                    }
                    for fold in tree["folds"]
                ],
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
    parser.add_argument(
        "--snapshot-dir",
        type=Path,
        default=SNAPSHOT_DIR,
        help="讀 catalog.json 的變數順序（排除近乎重複變數的優先順序）與英文名",
    )
    parser.add_argument("--low-quantile", type=float, default=d.low_quantile)
    parser.add_argument("--high-quantile", type=float, default=d.high_quantile)
    parser.add_argument(
        "--exclude-variable",
        action="append",
        help="手動指定不放進寬表的變數，可重複（預設不指定）",
    )
    parser.add_argument(
        "--exclude-location",
        action="append",
        help="不放進寬表的地點，可重複；給了就取代預設的 taiwan（給空字串表示都不排除）",
    )
    parser.add_argument(
        "--max-abs-correlation",
        type=float,
        default=d.max_abs_correlation,
        help="去趨勢距平與已保留變數的 |相關係數| 超過就排除；給 1 表示不排除",
    )
    parser.add_argument("--min-support", type=float, default=d.min_support)
    parser.add_argument("--min-confidence", type=float, default=d.min_confidence)
    parser.add_argument("--min-lift", type=float, default=d.min_lift)
    parser.add_argument("--max-itemset-size", type=int, default=d.max_itemset_size)
    parser.add_argument("--rule-alpha", type=float, default=d.rule_alpha)
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
    parser.add_argument("--tree-n-folds", type=int, default=d.tree_n_folds)
    parser.add_argument(
        "--tree-min-train-months", type=int, default=d.tree_min_train_months
    )
    parser.add_argument(
        "--tree-target-lag",
        action="store_true",
        help="特徵加上目標變數自己前一個月的值（預設不加）",
    )
    parser.add_argument(
        "--same-quantity-group",
        action="append",
        help=(
            "同一個物理量的變數組，逗號分隔，可重複；給了就取代預設的各組"
            "（給空字串表示沒有任何組）"
        ),
    )
    args = parser.parse_args(argv)
    params = MiningParams(
        low_quantile=args.low_quantile,
        high_quantile=args.high_quantile,
        exclude_variables=tuple(
            sorted(name for name in args.exclude_variable or [] if name)
        ),
        exclude_locations=(
            d.exclude_locations
            if args.exclude_location is None
            else tuple(sorted(name for name in args.exclude_location if name))
        ),
        max_abs_correlation=args.max_abs_correlation,
        min_support=args.min_support,
        min_confidence=args.min_confidence,
        min_lift=args.min_lift,
        max_itemset_size=args.max_itemset_size,
        rule_alpha=args.rule_alpha,
        max_rules=args.max_rules,
        max_itemsets=args.max_itemsets,
        tree_table=args.tree_table,
        tree_target=args.tree_target,
        tree_max_depth=args.tree_max_depth,
        tree_min_samples_leaf=args.tree_min_samples_leaf,
        tree_n_folds=args.tree_n_folds,
        tree_min_train_months=args.tree_min_train_months,
        tree_include_target_lag=args.tree_target_lag,
        same_quantity_groups=(
            d.same_quantity_groups
            if args.same_quantity_group is None
            else tuple(
                tuple(name for name in group.split(",") if name)
                for group in args.same_quantity_group
                if group
            )
        ),
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
    rules, tree = run(anomalies, trends, params, catalog_variables(args.snapshot_dir))
    generated_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_outputs(args.analysis_dir, rules, tree, generated_at=generated_at)
    for kind, table in rules["tables"].items():
        if table["first_month"] is None:
            print(f"FP-growth {kind}：寬表是空的")
            continue
        excluded = "、".join(
            f"{item['variable_id']}（與 {item['correlated_with']} "
            f"r = {item['correlation']:.3f}）"
            for item in table["excluded_variables"]
        )
        print(
            f"FP-growth {kind}：{table['first_month'][:7]} 至 {table['last_month'][:7]}，"
            f"{table['same_month']['n_transactions']} 筆交易，"
            f"同月規則 {table['same_month']['n_rules']} 條，"
            f"延遲一個月 {table['lagged_one_month']['n_rules']} 條；"
            f"排除的變數：{excluded or '無'}"
        )
    print(f"決策樹（{tree['table']}，目標 {tree['target']}）：")
    for fold in tree["folds"]:
        baselines = fold["baselines"]
        print(
            f"  第 {fold['fold']} 折 測試 {fold['test_first_month'][:7]} 至 "
            f"{fold['test_last_month'][:7]}（訓練 {fold['n_train']} 列、測試 "
            f"{fold['n_test']} 列）：準確率 {fold['accuracy']['test']:.3f}；"
            f"猜訓練期最多的類別 {baselines['train_majority']['test_accuracy']:.3f}；"
            f"猜測試期最多的類別 {baselines['test_majority']['test_accuracy']:.3f}；"
            f"猜和前一個月一樣 {baselines['persistence']['test_accuracy']:.3f}"
        )
    print(f"  {tree['summary']['text_en']}")
    print(f"已寫出 {args.analysis_dir}/fpgrowth.json、decision_tree.json 與執行紀錄")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
