"""清洗月序列（#83）：品質旗標、缺月骨架、月距平與補值。純函式，不連資料庫。

規則是資料：門檻與已查證的資料問題都在 `data/seed/cleaning.json`（`rules`、`known_issues`），
PostgreSQL 的 `meta.cleaning_rules`、`meta.known_issues` 由同一個檔載入。這個模組同時給
`trend_detective.pg clean`（把結果寫進 `clean.observations`）與趨勢統計、資料探勘使用，所以沒有
資料庫的機器也能算出同一份結果。

一條序列的清洗結果是「第一個到最後一個有列的月份」之間逐月的骨架，每個月一列：

- `value_raw`：序列檔裡的值，永遠不改；骨架有、序列檔沒有的月份是 NaN。
- `qc_flag`：下面旗標裡優先序最高的一個；`qc_flags` 是全部成立的旗標。
    missing             序列檔沒有這個月，或值是 null
    partial_month       這個月在取得資料時（序列的 `retrieved_at`）還沒過完
    low_coverage        `coverage` 低於 `min_coverage`
    outlier_suspect     去季節距平的穩健 z 分數（以中位數與 MAD 計）絕對值超過 `outlier_z`；只標記
    known_discontinuity 落在 `known_issues` 裡 `flag_months = true` 的期間；只標記
    ok                  以上都不成立
- `value_clean`：`missing`、`partial_month`、`low_coverage` 的月份是 NaN，其餘等於 `value_raw`。
- `anomaly`：`value_clean` 減去同一條序列、同一個月份（1 至 12 月）所有可用年份的平均；與
  `trends.prepare` 的月距平是同一個算法。
- `anomaly_filled`、`fill_method`：只給資料探勘用（見下）。

缺值政策：

a. 趨勢檢定不補值，用 `value_clean`。補值會人為提高自相關、壓低變異，使檢定偏樂觀。
b. 資料探勘需要完整的月份表，在距平上補：連續缺不超過 `max_linear_gap_months` 個月用前後兩個
   可用月份的距平線性內插（`fill_method = "linear"`）；更長的缺口補距平 0，也就是月氣候值
   （`"climatology"`）；第一個可用月份之前、最後一個之後不外推。不用「前一個月的值直接帶入」，
   那會製造假的持續性。補值比例超過 `max_fill_fraction` 的序列不進探勘表。
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

CLEANING_SEED = Path("data/seed/cleaning.json")

FLAG_MISSING = "missing"
FLAG_PARTIAL = "partial_month"
FLAG_LOW_COVERAGE = "low_coverage"
FLAG_OUTLIER = "outlier_suspect"
FLAG_DISCONTINUITY = "known_discontinuity"
FLAG_OK = "ok"
# 優先序由高到低；`qc_flag` 取第一個成立的
FLAGS = (
    FLAG_MISSING,
    FLAG_PARTIAL,
    FLAG_LOW_COVERAGE,
    FLAG_OUTLIER,
    FLAG_DISCONTINUITY,
    FLAG_OK,
)
# 這些旗標的月份不可用：`value_clean` 是 NaN
UNUSABLE_FLAGS = (FLAG_MISSING, FLAG_PARTIAL, FLAG_LOW_COVERAGE)

FILL_LINEAR = "linear"
FILL_CLIMATOLOGY = "climatology"

KIND_AUXILIARY = "auxiliary"
# MAD 換成常態分布標準差的係數（0.6745 = 標準常態的第三四分位數）
MAD_TO_SIGMA = 0.6745


@dataclass(frozen=True)
class CleaningRules:
    """門檻；預設值與 `data/seed/cleaning.json` 相同，實際執行以 seed 為準。"""

    min_coverage: float = 0.25
    outlier_z: float = 5.0
    max_linear_gap_months: int = 2
    max_fill_fraction: float = 0.2


@dataclass(frozen=True)
class KnownIssue:
    """一筆已查證的資料問題。`variable_id` 是完全相符，`variable_pattern` 是正規表示式。"""

    id: str
    kind: str
    summary_en: str
    source_doc: str
    variable_id: str | None = None
    variable_pattern: str | None = None
    # 只適用某一種聚合方式（例如只有點位序列）；None 是全部
    aggregation: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    flag_months: bool = False
    issue_ref: str | None = None
    # 已查證的跳變月份（新的一段從這個月開始）；資料探勘的分段距平用（#85）
    break_months: tuple[str, ...] | None = None

    def matches(self, variable_id: str, aggregation: str | None = None) -> bool:
        if self.aggregation is not None and aggregation != self.aggregation:
            return False
        if self.variable_id is not None:
            return self.variable_id == variable_id
        if self.variable_pattern is not None:
            return re.search(self.variable_pattern, variable_id) is not None
        return False


def load_seed(path: Path = CLEANING_SEED) -> tuple[CleaningRules, list[KnownIssue]]:
    content = json.loads(path.read_text(encoding="utf-8"))
    rules = CleaningRules(**content["rules"])
    issues = [
        KnownIssue(
            **{
                **item,
                "break_months": tuple(item["break_months"])
                if item.get("break_months")
                else None,
            }
        )
        for item in content["known_issues"]
    ]
    return rules, issues


def issues_for(
    variable_id: str, issues: list[KnownIssue], aggregation: str | None = None
) -> list[KnownIssue]:
    return [issue for issue in issues if issue.matches(variable_id, aggregation)]


def is_auxiliary(variable_id: str, issues: list[KnownIssue]) -> bool:
    return any(i.kind == KIND_AUXILIARY for i in issues_for(variable_id, issues))


DATA_KIND_SEED = Path("data/seed/data_kinds.json")
DATA_KINDS = ("in_situ", "satellite_retrieval", "model", "unknown")


def load_data_kind_rules(path: Path = DATA_KIND_SEED) -> list[dict[str, str]]:
    """變數屬於哪一類資料（現場實測、衛星反演、模式推算）的規則；依序比對，先符合的為準。"""
    return json.loads(path.read_text(encoding="utf-8"))["rules"]


def data_kind_for(
    variable: dict[str, Any], rules: list[dict[str, str]]
) -> tuple[str, str | None]:
    """回傳 (`data_kind`, 依據)。規則裡有的鍵都要符合；都不符合就是 `unknown`。"""
    variable_id = variable.get("id") or ""
    product = variable.get("product") or ""
    for rule in rules:
        if "variable_id" in rule and rule["variable_id"] != variable_id:
            continue
        if "variable_pattern" in rule and not re.search(
            rule["variable_pattern"], variable_id
        ):
            continue
        if "product_pattern" in rule and not re.search(
            rule["product_pattern"], product
        ):
            continue
        return rule["data_kind"], rule.get("note")
    return "unknown", None


def month_index(month: str) -> int:
    """`2004-10-01` → 2004 × 12 + 9（與 `trends.month_index` 相同）。"""
    return int(month[:4]) * 12 + int(month[5:7]) - 1


def index_month(index: int) -> str:
    return f"{index // 12:04d}-{index % 12 + 1:02d}-01"


def first_partial_index(retrieved_at: str | None) -> int | None:
    """取得資料時還沒過完的第一個月（就是取得當月）的月序；沒有取得時間就回 None。"""
    if not retrieved_at:
        return None
    return month_index(retrieved_at[:10])


def monthly_anomalies(index: np.ndarray, values: np.ndarray) -> np.ndarray:
    """每個月減去同一個月份所有非 NaN 值的平均；NaN 保持 NaN。"""
    anomalies = np.full(values.shape, np.nan)
    valid = ~np.isnan(values)
    for calendar_month in range(12):
        mask = valid & (index % 12 == calendar_month)
        if mask.any():
            anomalies[mask] = values[mask] - values[mask].mean()
    return anomalies


def robust_z(anomalies: np.ndarray) -> np.ndarray:
    """以中位數與 MAD 計的 z 分數；NaN 保持 NaN。MAD 是 0（或沒有值）時全部回 0。"""
    z = np.full(anomalies.shape, np.nan)
    valid = ~np.isnan(anomalies)
    if not valid.any():
        return z
    median = float(np.median(anomalies[valid]))
    mad = float(np.median(np.abs(anomalies[valid] - median)))
    if mad == 0:
        z[valid] = 0.0
        return z
    z[valid] = MAD_TO_SIGMA * (anomalies[valid] - median) / mad
    return z


def gap_runs(usable: np.ndarray) -> list[tuple[int, int]]:
    """第一個到最後一個可用月份之間，連續不可用月份的 (起點位置, 長度)。頭尾的不算缺口。"""
    positions = np.flatnonzero(usable)
    if positions.size == 0:
        return []
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for i in range(int(positions[0]), int(positions[-1]) + 1):
        if not usable[i]:
            if start is None:
                start = i
        elif start is not None:
            runs.append((start, i - start))
            start = None
    return runs


def fill_anomalies(
    anomalies: np.ndarray, max_linear_gap: int
) -> tuple[np.ndarray, list[str | None]]:
    """政策 b：在距平上補值。回傳 (補好的距平, 每個月的補值方法或 None)。

    短缺口（長度 ≤ `max_linear_gap`）在前後兩個可用月份之間線性內插；更長的缺口補 0（月氣候
    值）；第一個可用月份之前與最後一個之後保持 NaN。原本有值的月份不動。
    """
    filled = anomalies.astype(float).copy()
    methods: list[str | None] = [None] * anomalies.size
    for start, length in gap_runs(~np.isnan(anomalies)):
        stop = start + length
        if length <= max_linear_gap:
            before, after = filled[start - 1], anomalies[stop]
            for offset in range(length):
                weight = (offset + 1) / (length + 1)
                filled[start + offset] = before + (after - before) * weight
                methods[start + offset] = FILL_LINEAR
        else:
            filled[start:stop] = 0.0
            methods[start:stop] = [FILL_CLIMATOLOGY] * length
    return filled, methods


@dataclass(frozen=True)
class CleanedSeries:
    """一條序列逐月的清洗結果；陣列等長，位置 i 是月序 `first_index + i`。"""

    first_index: int
    in_source: np.ndarray
    value_raw: np.ndarray
    n_samples: list[int | None]
    coverage: np.ndarray
    qc_flag: list[str]
    qc_flags: list[tuple[str, ...]]
    value_clean: np.ndarray
    anomaly: np.ndarray
    anomaly_filled: np.ndarray
    fill_method: list[str | None]
    known_issue_ids: tuple[str, ...]
    auxiliary: bool

    @property
    def n_months(self) -> int:
        return int(self.value_raw.size)

    @property
    def index(self) -> np.ndarray:
        return self.first_index + np.arange(self.n_months)

    @property
    def months(self) -> list[str]:
        return [index_month(int(i)) for i in self.index]


def _empty(known: tuple[str, ...], auxiliary: bool) -> CleanedSeries:
    none = np.array([], dtype=float)
    return CleanedSeries(
        0, np.array([], dtype=bool), none, [], none, [], [], none, none, none, [],
        known, auxiliary,
    )  # fmt: skip


def clean_series(
    points: list[dict[str, Any]],
    *,
    variable_id: str,
    aggregation: str | None = None,
    retrieved_at: str | None,
    rules: CleaningRules,
    issues: list[KnownIssue],
) -> CleanedSeries:
    """把一條序列的 `points` 展成逐月骨架並加上旗標、距平與補值。"""
    matched = issues_for(variable_id, issues, aggregation)
    known = tuple(issue.id for issue in matched)
    auxiliary = any(issue.kind == KIND_AUXILIARY for issue in matched)
    if not points:
        return _empty(known, auxiliary)
    by_index = {month_index(point["month"]): point for point in points}
    first, last = min(by_index), max(by_index)
    n = last - first + 1
    index = first + np.arange(n)
    in_source = np.zeros(n, dtype=bool)
    value_raw = np.full(n, np.nan)
    coverage = np.full(n, np.nan)
    n_samples: list[int | None] = [None] * n
    for i, point in by_index.items():
        position = i - first
        in_source[position] = True
        if point.get("value") is not None:
            value_raw[position] = float(point["value"])
        if point.get("coverage") is not None:
            coverage[position] = float(point["coverage"])
        n_samples[position] = point.get("n_samples")

    missing = np.isnan(value_raw)
    partial_from = first_partial_index(retrieved_at)
    partial = (
        ~missing & (index >= partial_from)
        if partial_from is not None
        else np.zeros(n, dtype=bool)
    )
    with np.errstate(invalid="ignore"):
        low = ~missing & ~partial & (coverage < rules.min_coverage)
    usable = ~missing & ~partial & ~low
    value_clean = np.where(usable, value_raw, np.nan)
    anomaly = monthly_anomalies(index, value_clean)
    with np.errstate(invalid="ignore"):
        outlier = usable & (np.abs(robust_z(anomaly)) > rules.outlier_z)
    discontinuity = np.zeros(n, dtype=bool)
    for issue in matched:
        if not issue.flag_months or issue.period_start is None:
            continue
        start = month_index(issue.period_start)
        stop = month_index(issue.period_end or issue.period_start)
        discontinuity |= usable & (index >= start) & (index <= stop)

    masks = {
        FLAG_MISSING: missing,
        FLAG_PARTIAL: partial,
        FLAG_LOW_COVERAGE: low,
        FLAG_OUTLIER: outlier,
        FLAG_DISCONTINUITY: discontinuity,
    }
    qc_flags: list[tuple[str, ...]] = []
    for position in range(n):
        found = tuple(flag for flag, mask in masks.items() if mask[position])
        qc_flags.append(found or (FLAG_OK,))
    anomaly_filled, fill_method = fill_anomalies(anomaly, rules.max_linear_gap_months)
    return CleanedSeries(
        first_index=first,
        in_source=in_source,
        value_raw=value_raw,
        n_samples=n_samples,
        coverage=coverage,
        qc_flag=[flags[0] for flags in qc_flags],
        qc_flags=qc_flags,
        value_clean=value_clean,
        anomaly=anomaly,
        anomaly_filled=anomaly_filled,
        fill_method=fill_method,
        known_issue_ids=known,
        auxiliary=auxiliary,
    )


def clean_points(cleaned: CleanedSeries) -> list[dict[str, Any]]:
    """可用月份的 `[{month, value}]`（`value_clean` 不是 NaN 的月份），給趨勢統計當輸入。"""
    return [
        {"month": month, "value": float(value)}
        for month, value in zip(cleaned.months, cleaned.value_clean, strict=True)
        if not np.isnan(value)
    ]


def summarize(cleaned: CleanedSeries, rules: CleaningRules) -> dict[str, Any]:
    """一條序列的清洗摘要：總月數、各旗標數、補值數與方法、最長缺口。

    `n_by_flag` 依 `qc_flag`（優先序最高的旗標）計數，加總等於 `n_months`；`n_by_any_flag` 依
    `qc_flags` 計數，同一個月可以算進多個旗標。`fill_fraction` 的分母是第一個到最後一個可用月份
    之間的月數。
    """
    usable = ~np.isnan(cleaned.value_clean)
    runs = gap_runs(usable)
    positions = np.flatnonzero(usable)
    span = int(positions[-1] - positions[0] + 1) if positions.size else 0
    n_linear = sum(method == FILL_LINEAR for method in cleaned.fill_method)
    n_climatology = sum(method == FILL_CLIMATOLOGY for method in cleaned.fill_method)
    fill_fraction = (n_linear + n_climatology) / span if span else None
    return {
        "n_months": cleaned.n_months,
        "n_in_source": int(cleaned.in_source.sum()),
        "n_usable": int(usable.sum()),
        "first_usable_month": index_month(cleaned.first_index + int(positions[0]))
        if positions.size
        else None,
        "last_usable_month": index_month(cleaned.first_index + int(positions[-1]))
        if positions.size
        else None,
        "n_by_flag": {
            flag: sum(item == flag for item in cleaned.qc_flag) for flag in FLAGS
        },
        "n_by_any_flag": {
            flag: sum(flag in item for item in cleaned.qc_flags) for flag in FLAGS
        },
        "n_filled": n_linear + n_climatology,
        "n_filled_linear": n_linear,
        "n_filled_climatology": n_climatology,
        "n_gaps": len(runs),
        "longest_gap_months": max((length for _, length in runs), default=0),
        "fill_fraction": fill_fraction,
        "mining_eligible": bool(
            fill_fraction is not None and fill_fraction <= rules.max_fill_fraction
        ),
        "known_issues": list(cleaned.known_issue_ids),
        "auxiliary": cleaned.auxiliary,
    }
