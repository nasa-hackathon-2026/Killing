"""逐格點趨勢（#68）：向量化結果對照逐條呼叫 `trends.py`，以及已知答案的合成立方體。"""

from datetime import date

import numpy as np
import pytest

from trend_detective.grid import Grid
from trend_detective.grid_trends import (
    ANALYZED,
    STATUS_CODES,
    CellTrends,
    cell_points,
    cell_trends,
    month_indices,
    significance_mask,
    trend_layers,
    trend_summary,
)
from trend_detective.trends import TrendParams, analyze_points

PARAMS = TrendParams()
NAN = float("nan")


def months_from(year: int, month: int, n: int) -> list[date]:
    start = year * 12 + month - 1
    return [date((start + i) // 12, (start + i) % 12 + 1, 1) for i in range(n)]


def ar1(rng: np.random.Generator, n: int, phi: float) -> np.ndarray:
    noise = np.empty(n)
    noise[0] = rng.normal()
    for i in range(1, n):
        noise[i] = phi * noise[i - 1] + rng.normal()
    return noise


def attenuation(n_years: int) -> float:
    """月距平法對純線性趨勢的斜率衰減比例（解析解，N 個完整年）。

    t = 12k + m 時，減掉各月份的多年平均後距平是 12b(k − k̄) 的階梯；它對 t 的斜率是
    b × 144(N² − 1) ÷ (144N² − 1)：月份平均吸收了約 1/N² 的趨勢。
    """
    return 144 * (n_years**2 - 1) / (144 * n_years**2 - 1)


def status_of(name: str) -> int:
    return STATUS_CODES.index(name)


def test_month_indices_use_the_same_month_number_as_the_series_code():
    assert month_indices([date(2004, 10, 1), date(2005, 1, 1)]).tolist() == [
        2004 * 12 + 9,
        2005 * 12,
    ]


def test_vectorized_trend_matches_the_per_series_code_cell_by_cell():
    rng = np.random.default_rng(68)
    months = months_from(2002, 9, 290)
    n = len(months)
    t = np.arange(n)
    cube = np.empty((n, 3, 4), dtype=np.float32)
    for i in range(3):
        for j in range(4):
            cube[:, i, j] = (
                280
                + 5 * np.sin(2 * np.pi * t / 12)
                + rng.normal(0, 0.05) * t / 12
                + ar1(rng, n, rng.uniform(-0.3, 0.8))
            )
    # 各種缺值型態：零星缺月、開頭一段沒有資料、連續缺口、每年固定缺同一個月份
    cube[rng.choice(n, 40, replace=False), 0, 1] = NAN
    cube[:60, 0, 2] = NAN
    cube[100:130, 1, 0] = NAN
    cube[months_from(2002, 9, n).index(date(2003, 1, 1)) :: 12, 1, 1] = NAN
    # 不分析的三種：有值月數不足、缺月太多、數值不變；外加整格沒有資料
    cube[:200, 2, 0] = NAN
    cube[::3, 2, 1] = NAN
    cube[:, 2, 2] = 7.0
    cube[:, 2, 3] = NAN

    trend = cell_trends(month_indices(months), cube, PARAMS)

    n_analyzed = 0
    for i in range(3):
        for j in range(4):
            single = analyze_points(cell_points(months, cube[:, i, j]), PARAMS)
            assert trend.n_valid[i, j] == single["data"]["n_valid"]
            if single["status"] == "insufficient":
                assert trend.status[i, j] != ANALYZED
                assert np.isnan(trend.slope_per_decade[i, j])
                assert np.isnan(trend.p[i, j])
                continue
            n_analyzed += 1
            ols = single["ols"]
            assert trend.status[i, j] == ANALYZED
            assert trend.slope_per_decade[i, j] == pytest.approx(
                ols["slope_per_decade"], rel=1e-9, abs=1e-12
            )
            assert trend.p[i, j] == pytest.approx(ols["p"], rel=1e-7, abs=1e-300)
            assert trend.lag1_autocorrelation[i, j] == pytest.approx(
                ols["lag1_autocorrelation"], rel=1e-9, abs=1e-12
            )
            assert trend.n_effective[i, j] == pytest.approx(
                ols["n_effective"], rel=1e-9
            )
    assert n_analyzed == 8
    assert trend.status[2].tolist() == [
        status_of("too_few_months"),
        status_of("too_many_missing"),
        status_of("constant"),
        status_of("no_data"),
    ]


def test_known_slope_is_recovered_through_a_seasonal_cycle():
    months = months_from(2001, 1, 240)
    t = np.arange(240)
    seasonal = 8 * np.cos(2 * np.pi * t / 12)
    # 每月 +0.01、−0.02、0 → 每十年 +1.2、−2.4、0（第三格只有季節循環加雜訊）；
    # 20 個完整年，月距平法的斜率是真值 × attenuation(20) = 0.99752
    rng = np.random.default_rng(3)
    cube = np.stack(
        [
            seasonal + 0.01 * t,
            seasonal - 0.02 * t,
            seasonal + rng.normal(0, 1, 240),
        ],
        axis=1,
    )[:, None, :]

    trend = cell_trends(month_indices(months), cube, PARAMS)

    assert attenuation(20) == pytest.approx(0.99752, abs=1e-5)
    assert trend.slope_per_decade[0, 0] == pytest.approx(1.2 * attenuation(20))
    assert trend.slope_per_decade[0, 1] == pytest.approx(-2.4 * attenuation(20))
    assert trend.p[0, 0] < 1e-12 and trend.p[0, 1] < 1e-12
    assert abs(trend.slope_per_decade[0, 2]) < 0.5
    assert trend.p[0, 2] > 0.05


def test_cells_below_the_valid_month_threshold_are_missing():
    months = months_from(2001, 1, 130)
    rng = np.random.default_rng(5)
    cube = rng.normal(0, 1, (130, 1, 3))
    cube[:11, 0, 0] = NAN  # 119 個月：差一個月不到門檻
    cube[:10, 0, 1] = NAN  # 120 個月：剛好達到

    trend = cell_trends(month_indices(months), cube, PARAMS)
    mask, _ = significance_mask(trend, PARAMS.alpha)

    assert trend.n_valid[0].tolist() == [119, 120, 130]
    assert trend.status[0].tolist() == [status_of("too_few_months"), ANALYZED, ANALYZED]
    assert np.isnan(trend.slope_per_decade[0, 0]) and mask[0, 0] == 0
    assert mask[0, 1] != 0 and mask[0, 2] != 0


def test_thresholds_are_parameters():
    months = months_from(2001, 1, 60)
    cube = np.random.default_rng(1).normal(0, 1, (60, 1, 1))

    assert cell_trends(month_indices(months), cube, PARAMS).status[0, 0] != ANALYZED
    relaxed = TrendParams(min_valid_months=60)
    assert cell_trends(month_indices(months), cube, relaxed).status[0, 0] == ANALYZED


def hand_made(p: list[float], slopes: list[float]) -> CellTrends:
    """只給 p 值與斜率的結果（NaN 表示沒有分析），用來單獨測遮罩與摘要。"""
    p_array = np.array([p])
    analyzed = np.isfinite(p_array)
    return CellTrends(
        slope_per_decade=np.array([slopes]),
        p=p_array,
        lag1_autocorrelation=np.zeros_like(p_array),
        n_effective=np.full_like(p_array, 200.0),
        n_valid=np.full(p_array.shape, 200),
        status=np.where(analyzed, ANALYZED, status_of("too_few_months")).astype(
            np.uint8
        ),
    )


def test_mask_separates_raw_and_fdr_significance_over_analyzed_cells_only():
    # 有分析的 4 格：0.001、0.02、0.04、0.9 → BH：0.004、0.04、0.0533、0.9
    trend = hand_made([0.04, NAN, 0.001, 0.9, 0.02], [1.0, NAN, 1.0, 1.0, -1.0])

    mask, q = significance_mask(trend, 0.05)

    assert mask.tolist() == [[2, 0, 3, 1, 3]]
    assert q[0, [0, 2, 3, 4]].tolist() == pytest.approx([0.16 / 3, 0.004, 0.9, 0.04])
    assert np.isnan(q[0, 1])


def test_fdr_scope_is_the_whole_map_so_more_null_cells_remove_weak_detections():
    # 單獨一格 p = 0.04 顯著；同一張圖多 9 格 p = 0.9 時，q = 0.04 × 10 ÷ 1 = 0.4
    alone, _ = significance_mask(hand_made([0.04], [1.0]), 0.05)
    crowded, _ = significance_mask(hand_made([0.04] + [0.9] * 9, [1.0] * 10), 0.05)

    assert alone.tolist() == [[3]]
    assert crowded[0, 0] == 2


def test_summary_weights_cells_by_area():
    # 三個 60° 緯度帶的面積比是 0.5 : 1 : 0.5（sin 的差）
    grid = Grid(
        lat_south=-90.0, lat_step=60.0, n_lat=3, lon_west=0.0, lon_step=360.0, n_lon=1
    )
    trend = hand_made([0.001, 0.5, NAN], [1.0, 4.0, NAN])
    trend = CellTrends(
        **{
            name: getattr(trend, name).reshape(3, 1)
            for name in trend.__dataclass_fields__
        }
    )
    mask, _ = significance_mask(trend, 0.05)

    summary = trend_summary(trend, mask, grid)

    assert summary["cells"]["n_analyzed"] == 2
    assert summary["cells"]["n_too_few_months"] == 1
    assert summary["cells"]["analyzed_area_fraction_of_grid"] == pytest.approx(0.75)
    assert summary["significant"]["fdr"] == {
        "n_cells": 1,
        "cell_fraction": 0.5,
        "area_fraction": pytest.approx(1 / 3),
    }
    assert summary["significant"]["fdr_negative_slope"]["n_cells"] == 0
    # (0.5 × 1 + 1 × 4) ÷ 1.5 = 3
    assert summary["area_weighted_mean_slope_per_decade"] == pytest.approx(3.0)


def test_layers_clip_slopes_outside_the_int16_range_and_count_them():
    months = months_from(2001, 1, 120)
    t = np.arange(120.0)
    cube = np.stack([0.01 * t, 100.0 * t], axis=1)[:, :, None]
    grid = Grid(
        lat_south=0.0, lat_step=1.0, n_lat=2, lon_west=0.0, lon_step=1.0, n_lon=1
    )

    layers, meta, _ = trend_layers(
        months, cube, grid, PARAMS, unit="K", slope_scale=0.001
    )

    assert [layer.name for layer in layers] == [
        "trend_slope_per_decade",
        "trend_significance",
    ]
    assert layers[0].unit == "K per decade"
    # 10 個完整年：1.2 × attenuation(10)；第二格超出 32767 × 0.001，夾在邊界
    assert layers[0].values[0, :, 0].tolist() == pytest.approx(
        [1.2 * attenuation(10), 32.767]
    )
    assert layers[1].dtype == "uint8"
    assert meta["n_slope_cells_clipped_to_int16_range"] == 1
    assert meta["replaces"] == "exploratory_linear_slope_per_decade.i16"
