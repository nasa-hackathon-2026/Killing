"""Harmony（Giovanni Averaging Service）區域平均：CSV 解析與 HTTP 邊界。"""

from datetime import date
from pathlib import Path

import httpx
import pytest

from trend_detective.harmony import HarmonyClient, HarmonyError, parse_area_csv

FIXTURE = Path(__file__).parent / "fixtures" / "harmony_gldas_tair_taiwan_sample.csv"
SECRET = "secret-token-value"


def test_parse_reads_rows_after_the_comma_only_line_and_the_fill_value():
    parsed = parse_area_csv(FIXTURE.read_text(encoding="utf-8"))

    assert parsed.column == "mean_GLDAS_NOAH025_M_2_1_Tair_f_inst"
    assert parsed.bbox == [120.0, 21.8, 122.1, 25.4]
    assert len(parsed.rows) == 27
    assert parsed.rows[0] == (date(2001, 1, 1), 288.3125)
    assert parsed.rows[-1] == (date(2026, 7, 1), 297.01468)


def test_parse_turns_fill_and_empty_values_into_none():
    text = (
        "Fill Value:,-9999.0\n,\ntime,mean_X\n"
        "2020-01-01T00:00:00,-9999.0\n2020-01-02T00:00:00,\n2020-01-03T00:00:00,1.5\n"
    )

    assert [value for _, value in parse_area_csv(text).rows] == [None, None, 1.5]


@pytest.mark.parametrize(
    "text",
    ["<html>error</html>", "Fill Value:,-9999.0\n,\ntime,mean_X\nnot-a-date,1\n"],
)
def test_parse_reports_unexpected_content_as_harmony_error(text: str):
    with pytest.raises(HarmonyError):
        parse_area_csv(text)


def _client(handler) -> HarmonyClient:
    return HarmonyClient(
        token=SECRET,
        http=httpx.Client(
            transport=httpx.MockTransport(handler), base_url="https://harmony.test/"
        ),
    )


def test_submit_asks_for_an_area_average_csv_over_the_bbox_and_returns_the_job_id():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = request.url.params.multi_items()
        seen["auth"] = request.headers["Authorization"]
        return httpx.Response(200, json={"jobID": "job-1", "status": "running"})

    job_id = _client(handler).submit(
        "C1-GES_DISC",
        "VAR",
        bbox=[120.0, 21.8, 122.1, 25.4],
        start=date(2001, 1, 1),
        end=date(2026, 11, 14),
    )

    assert job_id == "job-1"
    assert seen["auth"] == f"Bearer {SECRET}"
    assert seen["path"] == (
        "/C1-GES_DISC/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset"
    )
    assert seen["params"] == [
        ("subset", "lat(21.8:25.4)"),
        ("subset", "lon(120.0:122.1)"),
        ("subset", 'time("2001-01-01T00:00:00Z":"2026-11-14T23:59:59Z")'),
        ("variable", "VAR"),
        ("format", "text/csv"),
        ("average", "area"),
    ]


def test_job_reports_status_and_the_result_file_link_when_finished():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/jobs/job-1"
        return httpx.Response(
            200,
            json={
                "status": "successful",
                "links": [
                    {"rel": "self", "href": "https://harmony.test/jobs/job-1"},
                    {"rel": "data", "href": "https://harmony.test/results/a.csv"},
                ],
            },
        )

    assert _client(handler).job("job-1") == (
        "successful",
        "https://harmony.test/results/a.csv",
    )


def test_error_message_never_contains_the_token():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="forbidden")

    with pytest.raises(HarmonyError) as err:
        _client(handler).job("job-1")

    assert "403" in str(err.value)
    assert SECRET not in str(err.value)
