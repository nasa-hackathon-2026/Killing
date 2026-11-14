"""統一格式：轉月規則與靜態檔的寫出（母票 #4）。"""

import json
from datetime import date
from pathlib import Path

import pytest

from trend_detective.series import (
    Series,
    daily_to_monthly_points,
    monthly_points,
    write_catalog,
    write_series,
)


def test_monthly_data_keeps_one_point_per_month_with_full_coverage():
    points = monthly_points([(date(2020, 1, 1), 0.075), (date(2020, 2, 1), None)])

    assert points == [
        {"month": "2020-01-01", "value": 0.075, "n_samples": 1, "coverage": 1},
        {"month": "2020-02-01", "value": None, "n_samples": 0, "coverage": 0},
    ]


def test_daily_data_averages_valid_days_and_reports_coverage():
    # 2021 年 2 月有 28 天；有值的 2 天平均 = (10 + 20) / 2
    rows = [
        (date(2021, 2, 1), 10.0),
        (date(2021, 2, 2), 20.0),
        (date(2021, 2, 3), None),
        (date(2021, 3, 5), 4.0),
    ]

    assert daily_to_monthly_points(rows) == [
        {"month": "2021-02-01", "value": 15.0, "n_samples": 2, "coverage": 2 / 28},
        {"month": "2021-03-01", "value": 4.0, "n_samples": 1, "coverage": 1 / 31},
    ]


def _series(retrieved_at: str, value: float = 0.075) -> Series:
    return Series(
        variable_id="imerg_precip",
        location_id="taichung",
        aggregation="point",
        unit="mm/hr",
        source_api="giovanni",
        request={"data": "GPM_3IMERGM_07_precipitation", "location": [24.15, 120.68]},
        retrieved_at=retrieved_at,
        product_version="07",
        grid={"lat": 24.15, "lon": 120.649994},
        points=monthly_points([(date(2020, 1, 1), value)]),
    )


def test_series_file_is_named_by_variable_location_and_aggregation(tmp_path: Path):
    path = write_series(tmp_path, _series("2026-11-14T08:00:00Z"))

    assert path == tmp_path / "series" / "imerg_precip__taichung__point.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["unit"] == "mm/hr"
    assert saved["points"] == [
        {"month": "2020-01-01", "value": 0.075, "n_samples": 1, "coverage": 1}
    ]


def test_rewriting_identical_data_leaves_the_file_byte_for_byte_unchanged(
    tmp_path: Path,
):
    path = write_series(tmp_path, _series("2026-11-14T08:00:00Z"))
    before = path.read_bytes()

    write_series(tmp_path, _series("2026-11-15T09:00:00Z"))

    assert path.read_bytes() == before


def test_rewriting_changed_data_overwrites_and_records_the_new_retrieval_time(
    tmp_path: Path,
):
    write_series(tmp_path, _series("2026-11-14T08:00:00Z"))

    path = write_series(tmp_path, _series("2026-11-15T09:00:00Z", value=0.5))

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["retrieved_at"] == "2026-11-15T09:00:00Z"
    assert saved["points"][0]["value"] == 0.5


def test_catalog_lists_series_with_counts_range_and_latest_month(tmp_path: Path):
    series = Series(
        **{
            **_series("2026-11-14T08:00:00Z").__dict__,
            "points": monthly_points(
                [
                    (date(2001, 1, 1), 0.1),
                    (date(2025, 9, 1), 0.2),
                    (date(2025, 10, 1), None),
                ]
            ),
        }
    )
    write_series(tmp_path, series)
    variables = [{"id": "imerg_precip", "name_zh": "降水"}]
    locations = [{"id": "taichung", "kind": "point", "lat": 24.15, "lon": 120.68}]

    path = write_catalog(
        tmp_path, variables, locations, [series], generated_at="2026-11-14T08:00:00Z"
    )

    catalog = json.loads(path.read_text(encoding="utf-8"))
    assert path == tmp_path / "catalog.json"
    assert catalog["variables"] == variables
    assert catalog["locations"] == locations
    assert catalog["series"] == [
        {
            "variable_id": "imerg_precip",
            "location_id": "taichung",
            "aggregation": "point",
            "file": "series/imerg_precip__taichung__point.json",
            "n_points": 3,
            "first_month": "2001-01-01",
            "last_month": "2025-10-01",
        }
    ]
    # 最新月份看的是最後一個有值的月
    assert catalog["snapshot"] == {
        "generated_at": "2026-11-14T08:00:00Z",
        "latest_month": {"imerg_precip": "2025-09-01"},
    }


def test_regenerating_an_identical_catalog_keeps_the_original_generated_at(
    tmp_path: Path,
):
    series = _series("2026-11-14T08:00:00Z")
    args = ([{"id": "imerg_precip"}], [{"id": "taichung"}], [series])
    path = write_catalog(tmp_path, *args, generated_at="2026-11-14T08:00:00Z")
    before = path.read_bytes()

    write_catalog(tmp_path, *args, generated_at="2026-11-15T09:00:00Z")

    assert path.read_bytes() == before


def test_two_rows_in_the_same_month_are_rejected_for_monthly_data():
    with pytest.raises(ValueError, match="2020-01"):
        monthly_points([(date(2020, 1, 1), 1.0), (date(2020, 1, 15), 2.0)])


def test_catalog_marks_a_variable_without_any_value_as_having_no_latest_month(
    tmp_path: Path,
):
    series = Series(
        **{
            **_series("2026-11-14T08:00:00Z").__dict__,
            "points": monthly_points([(date(2020, 1, 1), None)]),
        }
    )

    path = write_catalog(
        tmp_path, [], [], [series], generated_at="2026-11-14T08:00:00Z"
    )

    catalog = json.loads(path.read_text(encoding="utf-8"))
    assert catalog["snapshot"]["latest_month"] == {"imerg_precip": None}
