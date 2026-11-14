"""NOAA GHCNh 測站氣溫：PSV 解析、逐時轉日、日轉月與天數門檻。"""

from datetime import date, datetime
from pathlib import Path

import pytest

from trend_detective.ghcnh import (
    hourly_to_daily,
    parse_psv,
    station_monthly_points,
)

FIXTURE = Path(__file__).parent / "fixtures" / "ghcnh_taichung_2025_sample.psv"


def test_parse_reads_timestamp_and_temperature_by_column_name():
    rows = parse_psv(FIXTURE.read_text(encoding="utf-8"))

    assert len(rows) == 19
    assert rows[0] == (datetime(2025, 1, 1, 0, 0), 15.5)
    assert rows[-1] == (datetime(2025, 1, 3, 21, 0), 14.6)


def test_parse_skips_rows_without_a_temperature():
    text = (
        "STATION|DATE|temperature\nX|2025-01-01T00:00:00|\nX|2025-01-01T03:00:00|20.5\n"
    )

    assert parse_psv(text) == [(datetime(2025, 1, 1, 3, 0), 20.5)]


def test_parse_rejects_a_file_without_the_expected_columns():
    with pytest.raises(ValueError, match="temperature"):
        parse_psv("STATION|DATE\nX|2025-01-01T00:00:00\n")


def test_hourly_observations_are_averaged_per_local_day():
    # 測站在 UTC+8：UTC 01-01 18:00 是當地 01-02 02:00
    daily = hourly_to_daily(
        parse_psv(FIXTURE.read_text(encoding="utf-8")), utc_offset_hours=8
    )

    assert [(day, n) for day, _, n in daily] == [
        (date(2025, 1, 1), 5),
        (date(2025, 1, 2), 7),
        (date(2025, 1, 3), 5),
        (date(2025, 1, 4), 2),
    ]
    # 01-01 當地：15.5、18.0、18.0、17.1、16.5
    assert daily[0][1] == pytest.approx(17.02)
    # 01-02 當地：16.2、16.2、16.2、18.1、19.5、19.0、18.0
    assert daily[1][1] == pytest.approx(17.6)


def _days(month: int, count: int, value: float) -> list[tuple[date, float, int]]:
    return [(date(2021, month, day), value, 8) for day in range(1, count + 1)]


def test_month_with_enough_days_gets_the_mean_of_daily_means():
    daily = _days(2, 14, 10.0) + [
        (date(2021, 2, day), 20.0, 8) for day in range(15, 29)
    ]

    assert station_monthly_points(daily, min_days=20) == [
        {"month": "2021-02-01", "value": 15.0, "n_samples": 28, "coverage": 1.0}
    ]


def test_month_below_the_day_threshold_has_no_value_but_keeps_the_day_count():
    points = station_monthly_points(_days(3, 19, 12.0), min_days=20)

    assert points == [
        {"month": "2021-03-01", "value": None, "n_samples": 19, "coverage": 19 / 31}
    ]


def test_months_without_any_observation_between_data_are_filled_as_missing():
    daily = _days(1, 31, 5.0) + _days(3, 31, 7.0)

    months = [
        (p["month"], p["value"], p["n_samples"])
        for p in station_monthly_points(daily, min_days=20)
    ]

    assert months == [
        ("2021-01-01", 5.0, 31),
        ("2021-02-01", None, 0),
        ("2021-03-01", 7.0, 31),
    ]
