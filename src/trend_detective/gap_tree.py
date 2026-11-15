"""模式與觀測差距的決策樹與描述統計（#111，探索性）。

    uv run python -m trend_detective.gap_tree

問題：台灣測站的氣溫配對裡，「模式距平 − 觀測距平」的絕對值在什麼條件下比較大。只列數字，
不判斷模式或觀測誰對，也不代表因果。

輸入（都在 repo 裡，不連資料庫、不連網）：`data/analysis/model_vs_obs.json` 的
`taiwan_station` 配對（逐月的兩條距平與差值）、`data/analysis/anomalies.json`（核心點位的
月距平，當作環境特徵）、`data/seed/variable_taxonomy.json`（哪些變數是溫度類）、
`data/analysis/trends.json`（`gldas_tair` 的跳變月份）。輸出 `gap_tree.json` 與
`gap_tree.run.json`。

做法：

1. 配對：`station_temp` 對 `gldas_tair`、`merra2_t2m`。`power_t2m` 不用：它提供的就是
   MERRA-2 的場（與 `merra2_t2m` 是同量變數，且只有 2 站）。
2. 描述統計（不需要模型）：差值絕對值的平均，依「模式產品 × 季節」「模式產品 × GLDAS 分段」
   「模式產品 × 測站」分組，附月數與以年為單位重抽的自助法區間（月資料彼此相關，整年一起抽）。
   用的是匯出檔的距平（共同期間的月氣候值）。
3. 目標：差值絕對值分三級（small／medium／large），門檻是**訓練列**的分位數（全部配對合併），
   測試列不重新切。
4. 特徵（都是當月就知道、且與目標沒有機械關聯的）：日曆月、模式產品、GLDAS 分段編號（只有
   GLDAS 配對有值，MERRA-2 配對是 0）、測站（one-hot）、最近的核心點位上**非溫度類**變數的
   當月去趨勢距平分級（−1／0／1）、觀測距平本身的分級。
5. 不放的特徵（`check_feature_names` 會擋）：模式距平、觀測距平、差值的連續值；溫度類變數
   （與目標同量）；目標自己的前一個月（另跑一個含它的版本當參考，標明）。另有一個看資料的
   檢查（`check_single_feature_leak`）：任何單一特徵在訓練列上就能把類別分對超過門檻，視為洩漏。
6. 驗證：（a）走動驗證——依月份往前走，折數與最小訓練月數沿用 `mining.py` 的慣例；每一折的
   月份平均（重新置中）、線性趨勢、分位數門檻都只用訓練期估計。（b）留一地點——訓練在其他
   測站、測試在沒看過的測站；這時不放測站特徵。留一地點的訓練與測試在同一段時間，鄰近測站
   同一個月的天氣相同，所以它檢查的是「換一個地點」而不是「預測未來」；各序列的距平與分級用
   自己全期估計（不看類別），目標門檻只用訓練測站。
7. 基準：永遠猜訓練列最多的類別、猜「和這一對上個月的類別一樣」（持續性）、只看日曆月（猜
   訓練列裡該日曆月最多的類別）。另列「永遠猜測試列最多的類別」，那是事後才知道的對照，不算
   在「高於全部基準」裡。

參數在跑之前定好（`GapParams` 的預設值），全部寫進結果檔；三個版本（含分段、不含分段、含
目標前一個月）都列出，沒有其他嘗試。資料沒變時重跑，結果檔逐位元組相同。
"""

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import f1_score
from sklearn.tree import DecisionTreeClassifier

from trend_detective import cleaning, taxonomy
from trend_detective.mining import _tree_nodes, tree_text, walk_forward_folds
from trend_detective.mining_stats import block_bootstrap_mean
from trend_detective.model_obs import haversine_km
from trend_detective.trends import ANALYSIS_DIR, _dump, _round, index_month

SCHEMA_VERSION = 1
PACKAGES = ("numpy", "scipy", "scikit-learn")
CLASSES = ("small", "medium", "large")
SEASONS = ("DJF", "MAM", "JJA", "SON")
VALIDATIONS = ("walk_forward", "leave_one_location_out")
MIGRATION = Path("db/migrations/023_mining_plus.sql")
TARGET_LAG = "prev_gap_class"
SEGMENT = "gldas_segment"
# 名稱以這些開頭的特徵是目標的組成（模式距平 − 觀測距平），連續值不得當特徵
FORBIDDEN_PREFIXES = ("model_anomaly", "obs_anomaly", "difference", "abs_difference")
NOTE = (
    "Exploratory. The target is the size of the monthly difference between a model "
    "anomaly and a station anomaly. A larger difference does not say which of the "
    "two is right, and nothing here shows cause and effect."
)


@dataclass(frozen=True)
class GapParams:
    """跑之前定好的參數；全部寫進結果檔。"""

    group: str = "taiwan_station"
    model_variables: tuple[str, ...] = ("gldas_tair", "merra2_t2m")
    # 與 merra2_t2m 同量、不用的產品
    dropped_same_quantity_models: tuple[str, ...] = ("power_t2m",)
    low_quantile: float = 1 / 3
    high_quantile: float = 2 / 3
    tree_max_depth: int = 3
    tree_min_samples_leaf: int = 20
    tree_n_folds: int = 3
    tree_min_train_months: int = 120
    tree_random_state: int = 0
    # 單一特徵在訓練列上的準確率超過這個值就視為洩漏
    max_single_feature_accuracy: float = 0.95
    bootstrap_resamples: int = 2000
    bootstrap_seed: int = 0
    alpha: float = 0.05
    # 分類路徑含這個字的變數是溫度類，不當環境特徵
    excluded_category_keyword: str = "temperature"


@dataclass(frozen=True)
class Pair:
    pair_id: str
    model_variable: str
    station: str
    index: np.ndarray  # 月序（連續）
    model: np.ndarray  # 模式距平，缺月 NaN
    obs: np.ndarray
    context_point: str
    context_distance_km: float


def season_of(month_index_value: int) -> str:
    """月序 → 季節（DJF、MAM、JJA、SON）。"""
    calendar = month_index_value % 12 + 1
    return SEASONS[(calendar % 12) // 3]


def segment_of(month_index_value: int, breaks: list[int]) -> int:
    """月份落在第幾段（從 1 起算）；`breaks` 是每個新段開始的月序，由小到大。"""
    return 1 + sum(1 for b in breaks if month_index_value >= b)


def class_thresholds(
    values: np.ndarray, low_quantile: float, high_quantile: float
) -> tuple[float, float]:
    """訓練列的兩個分位數門檻（忽略 NaN）。"""
    valid = values[~np.isnan(values)]
    low, high = np.quantile(valid, [low_quantile, high_quantile])
    return float(low), float(high)


def classify(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """≤ low 是 0（small）、> high 是 2（large）、其餘 1；NaN 是 −1。"""
    out = np.where(values > high, 2, np.where(values <= low, 0, 1))
    return np.where(np.isnan(values), -1, out).astype(int)


def recenter(index: np.ndarray, values: np.ndarray, train: np.ndarray) -> np.ndarray:
    """每個日曆月減掉**訓練月份**裡該日曆月的平均；訓練期沒有的日曆月減訓練期總平均。"""
    out = values.astype(float).copy()
    usable = train & ~np.isnan(values)
    if not usable.any():
        return out
    overall = float(values[usable].mean())
    for calendar in range(12):
        mask = index % 12 == calendar
        chosen = usable & mask
        out[mask] = values[mask] - (
            float(values[chosen].mean()) if chosen.any() else overall
        )
    return out


def fold_states(
    index: np.ndarray, values: np.ndarray, train: np.ndarray, params: GapParams
) -> np.ndarray:
    """一條距平序列 → 每個月的分級（−1／0／1；NaN 保持 NaN），只用訓練月份估計。

    訓練月份的日曆月平均（重新置中）、線性趨勢、兩個分位數門檻套到全部月份。
    """
    centered = recenter(index, values, train)
    usable = train & ~np.isnan(centered)
    if int(usable.sum()) < 3:
        return np.full(values.shape, np.nan)
    years = (index - index[usable][0]) / 12
    slope, intercept = np.polyfit(years[usable], centered[usable], 1)
    residual = centered - (intercept + slope * years)
    low, high = class_thresholds(
        residual[usable], params.low_quantile, params.high_quantile
    )
    states = np.where(residual > high, 1.0, np.where(residual < low, -1.0, 0.0))
    return np.where(np.isnan(residual), np.nan, states)


def check_feature_names(
    features: list[str], *, allow_target_lag: bool, temperature_variables: set[str]
) -> None:
    """特徵名稱的洩漏檢查：目標的組成、同量（溫度類）變數、未允許的目標 lag 都擋下。"""
    for name in features:
        if name.startswith(FORBIDDEN_PREFIXES):
            raise ValueError(
                f"特徵 {name} 是目標的組成（模式距平 − 觀測距平），不能當特徵"
            )
        if name == TARGET_LAG and not allow_target_lag:
            raise ValueError("目標自己前一個月的類別預設不當特徵")
        if name.startswith("ctx:") and name[4:] in temperature_variables:
            raise ValueError(f"特徵 {name} 是溫度類變數，與目標同量")


def check_single_feature_leak(
    x: np.ndarray, y: np.ndarray, features: list[str], params: GapParams
) -> None:
    """看資料的洩漏檢查：單一特徵（深度 2 的樹）在訓練列上的準確率超過門檻就擋下。"""
    for column, name in enumerate(features):
        model = DecisionTreeClassifier(
            max_depth=2, random_state=params.tree_random_state
        )
        single = x[:, [column]]
        model.fit(single, y)
        accuracy = float((model.predict(single) == y).mean())
        if accuracy > params.max_single_feature_accuracy:
            raise ValueError(
                f"特徵 {name} 單獨就把訓練列分對 {accuracy:.3f}，"
                "超過門檻，疑似含有目標資訊"
            )


def majority(labels: np.ndarray) -> int:
    """最多的類別；同數時取編號小的。"""
    counts = [int((labels == k).sum()) for k in range(len(CLASSES))]
    return int(np.argmax(counts))


def calendar_month_prediction(
    train_months: np.ndarray, train_labels: np.ndarray, test_months: np.ndarray
) -> np.ndarray:
    """只看日曆月的基準：猜訓練列裡該日曆月最多的類別；訓練列沒有該月就猜整體最多的。"""
    overall = majority(train_labels)
    by_month = {
        int(m): majority(train_labels[train_months == m])
        for m in np.unique(train_months)
    }
    return np.array([by_month.get(int(m), overall) for m in test_months], dtype=int)


def accuracy(predicted: np.ndarray, actual: np.ndarray) -> float:
    return float((predicted == actual).mean())


def macro_f1(predicted: np.ndarray, actual: np.ndarray) -> float:
    return float(
        f1_score(
            actual,
            predicted,
            labels=list(range(len(CLASSES))),
            average="macro",
            zero_division=0,  # pyright: ignore[reportArgumentType]
        )
    )


def nearest_point(
    station: dict[str, Any], points: dict[str, dict[str, Any]]
) -> tuple[str, float]:
    """離測站最近的核心點位與距離（km）。"""
    best = min(
        points,
        key=lambda key: haversine_km(
            station["lat"], station["lon"], points[key]["lat"], points[key]["lon"]
        ),
    )
    return best, haversine_km(
        station["lat"], station["lon"], points[best]["lat"], points[best]["lon"]
    )


def _to_array(values: list[float | None]) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=float)


def load_pairs(
    model_vs_obs: dict[str, Any], points: dict[str, dict[str, Any]], params: GapParams
) -> list[Pair]:
    pairs = []
    for item in model_vs_obs["pairs"]:
        if (
            item["group"] != params.group
            or item["model"]["variable_id"] not in params.model_variables
        ):
            continue
        monthly = item["monthly"]
        first = cleaning.month_index(monthly["first_month"])
        model = _to_array(monthly["model_anomaly"])
        point, distance = nearest_point(
            model_vs_obs["locations"][item["location_id"]], points
        )
        pairs.append(
            Pair(
                pair_id=item["pair_id"],
                model_variable=item["model"]["variable_id"],
                station=item["location_id"],
                index=np.arange(first, first + model.size, dtype=np.int64),
                model=model,
                obs=_to_array(monthly["obs_anomaly"]),
                context_point=point,
                context_distance_km=distance,
            )
        )
    return sorted(pairs, key=lambda p: (p.station, p.model_variable))


def load_context(
    anomalies: dict[str, Any], variables: list[str], points: list[str]
) -> dict[tuple[str, str], tuple[np.ndarray, np.ndarray]]:
    """(變數, 點位) → (月序, 距平)。"""
    out = {}
    for variable in variables:
        for point in points:
            entry = anomalies["series"].get(f"{variable}__{point}__point")
            if entry is None:
                continue
            first = cleaning.month_index(entry["first_month"])
            values = _to_array(entry["values"])
            out[(variable, point)] = (
                np.arange(first, first + values.size, dtype=np.int64),
                values,
            )
    return out


def context_variables(
    anomalies: dict[str, Any],
    core_paths: dict[str, str],
    points: list[str],
    params: GapParams,
) -> tuple[list[str], list[str]]:
    """回傳 (當特徵的環境變數, 排除的溫度類變數)：在全部點位都有點位序列的核心變數。"""
    present = sorted(
        {
            entry["variable_id"]
            for entry in anomalies["series"].values()
            if entry["aggregation"] == "point"
        }
    )
    complete = [
        v
        for v in present
        if all(f"{v}__{p}__point" in anomalies["series"] for p in points)
    ]
    excluded = [
        v
        for v in complete
        if params.excluded_category_keyword in core_paths.get(v, "unclassified")
    ]
    return [v for v in complete if v not in excluded], excluded


def describe(pairs: list[Pair], breaks: list[int], params: GapParams) -> dict[str, Any]:
    """差值絕對值的分組平均、月數與以年為單位重抽的區間。"""

    def stat(values: np.ndarray, years: np.ndarray) -> dict[str, Any]:
        low, high = block_bootstrap_mean(
            values,
            years,
            params.bootstrap_resamples,
            params.bootstrap_seed,
            params.alpha,
        )
        return {
            "n_months": int(values.size),
            "mean_abs_difference": float(values.mean()),
            "median_abs_difference": float(np.median(values)),
            "ci": [low, high],
        }

    rows: dict[str, list[tuple[str, str, float, int]]] = {
        "by_product": [],
        "by_product_season": [],
        "by_product_segment": [],
        "by_product_station": [],
    }
    for pair in pairs:
        gap = np.abs(pair.model - pair.obs)
        for month, value in zip(pair.index, gap, strict=True):
            if np.isnan(value):
                continue
            m, year = int(month), int(month) // 12
            product = pair.model_variable
            rows["by_product"].append((product, "all", float(value), year))
            rows["by_product_season"].append(
                (product, season_of(m), float(value), year)
            )
            rows["by_product_segment"].append(
                (product, str(segment_of(m, breaks)), float(value), year)
            )
            rows["by_product_station"].append(
                (product, pair.station, float(value), year)
            )
    out: dict[str, Any] = {}
    for name, items in rows.items():
        keys = sorted({(product, group) for product, group, _, _ in items})
        if name == "by_product_season":
            keys.sort(key=lambda key: (key[0], SEASONS.index(key[1])))
        out[name] = [
            {
                "model": product,
                "group": group,
                **stat(
                    np.array([v for p, g, v, _ in items if (p, g) == (product, group)]),
                    np.array([y for p, g, _, y in items if (p, g) == (product, group)]),
                ),
            }
            for product, group in keys
        ]
    return out


@dataclass(frozen=True)
class Variant:
    name: str
    include_segment: bool
    include_target_lag: bool
    note: str


VARIANTS = (
    Variant(
        "with_segment",
        True,
        False,
        "Main run: includes the GLDAS segment number, no previous-month target.",
    ),
    Variant(
        "without_segment",
        False,
        False,
        "Same as the main run without the GLDAS segment number.",
    ),
    Variant(
        "with_target_lag",
        True,
        True,
        "Reference only: also uses the pair's own class of the previous month, "
        "which is the target predicting itself.",
    ),
)


def build_rows(
    pairs: list[Pair],
    context: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]],
    variables: list[str],
    breaks: list[int],
    params: GapParams,
    variant: Variant,
    *,
    train_months: set[int] | None,
    train_stations: set[str] | None,
    with_station: bool,
) -> dict[str, Any]:
    """一折的列：特徵矩陣、類別、月份、測站、上個月的類別。

    `train_months` 給定時（走動驗證）每條序列只用這些月份估計置中、趨勢與門檻；None 時（留一
    地點）用序列自己的全部月份。目標的門檻用訓練列：走動驗證是訓練月份，留一地點是
    `train_stations` 的列。
    """
    stations = sorted({p.station for p in pairs})
    features = ["calendar_month", "model_is_gldas"]
    if variant.include_segment:
        features.append(SEGMENT)
    if with_station:
        features += [f"station:{s}" for s in stations]
    features += [f"ctx:{v}" for v in variables] + ["obs_state"]
    if variant.include_target_lag:
        features.append(TARGET_LAG)

    prepared = []
    for pair in pairs:
        train = (
            np.array([int(i) in train_months for i in pair.index])
            if train_months is not None
            else np.ones(pair.index.shape, dtype=bool)
        )
        difference = recenter(pair.index, pair.model, train) - recenter(
            pair.index, pair.obs, train
        )
        gap = np.abs(difference)
        lookup = {}
        for variable in variables:
            ctx_index, ctx_values = context[(variable, pair.context_point)]
            ctx_train = (
                np.array([int(i) in train_months for i in ctx_index])
                if train_months is not None
                else np.ones(ctx_index.shape, dtype=bool)
            )
            states = fold_states(ctx_index, ctx_values, ctx_train, params)
            lookup[variable] = dict(
                zip(ctx_index.tolist(), states.tolist(), strict=True)
            )
        prepared.append(
            (pair, train, gap, fold_states(pair.index, pair.obs, train, params), lookup)
        )

    pooled = np.concatenate(
        [
            gap[train & ~np.isnan(gap)]
            for pair, train, gap, _, _ in prepared
            if train_stations is None or pair.station in train_stations
        ]
    )
    low, high = class_thresholds(pooled, params.low_quantile, params.high_quantile)

    x, y, months, row_station, previous, row_pair = [], [], [], [], [], []
    dropped = {"no_previous_month": 0, "missing_feature": 0}
    for pair, _, gap, obs_states, lookup in prepared:
        labels = classify(gap, low, high)
        for position, month in enumerate(pair.index.tolist()):
            if labels[position] < 0:
                continue
            if position == 0 or labels[position - 1] < 0:
                dropped["no_previous_month"] += 1
                continue
            ctx = [lookup[v].get(month, np.nan) for v in variables]
            if np.isnan(obs_states[position]) or any(np.isnan(v) for v in ctx):
                dropped["missing_feature"] += 1
                continue
            is_gldas = pair.model_variable == "gldas_tair"
            row = [month % 12 + 1, int(is_gldas)]
            if variant.include_segment:
                row.append(segment_of(month, breaks) if is_gldas else 0)
            if with_station:
                row += [int(pair.station == s) for s in stations]
            row += [*ctx, obs_states[position]]
            if variant.include_target_lag:
                row.append(int(labels[position - 1]))
            x.append(row)
            y.append(int(labels[position]))
            months.append(month)
            row_station.append(pair.station)
            previous.append(int(labels[position - 1]))
            row_pair.append(pair.pair_id)
    return {
        "features": features,
        "x": np.array(x, dtype=float),
        "y": np.array(y, dtype=int),
        "months": np.array(months, dtype=np.int64),
        "stations": np.array(row_station),
        "previous": np.array(previous, dtype=int),
        "pairs": np.array(row_pair),
        "thresholds": {"low": low, "high": high},
        "dropped": dropped,
    }


def evaluate_fold(
    rows: dict[str, Any],
    train: np.ndarray,
    test: np.ndarray,
    params: GapParams,
    *,
    allow_target_lag: bool,
    temperature_variables: set[str],
) -> dict[str, Any]:
    """訓練一棵樹並回報測試列的準確率、macro-F1、混淆矩陣、基準與特徵重要度。"""
    features: list[str] = rows["features"]
    x_train, y_train = rows["x"][train], rows["y"][train]
    x_test, y_test = rows["x"][test], rows["y"][test]
    check_feature_names(
        features,
        allow_target_lag=allow_target_lag,
        temperature_variables=temperature_variables,
    )
    check_single_feature_leak(x_train, y_train, features, params)
    model = DecisionTreeClassifier(
        max_depth=params.tree_max_depth,
        min_samples_leaf=params.tree_min_samples_leaf,
        random_state=params.tree_random_state,
    )
    model.fit(x_train, y_train)
    predicted = model.predict(x_test)
    calendar = features.index("calendar_month")
    baseline_predictions = {
        "train_majority": np.full(y_test.shape, majority(y_train)),
        "persistence": rows["previous"][test],
        "calendar_month": calendar_month_prediction(
            x_train[:, calendar], y_train, x_test[:, calendar]
        ),
    }
    baselines: dict[str, Any] = {
        name: {
            "test_accuracy": accuracy(values, y_test),
            "macro_f1": macro_f1(values, y_test),
        }
        for name, values in baseline_predictions.items()
    }
    baselines["train_majority"]["predicted_class"] = CLASSES[majority(y_train)]
    test_accuracy = accuracy(predicted, y_test)
    above = {
        f"above_{name}": test_accuracy > item["test_accuracy"]
        for name, item in baselines.items()
    }
    hindsight = majority(y_test)
    tree = _tree_nodes(model, features)
    # _tree_nodes 的類別是 0／1／2 的字串；換成名稱
    tree = _rename_classes(tree)
    return {
        "n_train": int(train.sum()),
        "n_test": int(test.sum()),
        "class_counts": {
            part: {name: int((labels == k).sum()) for k, name in enumerate(CLASSES)}
            for part, labels in (("train", y_train), ("test", y_test))
        },
        "target_thresholds": rows["thresholds"],
        "accuracy": {
            "train": accuracy(model.predict(x_train), y_train),
            "test": test_accuracy,
        },
        "macro_f1": {"test": macro_f1(predicted, y_test)},
        "baselines": baselines,
        "hindsight_test_majority": {
            "predicted_class": CLASSES[hindsight],
            "test_accuracy": float((y_test == hindsight).mean()),
        },
        **above,
        "above_all_baselines": all(above.values()),
        "confusion_matrix_test": {
            actual: {
                guess: int(((y_test == a) & (predicted == g)).sum())
                for g, guess in enumerate(CLASSES)
            }
            for a, actual in enumerate(CLASSES)
        },
        "feature_importances": [
            {"feature": name, "importance": float(value)}
            for name, value in sorted(
                zip(features, model.feature_importances_, strict=True),
                key=lambda item: (-item[1], item[0]),
            )
        ],
        "tree": tree,
        "tree_text": tree_text(tree),
    }


def _rename_classes(node: dict[str, Any]) -> dict[str, Any]:
    out = dict(node)
    out["class_counts"] = {
        CLASSES[int(key)]: value for key, value in node["class_counts"].items()
    }
    out["predicted_class"] = CLASSES[int(node["predicted_class"])]
    if "left" in node:
        out["left"] = _rename_classes(node["left"])
        out["right"] = _rename_classes(node["right"])
    return out


def importance_stability(folds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """每個特徵在各折的重要度：平均、最小、最大、幾折大於 0、幾折是第一名。"""
    names = sorted(
        {item["feature"] for f in folds for item in f["feature_importances"]}
    )
    out = []
    for name in names:
        values = [
            next(
                (
                    i["importance"]
                    for i in f["feature_importances"]
                    if i["feature"] == name
                ),
                0.0,
            )
            for f in folds
        ]
        out.append(
            {
                "feature": name,
                "mean": float(np.mean(values)),
                "min": float(np.min(values)),
                "max": float(np.max(values)),
                "n_folds_used": sum(1 for v in values if v > 0),
                "n_folds_top": sum(
                    1
                    for f in folds
                    if f["feature_importances"][0]["feature"] == name
                    and f["feature_importances"][0]["importance"] > 0
                ),
            }
        )
    return sorted(out, key=lambda item: (-item["mean"], item["feature"]))


def summarize(folds: list[dict[str, Any]], unit: str) -> dict[str, Any]:
    n = len(folds)
    counts = {
        name: sum(1 for f in folds if f[f"above_{name}"])
        for name in ("train_majority", "persistence", "calendar_month")
    }
    n_all = sum(1 for f in folds if f["above_all_baselines"])
    text = (
        f"The tree's test accuracy is above all three baselines in {n_all} of {n} "
        f"{unit} (above the training-majority guess in {counts['train_majority']}, "
        f"above the previous-month persistence guess in {counts['persistence']}, "
        f"above the calendar-month guess in {counts['calendar_month']})."
    )
    if n_all < n:
        text += (
            f" In {n - n_all} of {n} {unit} the tree does not beat at least one "
            "guess that uses no other variable."
        )
    return {
        "n_folds": n,
        "n_folds_above_all": n_all,
        **{f"n_folds_above_{name}": value for name, value in counts.items()},
        "mean_test_accuracy": float(np.mean([f["accuracy"]["test"] for f in folds])),
        "mean_macro_f1": float(np.mean([f["macro_f1"]["test"] for f in folds])),
        **{
            f"mean_{name}_accuracy": float(
                np.mean([f["baselines"][name]["test_accuracy"] for f in folds])
            )
            for name in counts
        },
        "text_en": text,
    }


def run_variant(
    pairs: list[Pair],
    context: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]],
    variables: list[str],
    temperature_variables: set[str],
    breaks: list[int],
    params: GapParams,
    variant: Variant,
) -> dict[str, Any]:
    common = {
        "allow_target_lag": variant.include_target_lag,
        "temperature_variables": temperature_variables,
    }
    # 走動驗證：先用全部月份建一次列，只為了知道有哪些月份可用
    probe = build_rows(
        pairs,
        context,
        variables,
        breaks,
        params,
        variant,
        train_months=None,
        train_stations=None,
        with_station=True,
    )
    walk = []
    for number, (train_months, test_months) in enumerate(
        walk_forward_folds(
            probe["months"].tolist(), params.tree_n_folds, params.tree_min_train_months
        ),
        start=1,
    ):
        rows = build_rows(
            pairs,
            context,
            variables,
            breaks,
            params,
            variant,
            train_months=set(train_months),
            train_stations=None,
            with_station=True,
        )
        train = np.isin(rows["months"], train_months)
        test = np.isin(rows["months"], test_months)
        walk.append(
            {
                "fold": number,
                "train_first_month": index_month(train_months[0]),
                "train_last_month": index_month(train_months[-1]),
                "test_first_month": index_month(test_months[0]),
                "test_last_month": index_month(test_months[-1]),
                "n_train_months": len(train_months),
                "n_test_months": len(test_months),
                **evaluate_fold(rows, train, test, params, **common),
            }
        )
    stations = sorted({p.station for p in pairs})
    held_out = []
    for number, station in enumerate(stations, start=1):
        rows = build_rows(
            pairs,
            context,
            variables,
            breaks,
            params,
            variant,
            train_months=None,
            train_stations={s for s in stations if s != station},
            with_station=False,
        )
        test = rows["stations"] == station
        held_out.append(
            {
                "fold": number,
                "held_out_station": station,
                "models_at_station": sorted(
                    {p.model_variable for p in pairs if p.station == station}
                ),
                **evaluate_fold(rows, ~test, test, params, **common),
            }
        )
    return {
        "note": variant.note,
        "include_segment": variant.include_segment,
        "include_target_lag": variant.include_target_lag,
        "n_rows": int(probe["y"].size),
        "rows_dropped": probe["dropped"],
        "rows_by_pair": {
            pair.pair_id: int((probe["pairs"] == pair.pair_id).sum()) for pair in pairs
        },
        "first_month": index_month(int(probe["months"].min())),
        "last_month": index_month(int(probe["months"].max())),
        "walk_forward": {
            "features": build_feature_list(walk),
            "folds": walk,
            "summary": summarize(walk, "folds"),
            "importance_stability": importance_stability(walk),
        },
        "leave_one_location_out": {
            "features": build_feature_list(held_out),
            "folds": held_out,
            "summary": summarize(held_out, "held-out stations"),
            "importance_stability": importance_stability(held_out),
        },
    }


def build_feature_list(folds: list[dict[str, Any]]) -> list[str]:
    return sorted(item["feature"] for item in folds[0]["feature_importances"])


def run(
    model_vs_obs: dict[str, Any],
    anomalies: dict[str, Any],
    trends: dict[str, Any],
    core_paths: dict[str, str],
    catalog: dict[str, Any],
    params: GapParams,
) -> dict[str, Any]:
    point_ids = sorted(
        {
            entry["location_id"]
            for entry in anomalies["series"].values()
            if entry["aggregation"] == "point"
        }
    )
    points = {
        loc["id"]: {"lat": loc["lat"], "lon": loc["lon"]}
        for loc in catalog["locations"]
        if loc["id"] in point_ids
    }
    pairs = load_pairs(model_vs_obs, points, params)
    variables, excluded = context_variables(anomalies, core_paths, point_ids, params)
    context = load_context(anomalies, variables, point_ids)
    breaks = sorted(
        cleaning.month_index(month)
        for issue in trends.get("known_issues", {}).values()
        if issue.get("variable_id") == "gldas_tair"
        for month in issue.get("break_months", [])
    )
    temperature = {
        v for v, path in core_paths.items() if params.excluded_category_keyword in path
    }
    variants = {
        variant.name: run_variant(
            pairs, context, variables, temperature, breaks, params, variant
        )
        for variant in VARIANTS
    }
    names = {v["id"]: v["name_en"] for v in catalog["variables"]}
    result = {
        "schema_version": SCHEMA_VERSION,
        "exploratory": True,
        "note": NOTE,
        "input": {
            "model_vs_obs": "data/analysis/model_vs_obs.json",
            "anomalies": "data/analysis/anomalies.json",
            "snapshot_generated_at": anomalies["input"].get("snapshot_generated_at"),
        },
        "parameters": asdict(params),
        "packages": {name: version(name) for name in PACKAGES},
        "methods": {
            "target": (
                "absolute value of (model anomaly minus station anomaly) for each "
                "month, in three classes (small, medium, large) cut at the 1/3 and "
                "2/3 quantiles of the training rows of all pairs together; the test "
                "rows use the same cut points"
            ),
            "features": (
                "calendar month; model product; GLDAS segment number (GLDAS pairs "
                "only, 0 for MERRA-2 pairs; segments start at the documented step "
                "months of gldas_tair); station (one-hot, not used when a station "
                "is held out); the state (-1 low, 0 normal, 1 high) of the detrended "
                "anomaly of each non-temperature variable at the nearest core point "
                "in the same month; the state of the station's own anomaly"
            ),
            "not_used": (
                "the model anomaly, the station anomaly and their difference as "
                "numbers; temperature variables (same quantity as the target); the "
                "pair's own class of the previous month (used only in the variant "
                "with_target_lag); power_t2m (it serves MERRA-2 fields)"
            ),
            "walk_forward": (
                "months in time order; the first tree_min_train_months months are "
                "training only, the rest is cut into tree_n_folds test folds; each "
                "fold trains on all earlier months. Calendar-month means, linear "
                "trends and all cut points are estimated from the training months "
                "only"
            ),
            "leave_one_location_out": (
                "train on the other stations, test on the held-out station; "
                "training and test rows cover the same months, so this checks a "
                "new place, not the future. Each series is centred and cut on its "
                "own full record; the target cut points use the training stations"
            ),
            "baselines": (
                "train_majority: always the most frequent class of the training "
                "rows; persistence: the pair's class of the previous month; "
                "calendar_month: the most frequent training class of that calendar "
                "month. hindsight_test_majority is known only after the test "
                "period and is not counted in above_all_baselines"
            ),
            "descriptive": (
                "mean absolute difference by group with a 95% interval from a "
                "bootstrap that resamples whole calendar years; anomalies are the "
                "ones in model_vs_obs.json (monthly climatology of the common "
                "months)"
            ),
        },
        "leakage_guards": [
            (
                "feature names are checked: components of the target, temperature "
                "variables and the target's own lag are rejected"
            ),
            (
                "any single feature that classifies more than "
                "max_single_feature_accuracy of the training rows on its own stops the run"
            ),
            (
                "walk-forward folds re-estimate centring, trend and cut points from "
                "the training months only"
            ),
        ],
        "classes": list(CLASSES),
        "gldas_break_months": [index_month(b) for b in breaks],
        "segments": [
            {
                "segment": number + 1,
                "first_month": index_month(start) if start is not None else None,
            }
            for number, start in enumerate([None, *breaks])
        ],
        "pairs": [
            {
                "pair_id": pair.pair_id,
                "model": pair.model_variable,
                "station": pair.station,
                "station_name_en": model_vs_obs["locations"][pair.station]["name_en"],
                "n_months": int((~np.isnan(pair.model - pair.obs)).sum()),
                "context_point": pair.context_point,
                "context_distance_km": round(pair.context_distance_km, 1),
            }
            for pair in pairs
        ],
        "context_variables": variables,
        "excluded_temperature_variables": excluded,
        "variable_names": {
            v: names.get(v, v) for v in [*variables, *params.model_variables]
        },
        "descriptive": describe(pairs, breaks, params),
        "primary_variant": VARIANTS[0].name,
        "variants_run": [v.name for v in VARIANTS],
        "variants": variants,
    }
    return _round(result)


def run_summary(result: dict[str, Any]) -> dict[str, Any]:
    return {
        name: {
            validation: {
                **{
                    k: v
                    for k, v in variant[validation]["summary"].items()
                    if k != "text_en"
                },
                "folds": [
                    {
                        "fold": f["fold"],
                        "n_train": f["n_train"],
                        "n_test": f["n_test"],
                        "test_accuracy": f["accuracy"]["test"],
                        **{
                            f"{b}_accuracy": f["baselines"][b]["test_accuracy"]
                            for b in ("train_majority", "persistence", "calendar_month")
                        },
                    }
                    for f in variant[validation]["folds"]
                ],
            }
            for validation in ("walk_forward", "leave_one_location_out")
        }
        for name, variant in result["variants"].items()
    }


def write_database(
    env_file: Path, result: dict[str, Any], started: datetime
) -> dict[str, int]:
    """把各折與描述統計寫回 `analysis.gap_tree_folds`、`analysis.gap_stats`（整批換新）。"""
    from psycopg.types.json import Jsonb

    from trend_detective import pg

    with pg.connect(env_file) as conn:
        conn.execute(pg._sql(MIGRATION.read_text(encoding="utf-8")))
        conn.execute("TRUNCATE analysis.gap_tree_folds, analysis.gap_stats")
        counts = {
            "analysis.gap_tree_folds": sum(
                len(variant[validation]["folds"])
                for variant in result["variants"].values()
                for validation in VALIDATIONS
            ),
            "analysis.gap_stats": sum(len(v) for v in result["descriptive"].values()),
        }
        run_id = pg.record_run(conn, "gap_tree", started, result["parameters"], counts)
        with conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO analysis.gap_tree_folds VALUES"
                " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        run_id,
                        name,
                        validation,
                        fold["fold"],
                        fold.get("held_out_station"),
                        fold.get("test_first_month"),
                        fold.get("test_last_month"),
                        fold["n_train"],
                        fold["n_test"],
                        fold["accuracy"]["test"],
                        fold["macro_f1"]["test"],
                        fold["baselines"]["train_majority"]["test_accuracy"],
                        fold["baselines"]["persistence"]["test_accuracy"],
                        fold["baselines"]["calendar_month"]["test_accuracy"],
                        fold["above_all_baselines"],
                        Jsonb(fold["tree"]),
                    )
                    for name, variant in result["variants"].items()
                    for validation in VALIDATIONS
                    for fold in variant[validation]["folds"]
                ],
            )
            cursor.executemany(
                "INSERT INTO analysis.gap_stats VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        run_id,
                        grouping,
                        row["model"],
                        row["group"],
                        row["n_months"],
                        row["mean_abs_difference"],
                        row["median_abs_difference"],
                        row["ci"][0],
                        row["ci"][1],
                    )
                    for grouping, rows in result["descriptive"].items()
                    for row in rows
                ],
            )
        conn.commit()
    return counts


def main(argv: list[str] | None = None) -> int:
    started = datetime.now(UTC)
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    parser.add_argument("--snapshot-dir", type=Path, default=Path("data/snapshot"))
    parser.add_argument("--taxonomy-file", type=Path, default=taxonomy.TAXONOMY_SEED)
    parser.add_argument(
        "--write-db",
        action="store_true",
        help="另把結果寫回 analysis.gap_tree_folds、analysis.gap_stats（需要清洗資料庫）",
    )
    parser.add_argument("--env-file", type=Path, default=None)
    args = parser.parse_args(argv)

    def read(path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    anomalies = read(args.analysis_dir / "anomalies.json")
    result = run(
        read(args.analysis_dir / "model_vs_obs.json"),
        anomalies,
        read(args.analysis_dir / "trends.json"),
        read(args.taxonomy_file)["core"],
        read(args.snapshot_dir / "catalog.json"),
        GapParams(),
    )
    _dump(args.analysis_dir / "gap_tree.json", result)
    _dump(
        args.analysis_dir / "gap_tree.run.json",
        {
            "command": "uv run python -m trend_detective.gap_tree",
            "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "exploratory": True,
            "input": result["input"],
            "parameters": result["parameters"],
            "variants_run": result["variants_run"],
            "packages": result["packages"],
            "outputs": ["gap_tree.json"],
            "summary": run_summary(result),
        },
    )
    if args.write_db:
        from trend_detective import pg

        print(write_database(args.env_file or pg.ENV_FILE, result, started))
    for name, variant in result["variants"].items():
        for validation in VALIDATIONS:
            print(name, validation, variant[validation]["summary"]["text_en"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
