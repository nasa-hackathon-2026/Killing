"""NASA POWER 月平均：回應解析（排除年平均鍵、fill value 轉缺值）。"""

import json
from datetime import date
from pathlib import Path

import pytest

from trend_detective.power import PowerError, parse_monthly

FIXTURE = Path(__file__).parent / "fixtures" / "power_t2m_taichung_2025_2026.json"


def test_parse_keeps_twelve_months_per_year_and_drops_the_annual_mean_key():
    parsed = parse_monthly(json.loads(FIXTURE.read_text(encoding="utf-8")), "T2M")

    months = [day for day, _ in parsed.rows]
    assert len(months) == 23  # 2025 全年 + 2026-01 到 2026-11；202513 不算
    assert months[0] == date(2025, 1, 1)
    assert months[-1] == date(2026, 11, 1)
    assert date(2025, 12, 1) in months


def test_parse_turns_the_fill_value_into_none_and_reads_unit_and_source():
    parsed = parse_monthly(json.loads(FIXTURE.read_text(encoding="utf-8")), "T2M")

    values = dict(parsed.rows)
    assert values[date(2025, 11, 1)] == 22.77
    assert values[date(2026, 9, 1)] == 26.24
    assert values[date(2026, 10, 1)] is None  # 回應裡是 -999.0
    assert parsed.unit == "C"
    assert parsed.sources == ["MERRA2"]
    assert parsed.api_version == "v2.10.0"


def test_parse_reports_a_response_without_the_parameter_as_power_error():
    with pytest.raises(PowerError, match="T2M"):
        parse_monthly({"properties": {"parameter": {}}}, "T2M")


def _payload(values: dict) -> dict:
    return {
        "header": {"fill_value": -999.0},
        "properties": {"parameter": {"T2M": values}},
    }


def test_parse_treats_null_and_string_fill_values_as_missing():
    parsed = parse_monthly(
        _payload({"202501": None, "202502": "-999", "202503": 20.5}), "T2M"
    )

    assert [value for _, value in parsed.rows] == [None, None, 20.5]


@pytest.mark.parametrize("key", ["ANN", "2025-01", "20251"])
def test_parse_rejects_a_key_that_is_not_year_and_month(key: str):
    with pytest.raises(PowerError, match=key):
        parse_monthly(_payload({key: 20.0}), "T2M")


def test_parse_rejects_a_response_without_any_value():
    with pytest.raises(PowerError, match="沒有任何有值"):
        parse_monthly(_payload({"202501": -999.0, "202513": -999.0}), "T2M")
