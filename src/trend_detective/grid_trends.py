"""逐格點的趨勢與顯著性（#68）：把 `trends.py` 的線性趨勢檢定向量化，一次算整張圖。

每個網格是一條月序列，做的事與 `trends.prepare` → `trends.insufficient_reason` →
`trends.ols_trend` 完全相同（有測試逐格比對）：

1. 不補值。月距平 = 每個月減去該格、同一個月份所有有值年份的平均。
2. 距平對時間做最小平方法，斜率換成每十年的變化量。
3. 顯著性：斜率的 t 檢定，標準誤與自由度用殘差的 lag-1 自相關修正有效樣本數
   （n_eff = n(1 − r1)/(1 + r1)，上限 n、下限 3；r1 只用相鄰兩個月都有值的配對）。
4. 有值月份少於 `min_valid_months`、或第一個到最後一個有值月份之間缺的比例超過
   `max_missing_fraction`、或所有值都相同的網格不分析，標為缺值。
5. 多重檢定：對整張圖有分析的網格的 p 值做 Benjamini-Hochberg FDR（Wilks 2016,
   doi:10.1175/BAMS-D-15-00267.1 建議的做法），輸出校正前與校正後兩種顯著遮罩。

和序列版不同的地方只有一個：立方體沒有 `coverage` 欄，所以沒有「低覆蓋月份」這一步。
Mann-Kendall 家族與 Sen 斜率沒有向量化，逐格點的結果只有上面這一種檢定。

這個模組只做數值；讀立方體、寫檔在 `grid_fetch.write_derived` 與 `grid_derive.py`。
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats

from trend_detective.grid import Floats, Grid, Layers, area_weights
from trend_detective.trends import TrendParams, benjamini_hochberg

# `CellTrends.status` 的代碼；0 以外都不分析
ANALYZED = 0
STATUS_CODES = ("analyzed", "no_data", "too_few_months", "too_many_missing", "constant")

# 顯著性遮罩（uint8）的類別
MASK_MISSING = 0
MASK_NOT_SIGNIFICANT = 1
MASK_UNCORRECTED_ONLY = 2
MASK_FDR = 3
MASK_CLASSES = {
    "0": "缺值：沒有資料，或有效月數不足、缺月太多、數值不變而不分析",
    "1": "不顯著（校正前 p ≥ alpha）",
    "2": "只在校正前顯著（p < alpha，但 BH-FDR 校正後 q ≥ alpha）",
    "3": "校正後仍顯著（BH-FDR 的 q < alpha）",
}

SLOPE_LAYER = "trend_slope_per_decade"
MASK_LAYER = "trend_significance"
# 被趨勢地圖取代的舊檔（逐年平均的斜率，沒有檢定）；重產時刪掉
LEGACY_SLOPE_FILE = "exploratory_linear_slope_per_decade.i16"


@dataclass(frozen=True)
class CellTrends:
    """每個網格的趨勢；陣列的形狀是輸入值去掉時間軸之後的形狀，不分析的格子是 NaN。"""

    slope_per_decade: Floats
    p: Floats
    lag1_autocorrelation: Floats
    n_effective: Floats
    n_valid: NDArray[np.int64]
    status: NDArray[np.uint8]


def month_indices(months: list[date]) -> NDArray[np.int64]:
    """月份 → 年 × 12 + 月（與 `trends.month_index` 相同的月序）。"""
    return np.array([m.year * 12 + m.month - 1 for m in months], dtype=np.int64)


def cell_points(months: list[date], column: Floats) -> list[dict[str, Any]]:
    """一個網格的月值 → `trends.analyze_points` 吃的格式（抽查與測試用）。"""
    return [
        {
            "month": f"{month:%Y-%m}-01",
            "value": float(value) if np.isfinite(value) else None,
        }
        for month, value in zip(months, column, strict=True)
    ]


def cell_trends(
    index: NDArray[np.int64], values: Floats, params: TrendParams
) -> CellTrends:
    """`values` 是 (時間, …)；沿第 0 軸對每個網格算月距平的線性趨勢與修正後的 p 值。"""
    index = np.asarray(index, dtype=np.int64)
    if values.shape[0] != index.size:
        raise ValueError(f"時間軸長度 {values.shape[0]} 與月份數 {index.size} 不符")
    shape = values.shape[1:]
    y = values.reshape(index.size, -1).astype(np.float64)
    valid = np.isfinite(y)
    n = valid.sum(axis=0)
    n_safe = np.maximum(n, 1)

    anomalies = np.full_like(y, np.nan)
    for calendar_month in range(12):
        rows = index % 12 == calendar_month
        if not rows.any():
            continue
        count = valid[rows].sum(axis=0)
        mean = np.where(valid[rows], y[rows], 0.0).sum(axis=0) / np.maximum(count, 1)
        anomalies[rows] = y[rows] - mean

    last_row = index.size - 1
    first = valid.argmax(axis=0)
    last = last_row - valid[::-1].argmax(axis=0)
    span = index[last] - index[first] + 1
    missing_fraction = np.where(n > 0, 1 - n / span, 1.0)
    with np.errstate(invalid="ignore"):
        spread = np.where(valid, anomalies, -np.inf).max(axis=0) - np.where(
            valid, anomalies, np.inf
        ).min(axis=0)

    status = np.full(n.shape, ANALYZED, dtype=np.uint8)
    status[spread == 0] = STATUS_CODES.index("constant")
    status[missing_fraction > params.max_missing_fraction] = STATUS_CODES.index(
        "too_many_missing"
    )
    status[n < params.min_valid_months] = STATUS_CODES.index("too_few_months")
    status[n == 0] = STATUS_CODES.index("no_data")

    years = index / 12.0
    with np.errstate(invalid="ignore", divide="ignore"):
        x_mean = (valid * years[:, None]).sum(axis=0) / n_safe
        dx = np.where(valid, years[:, None] - x_mean, 0.0)
        y_mean = np.where(valid, anomalies, 0.0).sum(axis=0) / n_safe
        dy = np.where(valid, anomalies - y_mean, 0.0)
        sxx = (dx * dx).sum(axis=0)
        slope = (dx * dy).sum(axis=0) / sxx
        residuals = dy - slope * dx  # 缺值的位置是 0，下面都用遮罩排除
        stderr = np.sqrt((residuals**2).sum(axis=0) / (n - 2) / sxx)

        # lag-1 自相關：只用相鄰兩個月都有值的殘差配對（與 trends.lag1_autocorrelation 相同）
        pair = valid[:-1] & valid[1:] & (np.diff(index) == 1)[:, None]
        n_pairs = pair.sum(axis=0)
        pairs_safe = np.maximum(n_pairs, 1)
        head, tail = residuals[:-1], residuals[1:]
        head_mean = np.where(pair, head, 0.0).sum(axis=0) / pairs_safe
        tail_mean = np.where(pair, tail, 0.0).sum(axis=0) / pairs_safe
        d_head = np.where(pair, head - head_mean, 0.0)
        d_tail = np.where(pair, tail - tail_mean, 0.0)
        r1 = (d_head * d_tail).sum(axis=0) / np.sqrt(
            (d_head**2).sum(axis=0) * (d_tail**2).sum(axis=0)
        )
        flat = (
            np.where(pair, head, -np.inf).max(axis=0)
            == np.where(pair, head, np.inf).min(axis=0)
        ) | (
            np.where(pair, tail, -np.inf).max(axis=0)
            == np.where(pair, tail, np.inf).min(axis=0)
        )
        r1 = np.where((n_pairs < 3) | flat | ~np.isfinite(r1), 0.0, r1)
        r1 = np.clip(r1, -1.0, 1.0)

        n_float = n.astype(np.float64)
        n_eff = np.minimum(n_float, np.maximum(3.0, n_float * (1 - r1) / (1 + r1)))
        stderr_ar1 = stderr * np.sqrt((n_float - 2) / (n_eff - 2))
        p = np.where(
            stderr_ar1 > 0,
            2 * stats.t.sf(np.abs(slope / stderr_ar1), n_eff - 2),
            np.where(slope != 0, 0.0, 1.0),
        )

    analyzed = status == ANALYZED

    def keep(array: Floats) -> Floats:
        return np.where(analyzed, array, np.nan).reshape(shape)

    return CellTrends(
        slope_per_decade=keep(10 * slope),
        p=keep(p),
        lag1_autocorrelation=keep(r1),
        n_effective=keep(n_eff),
        n_valid=n.reshape(shape),
        status=status.reshape(shape),
    )


def significance_mask(
    trend: CellTrends, alpha: float
) -> tuple[NDArray[np.uint8], Floats]:
    """整張圖的 BH-FDR：回傳 (遮罩, q 值)。遮罩的類別見 `MASK_CLASSES`。

    FDR 的範圍是這張圖所有有分析的網格（缺值的不算）。網格之間有空間相關、面積也不同
    （高緯度的格子小），BH 在正相關下仍控制 FDR，但「顯著格點數」不等於「顯著的面積」。
    """
    analyzed = trend.status == ANALYZED
    q = np.full(trend.p.shape, np.nan)
    q[analyzed] = benjamini_hochberg(trend.p[analyzed].tolist())
    mask = np.full(trend.p.shape, MASK_MISSING, dtype=np.uint8)
    mask[analyzed] = MASK_NOT_SIGNIFICANT
    mask[analyzed & (trend.p < alpha)] = MASK_UNCORRECTED_ONLY
    mask[analyzed & (q < alpha)] = MASK_FDR
    return mask, q


def cell_area_weights(grid: Grid) -> Floats:
    """衍生檔網格每一格的相對面積，形狀 (緯度, 經度)。"""
    centres = grid.lat_south + (np.arange(grid.n_lat) + 0.5) * grid.lat_step
    return np.repeat(area_weights(centres)[:, None], grid.n_lon, axis=1)


def trend_summary(
    trend: CellTrends, mask: NDArray[np.uint8], grid: Grid
) -> dict[str, Any]:
    """整張圖的數字摘要：各類格子數、顯著的格點比例與面積比例、斜率的面積加權平均。"""
    weights = cell_area_weights(grid)
    analyzed = trend.status == ANALYZED
    area = float(weights[analyzed].sum())

    def share(selected: NDArray[np.bool_]) -> dict[str, Any]:
        n_cells = int(selected.sum())
        return {
            "n_cells": n_cells,
            "cell_fraction": n_cells / int(analyzed.sum()) if analyzed.any() else None,
            "area_fraction": float(weights[selected].sum()) / area if area else None,
        }

    return {
        "cells": {
            "n_total": int(analyzed.size),
            **{
                f"n_{name}": int((trend.status == code).sum())
                for code, name in enumerate(STATUS_CODES)
            },
            "analyzed_area_fraction_of_grid": area / float(weights.sum()),
        },
        "significant": {
            "uncorrected": share(mask >= MASK_UNCORRECTED_ONLY),
            "fdr": share(mask == MASK_FDR),
            "fdr_positive_slope": share(
                (mask == MASK_FDR) & (trend.slope_per_decade > 0)
            ),
            "fdr_negative_slope": share(
                (mask == MASK_FDR) & (trend.slope_per_decade < 0)
            ),
        },
        "area_weighted_mean_slope_per_decade": float(
            (trend.slope_per_decade[analyzed] * weights[analyzed]).sum() / area
        )
        if area
        else None,
    }


def _significant(value: Any) -> Any:
    """摘要裡的浮點數留 8 位有效數字（與 `trends.json` 相同），讓重產的檔案穩定。"""
    if isinstance(value, float):
        return float(f"{value:.8g}")
    if isinstance(value, dict):
        return {key: _significant(item) for key, item in value.items()}
    return value


def trend_layers(
    months: list[date],
    values: Floats,
    grid: Grid,
    params: TrendParams,
    *,
    unit: str,
    slope_scale: float,
) -> tuple[list[Layers], dict[str, Any], CellTrends]:
    """由衍生檔網格上的月資料 (時間, 緯度, 經度) 算出兩個圖層與 `meta.json` 的 `trend` 區塊。"""
    trend = cell_trends(month_indices(months), values, params)
    mask, _ = significance_mask(trend, params.alpha)
    period = f"{months[0]:%Y-%m} 至 {months[-1]:%Y-%m}"
    # 超出 int16 能表示的範圍時夾在邊界並記下格數，不讓少數極端格子擋住整張圖
    limit = 32767 * slope_scale
    n_clipped = int((np.abs(trend.slope_per_decade) > limit).sum())
    layers = [
        Layers(
            name=SLOPE_LAYER,
            description=(
                f"月距平（{period}）對時間的最小平方法斜率，每十年的變化量；"
                "不分析的網格是缺值。顯著性見 trend_significance。"
            ),
            unit=f"{unit} per decade",
            labels=[period],
            values=np.clip(trend.slope_per_decade, -limit, limit)[None],
            scale=slope_scale,
        ),
        Layers(
            name=MASK_LAYER,
            description=(
                "斜率的顯著性類別：自相關修正後的 t 檢定，"
                "並對整張圖有分析的網格做 BH-FDR。類別見 classes。"
            ),
            unit="class",
            labels=[period],
            values=mask[None],
            scale=1.0,
            dtype="uint8",
            classes=MASK_CLASSES,
        ),
    ]
    meta = {
        "replaces": LEGACY_SLOPE_FILE,
        "method": {
            "grid": "與本目錄其他圖層相同的衍生檔網格：立方體逐月先面積加權降解析度"
            "（見 regrid），再對每個網格的月序列計算；不是在原始解析度上算的",
            "anomaly": "每個月減去該網格同一個月份所有有值年份的平均；不補值",
            "slope": "月距平對時間的最小平方法斜率 × 10（每十年）",
            "significance": "斜率的 t 檢定；標準誤與自由度用殘差 lag-1 自相關 r1 修正的"
            "有效樣本數 n(1-r1)/(1+r1)（Santer et al. 2000），"
            "與 trends.py 的 ols 是同一套算法（向量化）",
            "multiple_testing": "對整張圖有分析的網格的 p 值做 Benjamini-Hochberg FDR"
            "（Wilks 2016, doi:10.1175/BAMS-D-15-00267.1），控制水準 = alpha；"
            "Wilks 對空間相關強的場建議可用 2 × alpha，這裡沒有放寬",
            "not_analyzed": "有值月數少於 min_valid_months、第一個到最後一個有值月份之間"
            "缺的比例超過 max_missing_fraction、或數值完全不變的網格",
        },
        "parameters": {
            "min_valid_months": params.min_valid_months,
            "max_missing_fraction": params.max_missing_fraction,
            "alpha": params.alpha,
        },
        "period": {
            "first_month": f"{months[0]:%Y-%m}",
            "last_month": f"{months[-1]:%Y-%m}",
            "n_months": len(months),
        },
        **_significant(trend_summary(trend, mask, grid)),
        "n_slope_cells_clipped_to_int16_range": n_clipped,
        "limitations": [
            (
                "衛星感測器換代、再分析的同化系統或輸入觀測變更、產品重製都可能造成假趨勢；"
                "這裡沒有偵測或修正不連續"
            ),
            "只有線性趨勢與一種檢定；沒有 Mann-Kendall 與 Sen 斜率",
            "網格之間有空間相關，面積也不同；顯著格點的比例與面積比例都列出，兩者不同",
            "顯著不代表變化量大，不顯著也不代表沒有變化（可能只是期間不夠長）",
            (
                "月距平的月份平均會吸收一小部分線性趨勢：N 個完整年時斜率約被低估 1/N²"
                "（20 年約 0.25%）；這是沿用 trends.py 的做法，序列版也一樣"
            ),
        ],
    }
    return layers, meta, trend
