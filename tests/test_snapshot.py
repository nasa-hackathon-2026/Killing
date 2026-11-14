"""快照：從 Giovanni 回應到靜態檔的整條路，用錄下的 CSV、不連網。"""

import json
from datetime import date
from pathlib import Path

import httpx

from trend_detective.giovanni import GiovanniClient
from trend_detective.snapshot import build_snapshot, load_seed

FIXTURE = Path(__file__).parent / "fixtures" / "giovanni_imerg_taichung_2020.csv"
SEED_DIR = Path(__file__).parents[1] / "data" / "seed"
SECRET = "secret-token-value"
RUN = {"today": date(2026, 11, 14), "now": "2026-11-14T08:00:00Z"}

PRECIP = {
    "id": "imerg_precip",
    "name_zh": "降水",
    "source": "giovanni",
    "source_variable_id": "GPM_3IMERGM_07_precipitation",
    "product_version": "07",
    "native_temporal_res": "month",
    "is_nasa": True,
}
NO2 = {
    **PRECIP,
    "id": "omi_no2",
    "source_variable_id": "NO2",
    "native_temporal_res": "day",
}
TAICHUNG = {"id": "taichung", "kind": "point", "lat": 24.15, "lon": 120.68}
HUALIEN = {
    "id": "hualien",
    "kind": "point",
    "lat": 23.99,
    "lon": 121.60,
    "inland_direction": [0, -1],
}


def _csv(*rows: str, lat: float = 24.125, lon: float = 120.625) -> str:
    return (
        f"unit,K\nundef,-9999\nlat,{lat}\nlon,{lon}\n"
        "lat_resolution,0.25\nlon_resolution,0.25\n\nTimestamp (UTC),Data\n"
        + "\n".join(rows)
        + "\n"
    )


def _client(respond=None) -> GiovanniClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/quota":
            return httpx.Response(200, json={"status": 200, "quota": 0.0})
        if respond is not None:
            return respond(request)
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://giovanni.test/"
    )
    return GiovanniClient(token=SECRET, http=http)


def test_snapshot_writes_taichung_precipitation_series_matching_the_csv(
    tmp_path: Path,
):
    build_snapshot(_client(), tmp_path, [PRECIP], [TAICHUNG], **RUN)

    series = json.loads(
        (tmp_path / "series" / "imerg_precip__taichung__point.json").read_text()
    )
    assert series["unit"] == "mm/hr"  # 與 CSV 的 unit 行一致
    assert len(series["points"]) == 12  # 與 CSV 的資料列數一致
    assert all(p["month"].endswith("-01") for p in series["points"])
    assert series["points"][4] == {
        "month": "2020-05-01",
        "value": 0.495,
        "n_samples": 1,
        "coverage": 1,
    }
    assert series["grid"] == {"lat": 24.15, "lon": 120.649994}
    assert series["request"] == {
        "data": "GPM_3IMERGM_07_precipitation",
        "location": [24.15, 120.68],
        "start": "2001-01-01",
        "end_policy": "run_date",
    }


def test_catalog_describes_each_variable_with_unit_and_valid_period_from_the_data(
    tmp_path: Path,
):
    build_snapshot(_client(), tmp_path, [PRECIP], [TAICHUNG], **RUN)

    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert catalog["series"][0]["file"] == "series/imerg_precip__taichung__point.json"
    assert catalog["snapshot"]["latest_month"] == {"imerg_precip": "2020-12-01"}
    variable = catalog["variables"][0]
    assert variable["unit"] == "mm/hr"
    assert variable["valid_from"] == "2020-01-01"
    assert variable["valid_to"] == "2020-12-01"


def test_daily_variable_is_stored_monthly_with_sample_count_and_coverage(
    tmp_path: Path,
):
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=_csv(
                "2021-02-01 00:00,10", "2021-02-02 00:00,-9999", "2021-02-03 00:00,20"
            ),
        )

    build_snapshot(_client(respond), tmp_path, [NO2], [TAICHUNG], **RUN)

    series = json.loads(
        (tmp_path / "series" / "omi_no2__taichung__point.json").read_text()
    )
    assert series["points"] == [
        {"month": "2021-02-01", "value": 15.0, "n_samples": 2, "coverage": 2 / 28}
    ]


def test_masked_coastal_point_is_retried_one_grid_cell_inland_and_recorded(
    tmp_path: Path,
):
    asked = []

    def respond(request: httpx.Request) -> httpx.Response:
        location = request.url.params["location"]
        asked.append(location)
        if location == "[23.99,121.6]":
            return httpx.Response(
                200, text=_csv("2020-01-01 00:00,-9999", lat=23.875, lon=121.625)
            )
        return httpx.Response(
            200, text=_csv("2020-01-01 00:00,290.5", lat=23.875, lon=121.375)
        )

    result = build_snapshot(_client(respond), tmp_path, [PRECIP], [HUALIEN], **RUN)

    assert asked == ["[23.99,121.6]", "[23.99,121.35]"]
    series = json.loads(
        (tmp_path / "series" / "imerg_precip__hualien__point.json").read_text()
    )
    assert series["request"]["location"] == [23.99, 121.35]
    assert series["request"]["requested_location"] == [23.99, 121.6]
    assert series["grid"] == {"lat": 23.875, "lon": 121.375}
    assert series["points"][0]["value"] == 290.5
    assert result.failures == {}


def test_masked_point_without_an_inland_direction_is_reported_not_written(
    tmp_path: Path,
):
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_csv("2020-01-01 00:00,-9999"))

    result = build_snapshot(_client(respond), tmp_path, [PRECIP], [TAICHUNG], **RUN)

    assert list(result.failures) == [("imerg_precip", "taichung")]
    assert "遮罩" in result.failures[("imerg_precip", "taichung")]
    assert not (tmp_path / "series" / "imerg_precip__taichung__point.json").exists()


def test_one_failing_series_does_not_stop_the_rest_of_the_batch(tmp_path: Path):
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.params["data"] == "NO2":
            return httpx.Response(500, text="boom")
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    result = build_snapshot(
        _client(respond), tmp_path, [NO2, PRECIP], [TAICHUNG], **RUN
    )

    assert result.succeeded == [("imerg_precip", "taichung")]
    assert "500" in result.failures[("omi_no2", "taichung")]
    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert [s["variable_id"] for s in catalog["series"]] == ["imerg_precip"]
    assert catalog["snapshot"]["latest_month"] == {
        "imerg_precip": "2020-12-01",
        "omi_no2": None,
    }


def test_a_failed_refetch_keeps_the_previously_written_series_in_the_catalog(
    tmp_path: Path,
):
    build_snapshot(_client(), tmp_path, [PRECIP], [TAICHUNG], **RUN)

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    build_snapshot(_client(respond), tmp_path, [PRECIP], [TAICHUNG], **RUN)

    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert catalog["series"][0]["n_points"] == 12


def test_raw_responses_are_kept_per_series_when_a_raw_dir_is_given(tmp_path: Path):
    raw = tmp_path / "raw"

    build_snapshot(
        _client(), tmp_path / "snap", [PRECIP], [TAICHUNG], raw_dir=raw, **RUN
    )

    saved = raw / "giovanni" / "imerg_precip__taichung.csv"
    assert saved.read_text(encoding="utf-8") == FIXTURE.read_text(encoding="utf-8")


def test_rerunning_on_a_later_day_changes_no_file_and_no_file_holds_the_token(
    tmp_path: Path,
):
    build_snapshot(_client(), tmp_path, [PRECIP], [TAICHUNG], **RUN)
    before = {p: p.read_bytes() for p in tmp_path.rglob("*.json")}

    build_snapshot(
        _client(),
        tmp_path,
        [PRECIP],
        [TAICHUNG],
        today=date(2026, 11, 15),
        now="2026-11-15T09:00:00Z",
    )

    assert {p: p.read_bytes() for p in tmp_path.rglob("*.json")} == before
    assert all(SECRET.encode() not in content for content in before.values())


def test_seed_lists_ten_giovanni_variables_and_five_points_with_student_facing_text():
    variables, locations = load_seed(SEED_DIR)

    assert len([v for v in variables if v["source"] == "giovanni"]) == 10
    assert len({v["id"] for v in variables}) == len(variables)
    for variable in variables:
        assert (
            variable["name_zh"] and variable["definition_zh"] and variable["category"]
        )
    assert [loc["id"] for loc in locations if "ghcnh_id" not in loc] == [
        "taichung",
        "taipei",
        "kaohsiung",
        "hualien",
        "yushan",
    ]


def test_an_unexpected_error_in_one_series_is_recorded_and_the_batch_continues(
    tmp_path: Path,
):
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.params["data"] == "DUP":
            # 月資料同月兩列：轉換階段才會出錯
            return httpx.Response(
                200, text=_csv("2020-01-01 00:00,1", "2020-01-15 00:00,2")
            )
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    dup = {**PRECIP, "id": "dup", "source_variable_id": "DUP"}
    result = build_snapshot(
        _client(respond), tmp_path, [dup, PRECIP], [TAICHUNG], **RUN
    )

    assert result.succeeded == [("imerg_precip", "taichung")]
    assert "2020-01" in result.failures[("dup", "taichung")]
    assert (tmp_path / "catalog.json").exists()


def test_an_unreadable_previous_file_does_not_crash_a_failed_refetch(tmp_path: Path):
    old = tmp_path / "series" / "imerg_precip__taichung__point.json"
    old.parent.mkdir(parents=True)
    old.write_text('{"variable_id": "imerg_precip"}', encoding="utf-8")

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    result = build_snapshot(_client(respond), tmp_path, [PRECIP], [TAICHUNG], **RUN)

    assert "500" in result.failures[("imerg_precip", "taichung")]
    assert json.loads((tmp_path / "catalog.json").read_text())["series"] == []


def test_batch_stops_requesting_data_once_quota_is_nearly_used_up(tmp_path: Path):
    data_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/quota":
            used = 0.0 if not data_requests else 0.96
            return httpx.Response(200, json={"status": 200, "quota": used})
        data_requests.append(request.url.params["data"])
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://giovanni.test/"
    )
    result = build_snapshot(
        GiovanniClient(token=SECRET, http=http),
        tmp_path,
        [PRECIP, NO2, {**NO2, "id": "third"}],
        [TAICHUNG],
        **RUN,
    )

    assert data_requests == ["GPM_3IMERGM_07_precipitation"]
    assert result.succeeded == [("imerg_precip", "taichung")]
    assert set(result.failures) == {("omi_no2", "taichung"), ("third", "taichung")}


def test_an_empty_table_is_reported_as_no_data_without_inland_retries(tmp_path: Path):
    asked = []

    def respond(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.params["location"])
        return httpx.Response(200, text=_csv())

    result = build_snapshot(_client(respond), tmp_path, [PRECIP], [HUALIEN], **RUN)

    assert len(asked) == 1
    assert "沒有資料列" in result.failures[("imerg_precip", "hualien")]


def test_only_giovanni_variables_are_fetched_from_giovanni(tmp_path: Path):
    modis = {**PRECIP, "id": "modis_ndvi", "source": "appeears"}

    result = build_snapshot(_client(), tmp_path, [modis, PRECIP], [TAICHUNG], **RUN)

    assert result.succeeded == [("imerg_precip", "taichung")]
    assert result.failures == {}


STATION_FIXTURE = Path(__file__).parent / "fixtures" / "ghcnh_taichung_2025_sample.psv"
STATION_TEMP = {
    "id": "station_temp",
    "source": "noaa_ghcnh",
    "source_variable_id": "temperature",
    "product_version": "GHCNh",
    "native_temporal_res": "hour",
    "is_nasa": False,
}
TAICHUNG_STATION = {
    "id": "taichung_station",
    "kind": "point",
    "lat": 24.15,
    "lon": 120.68,
    "ghcnh_id": "CHM00059158",
}


def _station_http(requested: list[str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        if request.url.path.endswith("GHCNh_CHM00059158_2025.psv"):
            return httpx.Response(200, text=STATION_FIXTURE.read_text(encoding="utf-8"))
        return httpx.Response(404, text="NoSuchKey")

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_station_series_holds_only_monthly_values_marked_as_non_nasa_station_data(
    tmp_path: Path,
):
    requested: list[str] = []

    result = build_snapshot(
        None,
        tmp_path,
        [PRECIP, STATION_TEMP],
        [TAICHUNG, TAICHUNG_STATION],
        station_http=_station_http(requested),
        **RUN,
    )

    assert result.succeeded == [("station_temp", "taichung_station")]
    assert len(requested) == 27  # 2000 到 2026 每年一個檔
    path = tmp_path / "series" / "station_temp__taichung_station__station.json"
    series = json.loads(path.read_text())
    assert series["aggregation"] == "station"
    assert series["unit"] == "degC"
    assert series["request"]["station"] == "CHM00059158"
    # fixture 只有 4 個當地日，不到 20 天門檻：有天數、沒有月平均
    assert series["points"] == [
        {"month": "2025-01-01", "value": None, "n_samples": 4, "coverage": 4 / 31}
    ]
    assert "|" not in path.read_text()  # 序列檔不含逐時原始資料


def test_running_one_source_keeps_other_sources_series_in_the_catalog(tmp_path: Path):
    build_snapshot(
        _client(), tmp_path, [PRECIP, STATION_TEMP], [TAICHUNG, TAICHUNG_STATION], **RUN
    )

    build_snapshot(
        None,
        tmp_path,
        [PRECIP, STATION_TEMP],
        [TAICHUNG, TAICHUNG_STATION],
        station_http=_station_http([]),
        **RUN,
    )

    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert [(s["variable_id"], s["aggregation"]) for s in catalog["series"]] == [
        ("imerg_precip", "point"),
        ("station_temp", "station"),
    ]


def test_files_older_than_last_year_are_read_from_the_raw_cache(tmp_path: Path):
    raw = tmp_path / "raw"
    args = (None, tmp_path / "snap", [STATION_TEMP], [TAICHUNG_STATION])
    later = {"today": date(2027, 6, 1), "now": "2027-06-01T00:00:00Z"}
    build_snapshot(*args, station_http=_station_http([]), raw_dir=raw, **later)
    assert (raw / "ghcnh" / "GHCNh_CHM00059158_2025.psv").exists()

    requested: list[str] = []
    build_snapshot(*args, station_http=_station_http(requested), raw_dir=raw, **later)

    assert not any("_2025.psv" in path for path in requested)


def test_last_years_file_is_downloaded_again_after_the_year_turns(tmp_path: Path):
    # 2026 年底那次執行存下的 2026 年檔還不完整，隔年要再抓一次才補得齊
    raw = tmp_path / "raw"
    args = (None, tmp_path / "snap", [STATION_TEMP], [TAICHUNG_STATION])
    build_snapshot(*args, station_http=_station_http([]), raw_dir=raw, **RUN)

    requested: list[str] = []
    build_snapshot(
        *args,
        station_http=_station_http(requested),
        raw_dir=raw,
        today=date(2027, 1, 5),
        now="2027-01-05T00:00:00Z",
    )

    assert any("_2026.psv" in path for path in requested)
    assert any("_2027.psv" in path for path in requested)
    assert not any("_2025.psv" in path for path in requested)


POWER_FIXTURE = Path(__file__).parent / "fixtures" / "power_t2m_taichung_2025_2026.json"
POWER_T2M = {
    "id": "power_t2m",
    "source": "nasa_power",
    "source_variable_id": "T2M",
    "product_version": "MERRA-2",
    "native_temporal_res": "month",
    "is_nasa": True,
}


def test_power_series_is_written_for_points_only_under_its_own_variable_id(
    tmp_path: Path,
):
    asked: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(dict(request.url.params))
        return httpx.Response(200, text=POWER_FIXTURE.read_text(encoding="utf-8"))

    result = build_snapshot(
        None,
        tmp_path,
        [POWER_T2M],
        [TAICHUNG, TAICHUNG_STATION],
        power_http=httpx.Client(transport=httpx.MockTransport(handler)),
        **RUN,
    )

    assert result.succeeded == [("power_t2m", "taichung")]
    assert asked == [
        {
            "parameters": "T2M",
            "community": "AG",
            "longitude": "120.68",
            "latitude": "24.15",
            "start": "2001",
            "end": "2026",
            "format": "JSON",
        }
    ]
    series = json.loads(
        (tmp_path / "series" / "power_t2m__taichung__point.json").read_text()
    )
    assert series["unit"] == "C"
    assert series["source_api"] == "nasa_power"
    assert "end" not in series["request"]
    assert len(series["points"]) == 21
    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert catalog["snapshot"]["latest_month"] == {"power_t2m": "2026-09-01"}


def test_a_failing_power_request_is_reported_and_keeps_the_previous_file(
    tmp_path: Path,
):
    ok = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, text=POWER_FIXTURE.read_text(encoding="utf-8")
            )
        )
    )
    build_snapshot(None, tmp_path, [POWER_T2M], [TAICHUNG], power_http=ok, **RUN)

    for bad in (httpx.Response(500, text="boom"), httpx.Response(200, text="<html>")):
        failing = httpx.Client(transport=httpx.MockTransport(lambda request, r=bad: r))
        result = build_snapshot(
            None, tmp_path, [POWER_T2M], [TAICHUNG], power_http=failing, **RUN
        )
        assert list(result.failures) == [("power_t2m", "taichung")]

    series = json.loads(
        (tmp_path / "series" / "power_t2m__taichung__point.json").read_text()
    )
    assert len(series["points"]) == 21


def test_power_series_ends_at_the_last_month_that_has_a_value(tmp_path: Path):
    http = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, text=POWER_FIXTURE.read_text(encoding="utf-8")
            )
        )
    )

    build_snapshot(None, tmp_path, [POWER_T2M], [TAICHUNG], power_http=http, **RUN)

    series = json.loads(
        (tmp_path / "series" / "power_t2m__taichung__point.json").read_text()
    )
    assert series["points"][-1]["month"] == "2026-09-01"
    assert series["request"]["api_version"] == "v2.10.0"
    assert series["request"]["sources"] == ["MERRA2"]
