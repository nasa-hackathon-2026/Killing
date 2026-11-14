"""趨勢統計（#55）：核心快照每條月序列的月距平、線性趨勢與 Mann-Kendall 家族檢定。

    uv run python -m trend_detective.trends

輸入是 `data/snapshot/`，輸出到 `data/analysis/`（都進 git，不連網）：

- `trends.json`：每條序列的統計結果，鍵是 `<變數>__<地點>__<聚合方式>`（與序列檔名相同）。
- `anomalies.json`：每條序列的月距平（從第一個可用月份起逐月排列，缺的月份是 null）。
- `trends.run.json`：執行紀錄（執行時間、輸入快照日、參數、套件版本）。

輸入先經過清洗（#83、#85；`trend_detective.cleaning`，規則與已知問題在 `data/seed/cleaning.json`）：
`missing`、`partial_month`（取得資料時還沒過完的月份）、`low_coverage` 的月份不用，其餘照用；
`outlier_suspect` 與 `known_discontinuity` 只標記。每條結果多帶 `cleaning`（各旗標的月數、最長
缺口）、`known_issues`（適用的已知問題 id，內容在結果檔最上層的 `known_issues`）與 `auxiliary`
（輔助變數）。統計方法沒有變。清洗是純函式，不需要資料庫；PostgreSQL 的 `clean.observations` 是
同一個函式算出來的。加 `--no-cleaning` 回到清洗前的輸入（只排除 null 與低覆蓋）。

方法（依據 resources repo 的 `docs/resources/trend-statistics.md`）：

1. 不補值。值是 null 的月份、`coverage` 低於 `min_coverage` 的月份、還沒過完的月份都排除並記數。
2. 月距平：每個月減去「同一條序列、同一個月份」所有可用年份的平均。
3. 線性趨勢：距平對時間（年）做最小平方法。斜率的標準誤用殘差的 lag-1 自相關 r1 修正：
   有效樣本數 n_eff = n(1 − r1)/(1 + r1)（Santer et al. 2000），上限 n、下限 3；
   修正後標準誤 = 原標準誤 × sqrt((n − 2)/(n_eff − 2))，t 檢定與 95% 信賴區間的自由度
   用 n_eff − 2。r1 只用「相鄰兩個月都有值」的殘差配對計算。
4. Mann-Kendall：原始版與 Hamed-Rao（1998）自相關修正版用距平；Seasonal MK 用原始月值
   （週期 12）。距平中間有缺月時，這兩個檢定把剩下的值依序相連（缺口被壓縮）。
5. Sen 斜率與信賴區間：`scipy.stats.theilslopes`，時間用真實的月份間隔；這個信賴區間
   假設各點獨立，沒有自相關修正。
6. 多重檢定：同一次執行裡所有有分析的序列，各檢定的 p 值分別做 Benjamini-Hochberg FDR。
   加 `--fdr-group aggregation` 時改成「同一種聚合方式的序列自成一組」各做一次（#68）。

擴充資料（#68，約 6,700 條，不進 git）用同一個指令、同一套方法：

    uv run python -m trend_detective.trends --snapshot-dir data/extended \
        --analysis-dir data/extended/analysis --fdr-group aggregation --no-anomalies --workers 12

結果檔多了 `fdr`（分組方式與各組的序列數）與 `summary_by_group`（各組的摘要）。

資料沒變時重跑，`trends.json` 與 `anomalies.json` 逐位元組相同（時間戳只在執行紀錄）。
"""

import argparse
import json
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
import pymannkendall as mk
from scipy import stats

from trend_detective import cleaning

SNAPSHOT_DIR = Path("data/snapshot")
ANALYSIS_DIR = Path("data/analysis")
SCHEMA_VERSION = 1
PACKAGES = ("numpy", "scipy", "pymannkendall")


@dataclass(frozen=True)
class TrendParams:
    """可調的參數；預設值會寫進結果檔。"""

    # 該月 coverage 低於這個值就排除。各來源的 coverage 定義不同（見 AGENTS.md），
    # 單一門檻只是簡化；0.25 約等於日資料一個月至少 8 天有值。
    min_coverage: float = 0.25
    # 可用月份少於這個數就不分析（10 年，Weatherhead et al. 1998 的實務下限）
    min_valid_months: int = 120
    # 第一個到最後一個可用月份之間，不可用月份的比例超過這個值就不分析
    max_missing_fraction: float = 0.2
    # 顯著水準；信賴區間是 1 − alpha
    alpha: float = 0.05
    # Hamed-Rao 修正要看幾個 lag 的自相關；None 是全部（原論文與套件的預設）
    hamed_rao_lags: int | None = None


@dataclass(frozen=True)
class Prepared:
    """一條序列排除不可用月份之後的樣子。`index` 是 年 × 12 + 月（從 0 起算的月序）。"""

    index: np.ndarray
    values: np.ndarray
    anomalies: np.ndarray
    n_points: int
    n_null: int
    n_low_coverage: int
    n_partial_month: int = 0

    @property
    def n_valid(self) -> int:
        return int(self.index.size)

    @property
    def span_months(self) -> int:
        return int(self.index[-1] - self.index[0] + 1) if self.index.size else 0

    @property
    def missing_fraction(self) -> float:
        return 1 - self.n_valid / self.span_months if self.span_months else 1.0


def month_index(month: str) -> int:
    """`2004-10-01` → 2004 × 12 + 9。"""
    return int(month[:4]) * 12 + int(month[5:7]) - 1


def index_month(index: int) -> str:
    return f"{index // 12:04d}-{index % 12 + 1:02d}-01"


def prepare(points: list[dict[str, Any]], params: TrendParams) -> Prepared:
    """排除缺值與低覆蓋月份，並算月距平（每月減該月份的多年平均）。"""
    n_null = 0
    n_low = 0
    kept: list[tuple[int, float]] = []
    for point in points:
        value = point.get("value")
        if value is None:
            n_null += 1
            continue
        coverage = point.get("coverage")
        if coverage is not None and coverage < params.min_coverage:
            n_low += 1
            continue
        kept.append((month_index(point["month"]), float(value)))
    kept.sort()
    index = np.array([item[0] for item in kept], dtype=int)
    values = np.array([item[1] for item in kept], dtype=float)
    anomalies = np.empty_like(values)
    for calendar_month in range(12):
        mask = index % 12 == calendar_month
        if mask.any():
            anomalies[mask] = values[mask] - values[mask].mean()
    return Prepared(index, values, anomalies, len(points), n_null, n_low)


def prepare_cleaned(cleaned: cleaning.CleanedSeries) -> Prepared:
    """清洗後的序列 → 可用月份（`value_clean` 有值）與月距平；計數沿用原本的欄位。"""
    usable = ~np.isnan(cleaned.value_clean)
    return Prepared(
        index=cleaned.index[usable].astype(int),
        values=cleaned.value_clean[usable],
        anomalies=cleaned.anomaly[usable],
        n_points=int(cleaned.in_source.sum()),
        n_null=int((cleaned.in_source & np.isnan(cleaned.value_raw)).sum()),
        n_low_coverage=cleaned.qc_flag.count(cleaning.FLAG_LOW_COVERAGE),
        n_partial_month=cleaned.qc_flag.count(cleaning.FLAG_PARTIAL),
    )


def lag1_autocorrelation(index: np.ndarray, residuals: np.ndarray) -> float:
    """相鄰月份（中間沒有缺月）的殘差配對的相關係數；配對不足或沒有變異時回 0。"""
    adjacent = np.diff(index) == 1
    first = residuals[:-1][adjacent]
    second = residuals[1:][adjacent]
    if first.size < 3 or np.ptp(first) == 0 or np.ptp(second) == 0:
        return 0.0
    return float(np.corrcoef(first, second)[0, 1])


def ols_trend(index: np.ndarray, anomalies: np.ndarray, alpha: float) -> dict[str, Any]:
    """最小平方法斜率、t 檢定與信賴區間；同時給未修正與 lag-1 自相關修正後的結果。"""
    years = (index - index[0]) / 12
    n = int(index.size)
    fit = stats.linregress(years, anomalies)
    slope = float(fit.slope)  # pyright: ignore[reportAttributeAccessIssue]
    intercept = float(fit.intercept)  # pyright: ignore[reportAttributeAccessIssue]
    stderr = float(fit.stderr)  # pyright: ignore[reportAttributeAccessIssue]
    p_raw = float(fit.pvalue)  # pyright: ignore[reportAttributeAccessIssue]
    residuals = anomalies - (intercept + slope * years)
    r1 = lag1_autocorrelation(index, residuals)
    n_eff = min(float(n), max(3.0, n * (1 - r1) / (1 + r1)))
    stderr_ar1 = stderr * math.sqrt((n - 2) / (n_eff - 2))
    dof = n_eff - 2
    if stderr_ar1 > 0:
        p_ar1 = float(2 * stats.t.sf(abs(slope / stderr_ar1), dof))
    else:
        p_ar1 = 0.0 if slope != 0 else 1.0
    half_raw = float(stats.t.ppf(1 - alpha / 2, n - 2)) * stderr
    half_ar1 = float(stats.t.ppf(1 - alpha / 2, dof)) * stderr_ar1
    return {
        "slope_per_decade": 10 * slope,
        "ci_per_decade": [10 * (slope - half_ar1), 10 * (slope + half_ar1)],
        "ci_per_decade_uncorrected": [
            10 * (slope - half_raw),
            10 * (slope + half_raw),
        ],
        "p_uncorrected": p_raw,
        "p": p_ar1,
        "lag1_autocorrelation": r1,
        "n_effective": n_eff,
    }


def _mk_result(result: Any) -> dict[str, Any]:
    p = float(result.p)
    if math.isnan(p):
        # Hamed-Rao 的修正變異數在少數序列會算成負值，z 與 p 無法計算
        return {
            "p": None,
            "z": None,
            "tau": float(result.Tau),
            "failed": "corrected variance is not positive",
        }
    return {"p": p, "z": float(result.z), "tau": float(result.Tau)}


def seasonal_grid(index: np.ndarray, values: np.ndarray) -> np.ndarray:
    """把值放回逐月的格子（從第一個可用月份起），缺的月份是 NaN。"""
    grid = np.full(int(index[-1] - index[0] + 1), np.nan)
    grid[index - index[0]] = values
    return grid


def mann_kendall(prepared: Prepared, params: TrendParams) -> dict[str, Any]:
    """原始 MK、Hamed-Rao 修正（距平），以及 Seasonal MK（原始月值，週期 12）。"""
    alpha = params.alpha
    original = mk.original_test(prepared.anomalies, alpha=alpha)
    with np.errstate(invalid="ignore"):
        hamed_rao = mk.hamed_rao_modification_test(
            prepared.anomalies, alpha=alpha, lag=params.hamed_rao_lags
        )
    seasonal = mk.seasonal_test(
        seasonal_grid(prepared.index, prepared.values), period=12, alpha=alpha
    )
    return {
        "original": _mk_result(original),
        "hamed_rao": _mk_result(hamed_rao),
        # seasonal_test 的斜率是各月份「隔一年」的 Sen 斜率中位數，單位是每年
        "seasonal": {
            **_mk_result(seasonal),
            "slope_per_decade": 10 * float(seasonal.slope),
        },
    }


def sen_slope(index: np.ndarray, anomalies: np.ndarray, alpha: float) -> dict[str, Any]:
    years = (index - index[0]) / 12
    result = stats.theilslopes(anomalies, years, alpha=1 - alpha)
    return {
        "slope_per_decade": 10 * float(result.slope),  # pyright: ignore[reportAttributeAccessIssue]
        "ci_per_decade": [
            10 * float(result.low_slope),  # pyright: ignore[reportAttributeAccessIssue]
            10 * float(result.high_slope),  # pyright: ignore[reportAttributeAccessIssue]
        ],
    }


def insufficient_reason(
    prepared: Prepared, params: TrendParams
) -> dict[str, str] | None:
    """不分析的原因（代碼給程式用，英文句子給網頁直接顯示）；可以分析就回 None。"""
    if prepared.n_valid < params.min_valid_months:
        return {
            "code": "too_few_months",
            "text_en": (
                f"Only {prepared.n_valid} usable months; at least "
                f"{params.min_valid_months} are needed."
            ),
        }
    if prepared.missing_fraction > params.max_missing_fraction:
        return {
            "code": "too_many_missing",
            "text_en": (
                f"{prepared.missing_fraction:.0%} of months between the first and "
                f"last usable month are missing or below the coverage threshold "
                f"(limit {params.max_missing_fraction:.0%})."
            ),
        }
    if np.ptp(prepared.anomalies) == 0:
        return {"code": "constant", "text_en": "All usable values are identical."}
    return None


def analyze_points(points: list[dict[str, Any]], params: TrendParams) -> dict[str, Any]:
    """一條序列的統計結果（還沒有 FDR；FDR 要整批一起算，見 `apply_fdr`）。"""
    return analyze_prepared(prepare(points, params), params)


def analyze_prepared(prepared: Prepared, params: TrendParams) -> dict[str, Any]:
    """`analyze_points` 的後半：輸入是已經排除不可用月份的序列。"""
    data: dict[str, Any] = {
        "first_month": index_month(int(prepared.index[0]))
        if prepared.n_valid
        else None,
        "last_month": index_month(int(prepared.index[-1]))
        if prepared.n_valid
        else None,
        "n_points": prepared.n_points,
        "n_valid": prepared.n_valid,
        "n_null": prepared.n_null,
        "n_low_coverage": prepared.n_low_coverage,
        "missing_fraction": prepared.missing_fraction if prepared.n_valid else None,
    }
    reason = insufficient_reason(prepared, params)
    if reason is not None:
        return {"status": "insufficient", "reason": reason, "data": data}
    return {
        "status": "analyzed",
        "reason": None,
        "data": data,
        "ols": ols_trend(prepared.index, prepared.anomalies, params.alpha),
        "mann_kendall": mann_kendall(prepared, params),
        "sen": sen_slope(prepared.index, prepared.anomalies, params.alpha),
    }


# 每個檢定的 p 值在結果裡的位置；FDR 對每一個分別做
TESTS: dict[str, tuple[str, ...]] = {
    "ols": ("ols",),
    "mk_original": ("mann_kendall", "original"),
    "mk_hamed_rao": ("mann_kendall", "hamed_rao"),
    "mk_seasonal": ("mann_kendall", "seasonal"),
}


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    """BH 校正後的 p 值（q 值），順序與輸入相同。"""
    if not p_values:
        return []
    return [float(q) for q in stats.false_discovery_control(p_values, method="bh")]


FDR_GROUPS = ("all", "aggregation")


def fdr_groups(
    results: dict[str, dict[str, Any]], group_by: str
) -> dict[str, list[str]]:
    """FDR 的分組：`all` 是整批一組；`aggregation` 是同一種聚合方式一組。"""
    if group_by not in FDR_GROUPS:
        raise ValueError(f"不認得的 FDR 分組方式：{group_by}")
    groups: dict[str, list[str]] = {}
    for key in sorted(results):
        name = "all" if group_by == "all" else results[key]["aggregation"]
        groups.setdefault(name, []).append(key)
    return dict(sorted(groups.items()))


def apply_fdr(
    results: dict[str, dict[str, Any]],
    alpha: float,
    groups: dict[str, list[str]] | None = None,
) -> None:
    """就地加上 `p_fdr`、`significant`、`significant_fdr`；只算有分析的序列。

    檢定算不出 p 值（`p` 是 None）的序列不列入該檢定的 FDR，三個欄位都是 None。
    `groups`（組名 → 序列鍵）有給時，每一組各自做 BH；沒給就是整批一組。
    """
    for group in (groups or {"all": list(results)}).values():
        _apply_fdr_to(results, sorted(group), alpha)


def _apply_fdr_to(
    results: dict[str, dict[str, Any]], group: list[str], alpha: float
) -> None:
    keys = [key for key in group if results[key]["status"] == "analyzed"]
    for path in TESTS.values():
        nodes = []
        for key in keys:
            node = results[key]
            for part in path:
                node = node[part]
            if node["p"] is None:
                node.update(p_fdr=None, significant=None, significant_fdr=None)
            else:
                nodes.append(node)
        adjusted = benjamini_hochberg([node["p"] for node in nodes])
        for node, q in zip(nodes, adjusted, strict=True):
            node["p_fdr"] = q
            node["significant"] = bool(node["p"] < alpha)
            node["significant_fdr"] = bool(q < alpha)


def series_key(entry: dict[str, Any]) -> str:
    return f"{entry['variable_id']}__{entry['location_id']}__{entry['aggregation']}"


def _round(value: Any) -> Any:
    """浮點數留 8 位有效數字，避免不同機器最後幾位的差異讓檔案變動。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return float(f"{value:.8g}")
    if isinstance(value, dict):
        return {key: _round(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round(item) for item in value]
    return value


def summarize(results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    analyzed = [item for item in results.values() if item["status"] == "analyzed"]
    reasons: dict[str, int] = {}
    for item in results.values():
        if item["status"] == "insufficient":
            code = item["reason"]["code"]
            reasons[code] = reasons.get(code, 0) + 1
    significant = {}
    for name, path in TESTS.items():
        nodes = []
        for item in analyzed:
            node = item
            for part in path:
                node = node[part]
            nodes.append(node)
        significant[name] = {
            "n_tested": sum(node["p"] is not None for node in nodes),
            "significant": sum(bool(node["significant"]) for node in nodes),
            "significant_fdr": sum(bool(node["significant_fdr"]) for node in nodes),
        }
    return {
        "n_series": len(results),
        "n_analyzed": len(analyzed),
        "n_insufficient": len(results) - len(analyzed),
        "insufficient_by_reason": dict(sorted(reasons.items())),
        "significant_by_test": significant,
        "n_ols_uncorrected_significant": sum(
            bool(item["ols"]["p_uncorrected"] < 0.05) for item in analyzed
        ),
    }


CleaningConfig = tuple[cleaning.CleaningRules, list[cleaning.KnownIssue]]
# 每條結果的 `cleaning` 帶哪些清洗摘要欄位
CLEANING_FIELDS = (
    "n_months",
    "n_usable",
    "n_gaps",
    "longest_gap_months",
)


def _analyze_entry(
    job: tuple[Path, dict[str, Any], TrendParams, bool, CleaningConfig | None],
) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    """一條序列：讀檔、（清洗、）算統計量與（需要時）月距平。獨立成函式是為了能丟給行程池。"""
    snapshot_dir, entry, params, with_anomalies, clean_config = job
    series = json.loads((snapshot_dir / entry["file"]).read_text(encoding="utf-8"))
    identity = {
        "variable_id": entry["variable_id"],
        "location_id": entry["location_id"],
        "aggregation": entry["aggregation"],
        "unit": series["unit"],
    }
    extra: dict[str, Any] = {}
    if clean_config is None:
        prepared = prepare(series["points"], params)
        analysis = analyze_prepared(prepared, params)
    else:
        rules, issues = clean_config
        cleaned = cleaning.clean_series(
            series["points"],
            variable_id=entry["variable_id"],
            aggregation=entry["aggregation"],
            retrieved_at=series.get("retrieved_at"),
            rules=rules,
            issues=issues,
        )
        prepared = prepare_cleaned(cleaned)
        analysis = analyze_prepared(prepared, params)
        analysis["data"]["n_partial_month"] = prepared.n_partial_month
        summary = cleaning.summarize(cleaned, rules)
        extra = {
            "cleaning": {
                **{name: summary[name] for name in CLEANING_FIELDS},
                **{f"n_{flag}": n for flag, n in summary["n_by_any_flag"].items()},
            },
            "known_issues": summary["known_issues"],
            "auxiliary": summary["auxiliary"],
        }
    result = {**identity, **analysis, **extra}
    anomaly = None
    if with_anomalies and prepared.n_valid:
        grid = seasonal_grid(prepared.index, prepared.anomalies)
        anomaly = {
            **identity,
            "first_month": index_month(int(prepared.index[0])),
            "values": [None if math.isnan(v) else float(v) for v in grid],
        }
    return series_key(entry), result, anomaly


def cleaning_overview(
    results: dict[str, dict[str, Any]],
    seed: Path,
    rules: cleaning.CleaningRules,
    issues: list[cleaning.KnownIssue],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """結果檔最上層的 `cleaning`（規則與全部序列的旗標月數）與 `known_issues`（有序列適用的那些）。"""
    used = {issue_id for item in results.values() for issue_id in item["known_issues"]}
    flags = {
        flag: sum(item["cleaning"][f"n_{flag}"] for item in results.values())
        for flag in cleaning.FLAGS
    }
    overview = {
        "seed": seed.as_posix(),
        "rules": asdict(rules),
        "unusable_flags": list(cleaning.UNUSABLE_FLAGS),
        "marked_only_flags": [cleaning.FLAG_OUTLIER, cleaning.FLAG_DISCONTINUITY],
        "months_by_flag": flags,
        "n_series_auxiliary": sum(item["auxiliary"] for item in results.values()),
        "n_series_with_known_issues": sum(
            bool(item["known_issues"]) for item in results.values()
        ),
        "note": (
            "Months flagged missing, partial_month or low_coverage are not used; "
            "nothing is gap-filled for the trend tests. outlier_suspect and "
            "known_discontinuity months are used and only marked. A month can "
            "carry more than one flag. Flags and known issues do not change any "
            "value or test."
        ),
    }
    known = {
        issue.id: {
            key: value
            for key, value in asdict(issue).items()
            if key != "id" and value is not None
        }
        for issue in issues
        if issue.id in used
    }
    return overview, known


def analyze_snapshot(
    snapshot_dir: Path,
    params: TrendParams,
    *,
    fdr_group: str = "all",
    workers: int = 1,
    with_anomalies: bool = True,
    cleaning_seed: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """讀整份快照，回傳 (trends, anomalies) 兩個要寫出的結構。

    `fdr_group`、`workers`、`with_anomalies` 是給擴充資料用的（#68）；預設值下的輸出與
    核心快照原本的結果檔逐位元組相同。

    `cleaning_seed`（#85）有給時，每條序列先照那份規則清洗（`min_coverage` 以 `params` 為準），
    結果多帶 `cleaning`、`known_issues`、`auxiliary`；沒給就是清洗前的做法。
    """
    clean_config: CleaningConfig | None = None
    if cleaning_seed is not None:
        seed_rules, issues = cleaning.load_seed(cleaning_seed)
        clean_config = (replace(seed_rules, min_coverage=params.min_coverage), issues)
    catalog = json.loads((snapshot_dir / "catalog.json").read_text(encoding="utf-8"))
    jobs = [
        (snapshot_dir, entry, params, with_anomalies, clean_config)
        for entry in sorted(catalog["series"], key=series_key)
    ]
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            analyzed = list(pool.map(_analyze_entry, jobs, chunksize=16))
    else:
        analyzed = [_analyze_entry(job) for job in jobs]
    results: dict[str, dict[str, Any]] = {}
    anomalies: dict[str, dict[str, Any]] = {}
    for key, result, anomaly in analyzed:
        results[key] = result
        if anomaly is not None:
            anomalies[key] = anomaly
    groups = fdr_groups(results, fdr_group)
    apply_fdr(results, params.alpha, groups)
    grouped = fdr_group != "all"
    header = {
        "schema_version": SCHEMA_VERSION,
        "input": {
            "snapshot": snapshot_dir.as_posix(),
            "snapshot_generated_at": catalog["snapshot"]["generated_at"],
        },
        "parameters": asdict(params),
        "packages": {name: version(name) for name in PACKAGES},
    }
    fdr_method = (
        "Benjamini-Hochberg, separately for each test and separately within each "
        f"group of series sharing the same {fdr_group} (see `fdr`); "
        "p_fdr is the adjusted p value"
        if grouped
        else "Benjamini-Hochberg across all analyzed series of this run, "
        "separately for each test; p_fdr is the adjusted p value"
    )
    extra: dict[str, Any] = {}
    if grouped:
        extra = {
            "fdr": {
                "group_by": fdr_group,
                "n_series_by_group": {name: len(keys) for name, keys in groups.items()},
            },
            "summary_by_group": {
                name: summarize({key: results[key] for key in keys})
                for name, keys in groups.items()
            },
        }
    if clean_config is not None and cleaning_seed is not None:
        overview, known = cleaning_overview(results, cleaning_seed, *clean_config)
        extra = {**extra, "cleaning": overview, "known_issues": known}
        auxiliary = {key for key, item in results.items() if item["auxiliary"]}
        if auxiliary:
            # 只是換個範圍計數；q 值仍是含輔助變數一起校正的
            extra["summary_excluding_auxiliary"] = summarize(
                {k: v for k, v in results.items() if k not in auxiliary}
            )
    trends = {
        **header,
        "methods": {
            "anomaly": "value minus the mean of the same calendar month over all "
            "usable years of the same series; no gap filling",
            "ols": "least-squares slope of monthly anomalies on time; standard error, "
            "t-test p and confidence interval use the effective sample size "
            "n(1-r1)/(1+r1) from the lag-1 autocorrelation of residuals "
            "(Santer et al. 2000); *_uncorrected fields assume independence",
            "mk_original": "Mann-Kendall test on anomalies (assumes independence)",
            "mk_hamed_rao": "Mann-Kendall with Hamed-Rao (1998) variance correction "
            "for autocorrelation, on anomalies; p is null when the corrected "
            "variance is not positive",
            "mk_seasonal": "Seasonal Mann-Kendall (period 12) on the monthly values",
            "sen": "Theil-Sen slope of anomalies with its confidence interval "
            "(assumes independence)",
            "fdr": fdr_method,
        },
        "summary": summarize(results),
        **extra,
        "series": results,
    }
    return _round(trends), _round({**header, "series": anomalies})


def _dump(path: Path, content: dict[str, Any], *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (
        json.dumps(content, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if compact
        else json.dumps(content, ensure_ascii=False, indent=2, allow_nan=False)
    )
    path.write_text(text + "\n", encoding="utf-8")


def write_outputs(
    analysis_dir: Path,
    trends: dict[str, Any],
    anomalies: dict[str, Any] | None,
    *,
    generated_at: str,
    command: str = "uv run python -m trend_detective.trends",
) -> None:
    """`anomalies` 是 None 時不寫 `anomalies.json`（擴充資料量大，只留統計結果）。"""
    _dump(analysis_dir / "trends.json", trends)
    outputs = ["trends.json"]
    if anomalies is not None:
        _dump(analysis_dir / "anomalies.json", anomalies, compact=True)
        outputs.append("anomalies.json")
    extra = {
        key: trends[key]
        for key in (
            "fdr",
            "summary_by_group",
            "cleaning",
            "summary_excluding_auxiliary",
        )
        if key in trends
    }
    _dump(
        analysis_dir / "trends.run.json",
        {
            "command": command,
            "generated_at": generated_at,
            "input": trends["input"],
            "parameters": trends["parameters"],
            "packages": trends["packages"],
            "outputs": outputs,
            "summary": trends["summary"],
            **extra,
        },
    )


def main(argv: list[str] | None = None) -> int:
    defaults = TrendParams()
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    parser.add_argument("--min-coverage", type=float, default=defaults.min_coverage)
    parser.add_argument(
        "--min-valid-months", type=int, default=defaults.min_valid_months
    )
    parser.add_argument(
        "--max-missing-fraction", type=float, default=defaults.max_missing_fraction
    )
    parser.add_argument("--alpha", type=float, default=defaults.alpha)
    parser.add_argument("--hamed-rao-lags", type=int, default=defaults.hamed_rao_lags)
    parser.add_argument(
        "--fdr-group",
        choices=FDR_GROUPS,
        default="all",
        help="FDR 的分組：all 是整批一組（核心快照的做法）；"
        "aggregation 是同一種聚合方式的序列各自一組（擴充資料用）",
    )
    parser.add_argument("--workers", type=int, default=1, help="平行的行程數")
    parser.add_argument(
        "--no-anomalies", action="store_true", help="不寫 anomalies.json"
    )
    parser.add_argument(
        "--cleaning-seed",
        type=Path,
        default=cleaning.CLEANING_SEED,
        help="清洗規則與已知問題（預設 data/seed/cleaning.json）",
    )
    parser.add_argument(
        "--no-cleaning",
        action="store_true",
        help="不清洗：回到只排除 null 與低覆蓋月份的輸入（#85 之前的做法）",
    )
    args = parser.parse_args(argv)
    params = TrendParams(
        min_coverage=args.min_coverage,
        min_valid_months=args.min_valid_months,
        max_missing_fraction=args.max_missing_fraction,
        alpha=args.alpha,
        hamed_rao_lags=args.hamed_rao_lags,
    )
    trends, anomalies = analyze_snapshot(
        args.snapshot_dir,
        params,
        fdr_group=args.fdr_group,
        workers=args.workers,
        with_anomalies=not args.no_anomalies,
        cleaning_seed=None if args.no_cleaning else args.cleaning_seed,
    )
    generated_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    command = "uv run python -m trend_detective.trends"
    if argv is None and len(sys.argv) > 1:
        command += " " + " ".join(sys.argv[1:])
    write_outputs(
        args.analysis_dir,
        trends,
        None if args.no_anomalies else anomalies,
        generated_at=generated_at,
        command=command,
    )
    summary = trends["summary"]
    print(
        f"{summary['n_series']} 條序列：{summary['n_analyzed']} 條有分析、"
        f"{summary['n_insufficient']} 條資料不足 {summary['insufficient_by_reason']}"
    )
    for name, counts in summary["significant_by_test"].items():
        print(
            f"  {name}: 可檢定 {counts['n_tested']} 條，"
            f"p < {params.alpha} 有 {counts['significant']} 條，"
            f"FDR 校正後 {counts['significant_fdr']} 條"
        )
    for name, group in trends.get("summary_by_group", {}).items():
        ols = group["significant_by_test"]["ols"]
        print(
            f"  [{name}] {group['n_series']} 條，有分析 {group['n_analyzed']} 條；"
            f"ols p < {params.alpha} 有 {ols['significant']} 條，"
            f"FDR 校正後 {ols['significant_fdr']} 條"
        )
    written = "trends.json、trends.run.json"
    if not args.no_anomalies:
        written = "trends.json、anomalies.json、trends.run.json"
    print(f"已寫出 {args.analysis_dir}/：{written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
