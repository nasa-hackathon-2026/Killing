"""台灣 GHCNh 測站擴充：測站清單篩選、盤點表上限、保留判斷與合理性統計（不連網）。"""

import json
from datetime import date
from pathlib import Path

import pytest

from trend_detective import ghcnh_taiwan as gt

FIXTURES = Path(__file__).parent / "fixtures" / "ghcnh_taiwan"

REGIONS = {
    "north": [121.0, 24.6, 122.1, 25.4],
    "central": [120.2, 23.5, 121.3, 24.6],
    "south": [120.0, 21.8, 121.0, 23.5],
    "east": [121.0, 22.3, 121.8, 24.6],
}


def stations() -> dict[str, gt.Station]:
    text = (FIXTURES / "station_list_sample.csv").read_text(encoding="utf-8")
    return {s.id: s for s in gt.parse_station_list(text)}


def test_station_list_is_read_by_column_name():
    found = stations()

    assert len(found) == 8
    tainan = found["CHM00059358"]
    assert (tainan.lat, tainan.lon, tainan.elevation_m) == (23.0, 120.2167, 14.0)
    assert (tainan.name, tainan.wmo_id, tainan.iso_code) == ("TAINAN", "59358", "CN")
    assert found["TWI0000RCKH"].icao == "RCKH"
    assert found["TWA00467440"].wmo_id == ""


def test_search_box_keeps_taiwan_and_the_coast_but_not_other_countries():
    inside = {i for i, s in stations().items() if gt.in_search_box(s)}

    assert "ACM00078861" not in inside
    assert {"CHM00059358", "CHM00059567", "TWI0000RCKH", "CHA00591330"} <= inside


def test_candidate_class_follows_the_explicit_decision_then_the_country_code():
    decisions = {
        "CHM00059358": {"class": "taiwan", "reason": "WMO 59358"},
        "CHA00591330": {"class": "mainland_coast", "reason": "Jinjiang, Fujian"},
    }
    found = stations()

    assert gt.candidate_class(found["TWI0000RCKH"], decisions)[0] == "taiwan"
    assert gt.candidate_class(found["CHM00059358"], decisions) == (
        "taiwan",
        "WMO 59358",
    )
    assert gt.candidate_class(found["CHA00591330"], decisions)[0] == "mainland_coast"
    # 國別碼是 CN 又沒有明確判斷的測站不猜，列為待確認
    assert gt.candidate_class(found["CHU00000054"], decisions)[0] == "needs_review"


def test_region_uses_the_seed_boxes_and_marks_islands_offshore():
    found = stations()

    assert (
        gt.assign_region(found["CHM00059358"], REGIONS, offshore_ids=set()) == "south"
    )
    assert (
        gt.assign_region(found["TWI0000RCKH"], REGIONS, offshore_ids=set()) == "south"
    )
    # 蘭嶼在 east 的方框裡的經度範圍，但緯度在方框外，而且是離島
    assert (
        gt.assign_region(found["CHM00059567"], REGIONS, offshore_ids=set())
        == "offshore"
    )
    # 明確列為離島的測站，就算座標落在區域方框內也標 offshore
    assert (
        gt.assign_region(found["CHM00059358"], REGIONS, offshore_ids={"CHM00059358"})
        == "offshore"
    )


def test_region_boxes_that_overlap_resolve_in_a_fixed_order():
    overlap = gt.Station("X", 24.0, 121.1, 100.0, "", "X", "", "", "TW")

    assert gt.assign_region(overlap, REGIONS, offshore_ids=set()) == "east"


def test_inventory_is_filtered_to_the_requested_stations():
    text = (FIXTURES / "inventory_sample.txt").read_text(encoding="utf-8")

    inventory = gt.parse_inventory(text, {"CHM00059567", "TWA00467440"})

    assert set(inventory) == {"CHM00059567", "TWA00467440"}
    assert inventory["CHM00059567"][2001][:3] == [181, 57, 180]
    assert sorted(inventory["CHM00059567"]) == [1973, 2001, 2025]


def test_inventory_upper_bound_counts_only_months_with_enough_observations():
    text = (FIXTURES / "inventory_sample.txt").read_text(encoding="utf-8")
    inventory = gt.parse_inventory(text, {"CHM00059567"})

    # 2001 年：57 筆那個月不到 20 天，所以那個月不可能有月平均；其餘 11 個月可能
    assert gt.max_possible_months(inventory["CHM00059567"], 2001, 2001) == 12
    assert gt.max_possible_months({2001: [5] * 12}, 2001, 2001) == 0
    assert gt.max_possible_months({2001: [19] * 11 + [20]}, 2001, 2001) == 1
    # 範圍外的年份不算
    assert gt.max_possible_months(inventory["CHM00059567"], 2002, 2024) == 0


def test_inventory_years_lists_years_with_any_observation():
    inventory = {1999: [0] * 12, 2000: [0] * 11 + [3], 2001: [10] * 12}

    assert gt.inventory_years(inventory) == [2000, 2001]
    assert gt.inventory_years(inventory, first=2001, last=2001) == [2001]


def point(month: str, value: float | None, coverage: float = 1.0) -> dict:
    return {"month": month, "value": value, "n_samples": 30, "coverage": coverage}


def test_valid_months_counts_values_in_range_above_the_coverage_threshold():
    points = [
        point("2000-12-01", 20.0),  # 範圍之前
        point("2001-01-01", 15.0),
        point("2001-02-01", None, 0.5),  # 不到 20 天，沒有月平均
        point("2001-03-01", 18.0, 0.2),  # 覆蓋度低於 0.25
        point("2001-04-01", 21.0, 0.9),
        point("2026-01-01", 14.0),  # 範圍之後
    ]

    assert gt.valid_months(points, date(2001, 1, 1), date(2025, 12, 1)) == 2


def test_station_is_kept_only_with_enough_valid_months():
    assert gt.keep_decision(240, minimum=240) == (True, "kept")
    keep, reason = gt.keep_decision(239, minimum=240)
    assert not keep and reason == "too_few_valid_months"


def test_trend_per_decade_recovers_a_known_slope_and_ignores_months_outside_the_range():
    # 每個月比上個月高 0.01 °C → 每年 0.12 → 每十年 1.2 °C；季節循環是同一個月份的多年平均會吸收的
    points = []
    for year in range(2001, 2011):
        for month in range(1, 13):
            index = (year - 2001) * 12 + month - 1
            points.append(point(f"{year}-{month:02d}-01", 10 + 0.01 * index))
    points.append(point("1999-01-01", 99.0))  # 範圍外，不該影響斜率

    slope = gt.trend_per_decade(points, date(2001, 1, 1), date(2010, 12, 1))

    assert slope == pytest.approx(1.2, rel=0.02)
    assert gt.trend_per_decade(points[:5], date(2001, 1, 1), date(2010, 12, 1)) is None


def test_median_daily_observations_uses_only_days_in_the_year_range():
    daily = [
        (date(2002, 1, 1), 10.0, 8),
        (date(2002, 1, 2), 10.0, 24),
        (date(2002, 1, 3), 10.0, 8),
        (date(2010, 1, 1), 10.0, 48),
    ]

    assert gt.median_daily_observations(daily, 2001, 2005) == 8
    assert gt.median_daily_observations(daily, 2001, 2010) == 16
    assert gt.median_daily_observations(daily, 2020, 2025) is None


def test_observations_per_year_counts_hourly_rows_by_utc_year():
    from datetime import datetime

    rows = [
        (datetime(2001, 12, 31, 23), 1.0),
        (datetime(2002, 1, 1, 0), 2.0),
        (datetime(2002, 1, 1, 1), 3.0),
    ]

    assert gt.observations_per_year(rows) == {2001: 1, 2002: 2}


def test_station_series_is_built_with_the_core_algorithm_and_records_the_request():
    from datetime import datetime

    # UTC 每天 00–19 時各一筆、連續 21 天；當地（UTC+8）日界線把它們分到 22 個當地日，22 ≥ 20 所以有月平均
    rows = [
        (datetime(2001, 1, day, hour), 10.0 + day)
        for day in range(1, 22)
        for hour in range(20)
    ]
    station = stations()["CHM00059567"]

    result = gt.build_station_series(
        station,
        rows,
        retrieved_at="2026-11-15T00:00:00Z",
        file_urls={2001: "https://example.test/GHCNh_CHM00059567_2001.psv"},
    )
    series = result.series

    assert series.variable_id == "station_temp"
    assert series.location_id == "stn_chm00059567"
    assert (series.aggregation, series.unit, series.source_api) == (
        "station",
        "degC",
        "noaa_ghcnh",
    )
    assert series.points[0]["month"] == "2001-01-01"
    assert series.points[0]["n_samples"] == 22
    assert series.points[0]["value"] is not None
    assert series.request["station"] == "CHM00059567"
    assert series.request["station_name"] == "LAN YU"
    assert series.request["min_days_per_month"] == 20
    assert series.request["local_day_utc_offset_hours"] == 8
    assert series.request["observations_per_year"] == {"2001": 420}
    assert series.request["file_urls"] == {
        "2001": "https://example.test/GHCNh_CHM00059567_2001.psv"
    }
    assert result.daily[0][2] > 0


def test_location_id_follows_the_lowercase_station_id():
    assert gt.location_id("TWI0000RCKH") == "stn_twi0000rckh"


def _kept_result() -> tuple[gt.Station, gt.StationResult]:
    from datetime import datetime

    rows = [
        (datetime(2001, 1, day, hour), 15.0)
        for day in range(1, 29)
        for hour in range(0, 24, 3)
    ]
    station = stations()["CHM00059567"]
    result = gt.build_station_series(
        station, rows, retrieved_at="2026-11-15T00:00:00Z", file_urls={}
    )
    return station, result


def _seed(locations: list[dict]) -> dict:
    return {
        "variables": [
            {
                "id": "station_temp",
                "reuse_core_variable": True,
                "data_kind": "in_situ",
                "note_zh": "新來源的說明",
            }
        ],
        "core_stations": {"CHM00058968": "taipei_station"},
        "locations": locations,
    }


def test_outputs_include_series_catalog_stations_and_the_core_stations_note(tmp_path):

    station, result = _kept_result()
    variables_seed = tmp_path / "variables.json"
    variables_seed.write_text(
        json.dumps(
            [{"id": "station_temp", "name_zh": "測站月均溫", "note_zh": "核心"}]
        ),
        encoding="utf-8",
    )
    location = {"id": "stn_chm00059567", "kind": "point", "ghcnh_id": station.id}

    kept = gt.write_outputs(
        tmp_path / "out",
        _seed([location]),
        [{"id": station.id, "decision": "kept"}],
        [(station, result)],
        {station.id: {"valid_months_2001_2025": 1}},
        "2026-11-15T00:00:00Z",
        variables_seed_path=variables_seed,
    )

    out = tmp_path / "out"
    assert kept == [station.id]
    assert (out / "series" / "station_temp__stn_chm00059567__station.json").exists()
    catalog = json.loads((out / "catalog.json").read_text(encoding="utf-8"))
    assert catalog["locations"] == [location]
    assert catalog["variables"][0]["name_zh"] == "測站月均溫"  # 沿用核心的欄位
    assert catalog["variables"][0]["note_zh"] == "新來源的說明"  # 本來源的說明蓋過核心
    assert catalog["variables"][0]["data_kind"] == "in_situ"
    assert catalog["already_in_core_snapshot"] == [
        {"ghcnh_id": "CHM00058968", "location_id": "taipei_station"}
    ]
    assert catalog["series"][0]["file"].endswith("stn_chm00059567__station.json")
    assert json.loads((out / "stations.json").read_text(encoding="utf-8"))["stations"]
    assert json.loads((out / "sanity.json").read_text(encoding="utf-8"))


def test_a_kept_station_without_a_seed_location_is_an_error(tmp_path):
    station, result = _kept_result()
    variables_seed = tmp_path / "variables.json"
    variables_seed.write_text(json.dumps([{"id": "station_temp"}]), encoding="utf-8")

    with pytest.raises(KeyError, match="CHM00059567"):
        gt.write_outputs(
            tmp_path / "out",
            _seed([]),
            [],
            [(station, result)],
            {},
            "2026-11-15T00:00:00Z",
            variables_seed_path=variables_seed,
        )
