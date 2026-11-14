"""Giovanni 單點時間序列：解析錄下的 CSV，以及 HTTP 邊界的行為。"""

from datetime import date
from pathlib import Path

import httpx
import pytest

from trend_detective.giovanni import (
    GiovanniClient,
    GiovanniError,
    QuotaExceeded,
    parse_timeseries_csv,
)

FIXTURE = Path(__file__).parent / "fixtures" / "giovanni_imerg_taichung_2020.csv"
SECRET = "secret-token-value"


def test_parse_reads_unit_grid_coordinates_and_product_from_metadata():
    series = parse_timeseries_csv(FIXTURE.read_text(encoding="utf-8"))

    assert series.unit == "mm/hr"
    assert series.grid_lat == 24.15
    assert series.grid_lon == 120.649994
    assert series.product == "GPM_3IMERGM.07"
    assert series.doi == "10.5067/GPM/IMERG/3B-MONTH/07"


def test_parse_skips_metadata_and_returns_one_row_per_data_line():
    series = parse_timeseries_csv(FIXTURE.read_text(encoding="utf-8"))

    assert len(series.rows) == 12
    assert series.rows[0] == (date(2020, 1, 1), 0.075)
    assert series.rows[-1] == (date(2020, 12, 1), 0.1)


def test_parse_turns_the_declared_fill_value_into_none():
    text = (
        "unit,K\nundef,-9999.9\nlat,1.0\nlon,2.0\n\n"
        "Timestamp (UTC),Data\n2020-01-01 00:00,-9999.9\n2020-02-01 00:00,280.5\n"
    )

    assert parse_timeseries_csv(text).rows == [
        (date(2020, 1, 1), None),
        (date(2020, 2, 1), 280.5),
    ]


def test_parse_rejects_a_response_without_a_data_table():
    with pytest.raises(GiovanniError):
        parse_timeseries_csv('{"message": "Unauthorized"}')


def _client(handler) -> GiovanniClient:
    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://giovanni.test/"
    )
    return GiovanniClient(token=SECRET, http=http)


def test_fetch_checks_quota_first_then_requests_the_point_series():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        assert request.headers["Authorization"] == f"Bearer {SECRET}"
        if request.url.path == "/quota":
            return httpx.Response(200, json={"status": 200, "quota": 0.1})
        assert dict(request.url.params) == {
            "data": "GPM_3IMERGM_07_precipitation",
            "location": "[24.15,120.68]",
            "time": "2001-01-01T00:00:00/2026-11-14T23:59:59",
        }
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    text, request = _client(handler).fetch_timeseries(
        "GPM_3IMERGM_07_precipitation",
        lat=24.15,
        lon=120.68,
        start=date(2001, 1, 1),
        end=date(2026, 11, 14),
    )

    assert calls == ["/quota", "/timeseries"]
    assert text.startswith("prod_name,GPM_3IMERGM.07")
    assert request == {
        "data": "GPM_3IMERGM_07_precipitation",
        "location": [24.15, 120.68],
        "time": "2001-01-01T00:00:00/2026-11-14T23:59:59",
    }


def test_fetch_stops_before_requesting_data_when_quota_is_nearly_used_up():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"status": 200, "quota": 0.95})

    with pytest.raises(QuotaExceeded):
        _client(handler).fetch_timeseries(
            "X", lat=1, lon=2, start=date(2001, 1, 1), end=date(2001, 2, 1)
        )

    assert calls == ["/quota"]


def test_http_error_message_never_contains_the_token():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="Unauthorized")

    with pytest.raises(GiovanniError) as err:
        _client(handler).quota()

    assert "401" in str(err.value)
    assert SECRET not in str(err.value)


def _table(*lines: str, undef: str = "-9999.9") -> str:
    head = f"unit,K\nundef,{undef}\nlat,1.0\nlon,2.0\n\nTimestamp (UTC),Data\n"
    return head + "\n".join(lines) + "\n"


def test_parse_treats_nan_and_empty_values_as_missing():
    text = _table("2020-01-01 00:00,NaN", "2020-02-01 00:00,", "2020-03-01 00:00,1.5")

    assert [value for _, value in parse_timeseries_csv(text).rows] == [None, None, 1.5]


def test_parse_matches_the_fill_value_despite_float32_rounding():
    text = _table("2020-01-01 00:00,-9999.900391")

    assert parse_timeseries_csv(text).rows == [(date(2020, 1, 1), None)]


@pytest.mark.parametrize(
    "text",
    [
        "unit,K\n\nTimestamp (UTC),Data\n2020-01-01 00:00,1.0\n",  # 缺 lat、lon
        _table("2020-01-01 00:00,abc"),  # 值不是數字
        _table("2020-01-01 00:00"),  # 只有一欄
        _table("2020-01-01,1.0"),  # 時間格式不對
    ],
)
def test_parse_reports_malformed_content_as_giovanni_error(text: str):
    with pytest.raises(GiovanniError):
        parse_timeseries_csv(text)
