"""探勘共用的純函式（#111）：去趨勢、落後配對、自相關修正的相關係數檢定、連通分量。

不連資料庫、不讀檔。`gap_tree.py`、`variable_graph.py`、`similar_series.py` 共用。

相關係數的顯著性：兩條月序列各自有自相關時，獨立樣本數比月數少。這裡用
`n_eff = n × (1 − r1x × r1y) ÷ (1 + r1x × r1y)`（r1x、r1y 是兩條序列各自的 lag-1 自相關，
用 `trends.lag1_autocorrelation`，和趨勢統計同一個函式；只取相鄰月份的配對），夾在 3 與 n
之間，再用 `t = r × sqrt((n_eff − 2) ÷ (1 − r²))`、自由度 `n_eff − 2` 做雙尾 t 檢定。這是近似：
只修正 lag-1，季節性的自相關結構與非常態都沒有處理。
"""

import math
from typing import Any

import numpy as np
from scipy import stats

from trend_detective.trends import lag1_autocorrelation


def detrend(index: np.ndarray, values: np.ndarray) -> np.ndarray:
    """減掉非 NaN 月份的最小平方法直線；NaN 保持 NaN。可用月份少於 3 個就原樣回傳。"""
    out = values.astype(float).copy()
    valid = ~np.isnan(out)
    if int(valid.sum()) < 3:
        return out
    years = (index[valid] - index[valid][0]) / 12
    slope, intercept = np.polyfit(years, out[valid], 1)
    out[valid] = out[valid] - (intercept + slope * years)
    return out


def align(
    index_x: np.ndarray,
    x: np.ndarray,
    index_y: np.ndarray,
    y: np.ndarray,
    lag: int = 0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """把 x 在月份 t − lag 的值配上 y 在月份 t 的值；回傳 (月份 t, x 值, y 值)，NaN 的配對不留。

    `lag = 1` 是「x 領先 y 一個月」。
    """
    lookup = {
        int(i) + lag: float(v)
        for i, v in zip(index_x, x, strict=True)
        if not math.isnan(v)
    }
    months, left, right = [], [], []
    for i, v in zip(index_y, y, strict=True):
        if not math.isnan(v) and int(i) in lookup:
            months.append(int(i))
            left.append(lookup[int(i)])
            right.append(float(v))
    return (
        np.array(months, dtype=np.int64),
        np.array(left, dtype=float),
        np.array(right, dtype=float),
    )


def effective_n(index: np.ndarray, x: np.ndarray, y: np.ndarray) -> float:
    """兩條序列各自 lag-1 自相關修正後的有效樣本數（見模組說明），夾在 3 與 n 之間。"""
    n = int(index.size)
    product = lag1_autocorrelation(index, x) * lag1_autocorrelation(index, y)
    if product >= 1:
        return 3.0
    return float(min(float(n), max(3.0, n * (1 - product) / (1 + product))))


def correlation_p(r: float, n_eff: float) -> float:
    """相關係數 r 在有效樣本數 n_eff 下的雙尾 p 值（t 檢定）。"""
    if not math.isfinite(r) or n_eff <= 2:
        return 1.0
    if abs(r) >= 1:
        return 0.0
    t = abs(r) * math.sqrt((n_eff - 2) / (1 - r * r))
    return float(2 * stats.t.sf(t, n_eff - 2))


def correlation_test(index: np.ndarray, x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    """已對齊、沒有 NaN 的兩條序列：r、月數、有效樣本數、p。月數少於 3 或沒有變異時 r 是 None。"""
    n = int(index.size)
    if n < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return {"r": None, "n": n, "n_eff": None, "p": None}
    r = float(np.corrcoef(x, y)[0, 1])
    n_eff = effective_n(index, x, y)
    return {"r": r, "n": n, "n_eff": n_eff, "p": correlation_p(r, n_eff)}


def standardize(values: np.ndarray) -> np.ndarray:
    """平均 0、標準差 1（母體標準差）；沒有變異時全 0。"""
    sd = float(values.std())
    if sd == 0:
        return np.zeros_like(values, dtype=float)
    return (values - values.mean()) / sd


def components(nodes: list[int], edges: list[tuple[int, int]]) -> dict[int, int]:
    """連通分量（union-find）：節點 → 分量裡最小的節點編號。用來對照 pgr_connectedComponents。"""
    parent = {node: node for node in nodes}

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for a, b in edges:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[max(root_a, root_b)] = min(root_a, root_b)
    return {node: find(node) for node in nodes}


def block_bootstrap_mean(
    values: np.ndarray, blocks: np.ndarray, n_resamples: int, seed: int, alpha: float
) -> tuple[float, float]:
    """平均值的信賴區間：以 `blocks`（例如年份）為單位重抽，同一塊的值一起進出。

    月資料彼此相關，逐月重抽會讓區間太窄；整年一起抽保留年內的相關。只有一塊時回傳
    (NaN, NaN)。
    """
    labels = np.unique(blocks)
    if labels.size < 2:
        return math.nan, math.nan
    sums = np.array([values[blocks == label].sum() for label in labels])
    counts = np.array([(blocks == label).sum() for label in labels])
    rng = np.random.default_rng(seed)
    picks = rng.integers(0, labels.size, size=(n_resamples, labels.size))
    means = sums[picks].sum(axis=1) / counts[picks].sum(axis=1)
    low, high = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return float(low), float(high)
