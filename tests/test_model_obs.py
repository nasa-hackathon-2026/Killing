"""模式推算 vs 觀測（#97）：配對與統計是純函式，不連資料庫。"""

import math

import numpy as np
import pytest

from trend_detective import cleaning, model_obs

PARAMS = model_obs.PairParams()
RULES = {
    "groups": [
        {
            "id": "stations",
            "quantity": "near_surface_air_temperature",
            "locations": ["taipei_station", "stn_x"],
            "observations": [{"variable_id": "station_temp", "aggregation": "station"}],
            "models": [
                {
                    "variable_id": "gldas_tair",
                    "source": "grid_cube_cell",
                    "cube_id": "g",
                },
                {
                    "variable_id": "power_t2m",
                    "source": "series",
                    "aggregation": "point",
                    "only_locations": ["taipei_station"],
                    "location_map": {"taipei_station": "taipei"},
                },
            ],
        },
        {
            "id": "cities",
            "quantity": "near_surface_air_temperature",
            "monthly": False,
            "locations": ["tokyo", "lagos"],
            "observations": [
                {"variable_id": "ghcnm_tavg", "aggregation": "point"},
                {"variable_id": "gistemp_anom", "aggregation": "point"},
            ],
            "models": [
                {
                    "variable_id": "merra2_t2m",
                    "source": "series",
                    "aggregation": "point",
                }
            ],
        },
    ]
}
AVAILABLE = {
    "station_temp__taipei_station__station",
    "station_temp__stn_x__station",
    "power_t2m__taipei__point",
    "ghcnm_tavg__tokyo__point",
    "gistemp_anom__tokyo__point",
    "gistemp_anom__lagos__point",
    "merra2_t2m__tokyo__point",
}


def months(first: str, n: int) -> list[int]:
    start = cleaning.month_index(first)
    return [start + i for i in range(n)]


def seasonal(index: int) -> float:
    return 5.0 * math.sin(2 * math.pi * (index % 12) / 12)


def test_expand_pairs_skips_missing_series_and_maps_locations() -> None:
    pairs = model_obs.expand_pairs(RULES, AVAILABLE)
    ids = [pair.pair_id for pair in pairs]
    assert ids == [
        "gldas_tair__station_temp__taipei_station",
        "power_t2m__station_temp__taipei_station",
        "gldas_tair__station_temp__stn_x",
        "merra2_t2m__ghcnm_tavg__tokyo",
        "merra2_t2m__gistemp_anom__tokyo",
    ]
    power = pairs[1]
    assert power.model_location_id == "taipei" and power.location_id == "taipei_station"
    assert pairs[0].model_source == model_obs.SOURCE_CUBE and pairs[0].monthly
    # 拉哥斯：有 GISTEMP 但沒有模式序列，也沒有 GHCNm，所以沒有配對
    assert not any(pair.location_id == "lagos" for pair in pairs)
    assert pairs[3].monthly is False


def test_common_anomalies_use_only_shared_months_inside_the_window() -> None:
    index = months("2000-01-01", 400)
    model = {i: 290.0 + seasonal(i) for i in index}
    obs = {i: 17.0 + seasonal(i) for i in index if i % 7}
    common, model_anomaly, obs_anomaly = model_obs.common_anomalies(model, obs, PARAMS)
    first = cleaning.month_index("2001-01-01")
    last = cleaning.month_index("2025-12-01")
    assert common[0] >= first and common[-1] <= last
    assert all(int(i) % 7 for i in common)
    # 兩邊只有季節循環：去掉各自的月氣候值之後都是 0，單位與基準不同也一樣
    assert np.allclose(model_anomaly, 0, atol=1e-9)
    assert np.allclose(obs_anomaly, 0, atol=1e-9)


def test_pair_statistics_recovers_trends_and_their_difference() -> None:
    index = months("2001-01-01", 300)
    rng = np.random.default_rng(0)
    noise = rng.normal(0, 0.3, 300)
    # 模式每十年 +0.5、觀測每十年 +0.2；共用同一份雜訊，所以差值就是 0.3 的斜率
    model = {
        i: 290 + seasonal(i) + 0.05 * (k / 12) + noise[k] for k, i in enumerate(index)
    }
    obs = {
        i: 17 + seasonal(i) + 0.02 * (k / 12) + noise[k] for k, i in enumerate(index)
    }
    result = model_obs.pair_statistics(model, obs, PARAMS)
    assert result["status"] == "analyzed" and result["n_common_months"] == 300
    # 去月氣候值會吃掉一點年內的趨勢，所以不是剛好 0.3
    assert result["slope_difference"] == pytest.approx(0.3, abs=2e-3)
    assert result["difference"]["trend"]["slope_per_decade"] == pytest.approx(
        result["slope_difference"]
    )
    assert result["difference"]["trend"]["significant"] is True
    assert result["difference"]["mean"] == pytest.approx(0, abs=1e-9)
    assert result["correlation"] > 0.8
    low, high = result["model_trend"]["ci_per_decade"]
    assert low < result["model_trend"]["slope_per_decade"] < high
    monthly = result["monthly"]
    assert monthly["first_month"] == "2001-01-01"
    assert len(monthly["difference"]) == 300


def test_pair_statistics_matches_trends_module_on_the_same_months() -> None:
    from trend_detective import trends

    index = months("2001-01-01", 300)
    rng = np.random.default_rng(1)
    model = {i: 290 + seasonal(i) + rng.normal(0, 1) for i in index}
    obs = {i: 17 + seasonal(i) + rng.normal(0, 1) for i in index if i % 11}
    result = model_obs.pair_statistics(model, obs, PARAMS)
    common, model_anomaly, _ = model_obs.common_anomalies(model, obs, PARAMS)
    expected = trends.ols_trend(common, model_anomaly, PARAMS.alpha)
    assert result["model_trend"]["slope_per_decade"] == expected["slope_per_decade"]
    assert result["model_trend"]["ci_per_decade"] == expected["ci_per_decade"]


def test_too_few_common_months_is_insufficient() -> None:
    index = months("2001-01-01", 100)
    series = {i: float(i % 5) for i in index}
    result = model_obs.pair_statistics(series, series, PARAMS)
    assert result["status"] == "insufficient" and result["n_common_months"] == 100
    assert "correlation" not in result


def test_largest_step_finds_the_month_the_new_level_starts() -> None:
    index = np.array(months("2001-01-01", 120))
    values = np.zeros(120)
    values[70:] = 0.8  # 2006-11 起高 0.8
    values[30] = np.nan
    keep = np.isfinite(values)
    step, month = model_obs.largest_step(index[keep], values[keep], PARAMS)
    assert step == pytest.approx(0.8)
    assert month is not None and cleaning.index_month(month) == "2006-11-01"


def test_largest_step_needs_enough_months_on_both_sides() -> None:
    index = np.array(months("2001-01-01", 8))
    step, month = model_obs.largest_step(index, np.arange(8.0), PARAMS)
    assert step is None and month is None


def test_annual_means_need_nine_months() -> None:
    monthly = {
        "first_month": "2001-03-01",
        "model_anomaly": [1.0] * 22,
        "obs_anomaly": [0.5] * 22,
        "difference": [0.5] * 10 + [None] * 4 + [0.5] * 8,
    }
    annual = model_obs.annual_means(monthly)
    assert annual["first_year"] == 2001
    assert annual["model_anomaly"] == [1.0, 1.0]
    # 2001 年有 10 個月（3–12 月）；2002 年的差值只有 8 個月
    assert annual["difference"] == [0.5, None]


def test_nearest_cell_falls_back_when_the_containing_cell_is_empty() -> None:
    lat = np.array([21.875, 22.125, 22.375])
    lon = np.array([120.625, 120.875, 121.125])
    has_values = np.ones((3, 3), dtype=bool)
    first = model_obs.nearest_cell_with_values(lat, lon, has_values, 22.1, 120.9)
    assert first is not None and first[:2] == (1, 1) and first[3] is False
    has_values[1, 1] = False
    cell = model_obs.nearest_cell_with_values(lat, lon, has_values, 22.1, 120.9)
    assert cell is not None and cell[3] is True and cell[:2] != (1, 1)
    assert cell[2] == pytest.approx(
        model_obs.haversine_km(22.1, 120.9, lat[cell[0]], lon[cell[1]])
    )
    assert (
        model_obs.nearest_cell_with_values(
            lat, lon, np.zeros((3, 3), dtype=bool), 22.1, 120.9
        )
        is None
    )


def test_known_issue_with_location_pattern_only_matches_that_location() -> None:
    issue = cleaning.KnownIssue(
        id="airport",
        kind="sampling_change",
        summary_en="x",
        source_doc="x",
        variable_id="station_temp",
        location_pattern="^stn_twi0000rckh$",
    )
    assert issue.matches("station_temp", "station", "stn_twi0000rckh")
    assert not issue.matches("station_temp", "station", "taipei_station")
    # 呼叫端沒給地點：限定地點的問題不算符合
    assert not issue.matches("station_temp", "station")
