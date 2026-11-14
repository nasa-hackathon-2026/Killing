"""AppEEARS 統計 CSV → 區域月序列：解析、區域對應、8 日轉月。"""

from datetime import date
from pathlib import Path

import pytest

from trend_detective.appeears_stats import (
    StatRow,
    composites_to_monthly_points,
    parse_statistics_csv,
    region_ids_by_aid,
)

FIXTURE = Path(__file__).parent / "fixtures" / "appeears_ndvi"
STATS = FIXTURE / "MOD13A3-061-Statistics.csv"
REQUEST = FIXTURE / "trend-detective-modis-ndvi-20261114-request.json"


def test_parse_reads_dataset_region_code_date_and_statistics():
    rows = parse_statistics_csv(STATS.read_text(encoding="utf-8"))

    assert len(rows) == 6
    assert rows[0] == StatRow(
        dataset="_1_km_monthly_NDVI",
        aid="aid0001",
        day=date(2001, 1, 1),
        count=46822,
        mean=0.6766119,
        standard_deviation=0.2021808,
        minimum=-0.1964,
        maximum=1.0,
        median=0.76005,
    )
    # NDVI 已套用 scale factor：平均值落在 -1 到 1
    assert all(-1 <= row.mean <= 1 for row in rows if row.mean is not None)


def test_parse_rejects_a_file_without_the_statistics_columns():
    with pytest.raises(ValueError, match="Mean"):
        parse_statistics_csv("File Name,Dataset,aid,Date\nx,y,aid0001,2001-01-01\n")


def test_region_codes_follow_the_feature_order_of_the_request():
    assert region_ids_by_aid(REQUEST.read_text(encoding="utf-8")) == {
        "aid0001": "taiwan",
        "aid0002": "north",
        "aid0003": "central",
        "aid0004": "south",
        "aid0005": "east",
    }


def _row(day: date, mean: float | None, count: int = 100) -> StatRow:
    return StatRow("LST_Day_1km", "aid0001", day, count, mean, None, None, None, None)


def test_monthly_composites_become_one_point_each_with_pixel_coverage():
    rows = [
        _row(date(2001, 1, 1), 0.6, count=80),
        _row(date(2001, 2, 1), 0.7, count=100),
    ]

    assert composites_to_monthly_points(rows) == [
        {"month": "2001-01-01", "value": 0.6, "n_samples": 1, "coverage": 0.8},
        {"month": "2001-02-01", "value": 0.7, "n_samples": 1, "coverage": 1.0},
    ]


def test_eight_day_composites_are_assigned_to_the_month_they_start_in():
    # 01-25 起的合成期跨到 2 月，仍依起始日歸 1 月
    rows = [
        _row(date(2001, 1, 1), 290.0),
        _row(date(2001, 1, 9), 292.0),
        _row(date(2001, 1, 17), 294.0),
        _row(date(2001, 1, 25), 296.0),
        _row(date(2001, 2, 2), 300.0, count=50),
    ]

    assert composites_to_monthly_points(rows) == [
        {"month": "2001-01-01", "value": 293.0, "n_samples": 4, "coverage": 1.0},
        {"month": "2001-02-01", "value": 300.0, "n_samples": 1, "coverage": 0.5},
    ]


def test_composites_without_valid_pixels_do_not_count_as_samples():
    rows = [_row(date(2001, 3, 6), None, count=0), _row(date(2001, 3, 14), 295.0)]

    assert composites_to_monthly_points(rows) == [
        {"month": "2001-03-01", "value": 295.0, "n_samples": 1, "coverage": 0.5}
    ]
