"""快照：從 Giovanni 回應到靜態檔的整條路，用錄下的 CSV、不連網。"""

import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from trend_detective.giovanni import GiovanniClient
from trend_detective.snapshot import SnapshotResult, build_snapshot, load_seed

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
    assert [
        loc["id"]
        for loc in locations
        if loc["kind"] == "point" and "ghcnh_id" not in loc
    ] == [
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


from trend_detective.harmony import HarmonyClient
from trend_detective.regions import DEFAULT_REGIONS

AREA_FIXTURE = (
    Path(__file__).parent / "fixtures" / "harmony_gldas_tair_taiwan_sample.csv"
)
TAIR = {
    **PRECIP,
    "id": "gldas_tair",
    "source_variable_id": "GLDAS_NOAH025_M_2_1_Tair_f_inst",
    "harmony_collection": "C1-GES_DISC",
}
TAIWAN = {"id": "taiwan", "kind": "region", "bbox": [120.0, 21.8, 122.1, 25.4]}
TAIWAN_POINT = {"id": "taiwan", "kind": "point", "lat": 23.7, "lon": 121.0}


def _harmony(calls: list[str], final_status: str = "successful") -> HarmonyClient:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append(path)
        if path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        if path.endswith("/rangeset"):
            return httpx.Response(
                200, json={"jobID": f"job-{len(calls)}", "status": "running"}
            )
        if path.startswith("/jobs/"):
            links = [{"rel": "data", "href": "https://harmony.test/results/out.csv"}]
            return httpx.Response(200, json={"status": final_status, "links": links})
        return httpx.Response(200, text=AREA_FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://harmony.test/"
    )
    return HarmonyClient(token=SECRET, http=http)


def _point_then_area(tmp_path: Path, calls: list[str], **extra) -> SnapshotResult:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_csv("2020-01-01 00:00,290.5"))

    return build_snapshot(
        _client(respond),
        tmp_path,
        [TAIR],
        [TAIWAN_POINT, TAIWAN],
        harmony_client=_harmony(calls, **extra),
        sleep=lambda seconds: None,
        **RUN,
    )


def test_area_mean_series_is_written_next_to_the_point_series_of_the_same_place(
    tmp_path: Path,
):
    result = _point_then_area(tmp_path, [])

    assert result.succeeded == [("gldas_tair", "taiwan"), ("gldas_tair", "taiwan")]
    point = json.loads(
        (tmp_path / "series" / "gldas_tair__taiwan__point.json").read_text()
    )
    area = json.loads(
        (tmp_path / "series" / "gldas_tair__taiwan__area_mean.json").read_text()
    )
    assert len(point["points"]) == 1
    assert area["aggregation"] == "area_mean"
    assert area["source_api"] == "harmony"
    assert area["unit"] == "K"  # 與同變數的點位序列相同
    assert area["request"]["bbox"] == [120.0, 21.8, 122.1, 25.4]
    assert len(area["points"]) == 27
    assert area["points"][0] == {
        "month": "2001-01-01",
        "value": 288.3125,
        "n_samples": 1,
        "coverage": 1,
    }
    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert [s["aggregation"] for s in catalog["series"]] == ["area_mean", "point"]


def test_a_failed_harmony_job_is_reported_and_writes_no_area_series(tmp_path: Path):
    result = _point_then_area(tmp_path, [], final_status="failed")

    assert "failed" in result.failures[("gldas_tair", "taiwan")]
    assert not (tmp_path / "series" / "gldas_tair__taiwan__area_mean.json").exists()


def test_same_day_rerun_reuses_the_finished_job_result_instead_of_submitting_again(
    tmp_path: Path,
):
    raw = tmp_path / "raw"
    args = (None, tmp_path / "snap", [TAIR], [TAIWAN])
    point = tmp_path / "snap" / "series" / "gldas_tair__taichung__point.json"
    build_snapshot(
        _client(
            lambda request: httpx.Response(200, text=_csv("2020-01-01 00:00,290.5"))
        ),
        tmp_path / "snap",
        [TAIR],
        [TAICHUNG],
        **RUN,
    )
    assert point.exists()
    build_snapshot(
        *args, harmony_client=_harmony([]), raw_dir=raw, sleep=lambda s: None, **RUN
    )

    calls: list[str] = []
    result = build_snapshot(
        *args, harmony_client=_harmony(calls), raw_dir=raw, sleep=lambda s: None, **RUN
    )

    assert not any(path.endswith("/rangeset") for path in calls)
    assert result.succeeded == [("gldas_tair", "taiwan")]


def test_seed_regions_match_the_default_regions_and_carry_bbox_and_geojson():
    _, locations = load_seed(SEED_DIR)

    regions = [loc for loc in locations if loc["kind"] == "region"]
    assert [(r["id"], tuple(r["bbox"])) for r in regions] == [
        (r.id, r.bbox) for r in DEFAULT_REGIONS
    ]
    assert all(r["geojson"]["geometry"]["type"] == "Polygon" for r in regions)


def test_area_job_starts_at_the_first_month_the_product_has_data(tmp_path: Path):
    # AIRS、OMI 的第一筆晚於 2001-01；Harmony 會拒絕更早的起始日
    submitted: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        if path.endswith("/rangeset"):
            submitted.extend(
                v for k, v in request.url.params.multi_items() if "time" in v
            )
            return httpx.Response(200, json={"jobID": "job-1"})
        if path.startswith("/jobs/"):
            links = [{"rel": "data", "href": "https://harmony.test/results/out.csv"}]
            return httpx.Response(200, json={"status": "successful", "links": links})
        return httpx.Response(200, text=AREA_FIXTURE.read_text(encoding="utf-8"))

    harmony = HarmonyClient(
        token=SECRET,
        http=httpx.Client(
            transport=httpx.MockTransport(handler), base_url="https://harmony.test/"
        ),
    )
    build_snapshot(
        _client(
            lambda request: httpx.Response(
                200, text=_csv("2004-09-01 00:00,-9999", "2004-10-01 00:00,290.5")
            )
        ),
        tmp_path,
        [TAIR],
        [TAIWAN_POINT, TAIWAN],
        harmony_client=harmony,
        sleep=lambda seconds: None,
        **RUN,
    )

    assert submitted == ['time("2004-10-01T00:00:00Z":"2026-11-14T23:59:59Z")']
    area = json.loads(
        (tmp_path / "series" / "gldas_tair__taiwan__area_mean.json").read_text()
    )
    assert area["request"]["start"] == "2004-10-01"


def _scripted_harmony(
    script: dict[str, list[tuple[int, Any]]], submitted: list[str]
) -> HarmonyClient:
    """每個 job id 依序回 script 裡的回應，最後一個回應會一直重複。"""
    polls: dict[str, int] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        if path.endswith("/rangeset"):
            job_id = f"job-{len(submitted) + 1}"
            submitted.append(job_id)
            return httpx.Response(200, json={"jobID": job_id})
        if path.startswith("/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            answers = script.get(job_id, script["*"])
            index = min(polls.get(job_id, 0), len(answers) - 1)
            polls[job_id] = polls.get(job_id, 0) + 1
            kind, body = answers[index]
            return (
                httpx.Response(kind, json=body)
                if isinstance(body, dict)
                else httpx.Response(kind, text=body)
            )
        return httpx.Response(200, text=AREA_FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://harmony.test/"
    )
    return HarmonyClient(token=SECRET, http=http)


RUNNING = (200, {"status": "running", "links": []})
BLIP = (502, "bad gateway")
DONE = (
    200,
    {
        "status": "successful",
        "links": [{"rel": "data", "href": "https://harmony.test/results/out.csv"}],
    },
)


def _write_point_series(snapshot_dir: Path) -> None:
    build_snapshot(
        _client(
            lambda request: httpx.Response(200, text=_csv("2020-01-01 00:00,290.5"))
        ),
        snapshot_dir,
        [TAIR],
        [TAICHUNG],
        **RUN,
    )


def test_job_that_is_still_running_is_polled_until_it_finishes_despite_a_blip(
    tmp_path: Path,
):
    _write_point_series(tmp_path)
    naps: list[float] = []

    result = build_snapshot(
        None,
        tmp_path,
        [TAIR],
        [TAIWAN],
        harmony_client=_scripted_harmony({"*": [RUNNING, BLIP, RUNNING, DONE]}, []),
        sleep=naps.append,
        **RUN,
    )

    assert result.failures == {}
    assert result.succeeded == [("gldas_tair", "taiwan")]
    assert len(naps) == 3


def test_more_jobs_than_the_batch_size_are_all_submitted_and_finished(tmp_path: Path):
    _write_point_series(tmp_path)
    regions = [{**TAIWAN, "id": f"r{i}"} for i in range(8)]
    submitted: list[str] = []

    result = build_snapshot(
        None,
        tmp_path,
        [TAIR],
        regions,
        harmony_client=_scripted_harmony({"*": [RUNNING, DONE]}, submitted),
        sleep=lambda seconds: None,
        **RUN,
    )

    assert len(submitted) == 8
    assert sorted(result.succeeded) == [("gldas_tair", f"r{i}") for i in range(8)]


def test_interrupted_run_picks_up_the_running_job_instead_of_submitting_again(
    tmp_path: Path,
):
    snap, raw = tmp_path / "snap", tmp_path / "raw"
    _write_point_series(snap)
    (raw / "harmony").mkdir(parents=True)
    (raw / "harmony" / "jobs.json").write_text(
        json.dumps(
            {
                "gldas_tair__taiwan": {
                    "job_id": "old-job",
                    "end": "2026-11-14",
                    "status": "running",
                }
            }
        )
    )
    submitted: list[str] = []

    result = build_snapshot(
        None,
        snap,
        [TAIR],
        [TAIWAN],
        harmony_client=_scripted_harmony({"*": [DONE]}, submitted),
        raw_dir=raw,
        sleep=lambda seconds: None,
        **RUN,
    )

    assert submitted == []
    assert result.succeeded == [("gldas_tair", "taiwan")]
    assert (raw / "harmony" / "gldas_tair__taiwan.csv").exists()


def test_region_without_any_grid_cell_of_the_product_is_skipped_not_failed(
    tmp_path: Path,
):
    _write_point_series(tmp_path)
    submitted: list[str] = []
    coarse = {**TAIR, "harmony_skip_regions": ["taiwan"]}

    result = build_snapshot(
        None,
        tmp_path,
        [coarse],
        [TAIWAN],
        harmony_client=_scripted_harmony({"*": [DONE]}, submitted),
        sleep=lambda seconds: None,
        **RUN,
    )

    assert submitted == []
    assert result.failures == {}


def test_sources_that_did_not_run_keep_their_series_and_are_listed_as_not_updated(
    tmp_path: Path,
):
    # 例如沒有 token：Giovanni 來源沒跑，但快照仍完整
    build_snapshot(_client(), tmp_path, [PRECIP, POWER_T2M], [TAICHUNG], **RUN)
    power_http = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, text=POWER_FIXTURE.read_text(encoding="utf-8")
            )
        )
    )

    result = build_snapshot(
        None, tmp_path, [PRECIP, POWER_T2M], [TAICHUNG], power_http=power_http, **RUN
    )

    assert result.failures == {}
    assert result.not_updated == [("imerg_precip", "taichung", "point")]
    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert [s["variable_id"] for s in catalog["series"]] == [
        "imerg_precip",
        "power_t2m",
    ]


def test_a_full_regeneration_moves_only_the_snapshot_date_when_data_is_unchanged(
    tmp_path: Path,
):
    build_snapshot(_client(), tmp_path, [PRECIP], [TAICHUNG], stamp=True, **RUN)
    series_before = (
        tmp_path / "series" / "imerg_precip__taichung__point.json"
    ).read_bytes()
    catalog_before = json.loads((tmp_path / "catalog.json").read_text())

    build_snapshot(
        _client(),
        tmp_path,
        [PRECIP],
        [TAICHUNG],
        stamp=True,
        today=date(2026, 11, 15),
        now="2026-11-15T09:00:00Z",
    )

    catalog_after = json.loads((tmp_path / "catalog.json").read_text())
    assert (
        tmp_path / "series" / "imerg_precip__taichung__point.json"
    ).read_bytes() == series_before
    assert catalog_after["snapshot"]["generated_at"] == "2026-11-15T09:00:00Z"
    catalog_before["snapshot"]["generated_at"] = "2026-11-15T09:00:00Z"
    assert catalog_after == catalog_before


APPEEARS_FIXTURE = Path(__file__).parent / "fixtures" / "appeears_ndvi"
NDVI = {
    "id": "modis_ndvi",
    "source": "appeears",
    "source_variable_id": "_1_km_monthly_NDVI",
    "product": "MOD13A3.061",
    "product_version": "061",
    "native_temporal_res": "month",
    "is_nasa": True,
    "unit": "1",
    "valid_range": [-1, 1],
}
EAST = {"id": "east", "kind": "region", "bbox": [121.0, 22.3, 121.8, 24.6]}


def _appeears_task(
    root: Path, task_id: str, task_name: str, *, downloaded: bool = True
) -> None:
    task_dir = root / "modis_ndvi" / task_id
    task_dir.mkdir(parents=True)
    (task_dir / "submission.json").write_text(
        json.dumps({"task_id": task_id, "request": {"task_name": task_name}})
    )
    if downloaded:
        for path in APPEEARS_FIXTURE.iterdir():
            (task_dir / path.name).write_text(path.read_text(encoding="utf-8"))


def test_downloaded_appeears_statistics_become_area_mean_series_per_region(
    tmp_path: Path,
):
    raw = tmp_path / "raw" / "appeears"
    _appeears_task(raw, "task-1", "trend-detective-modis_ndvi-20261114")

    result = build_snapshot(
        None, tmp_path / "snap", [NDVI], [TAIWAN, EAST], appeears_dir=raw, **RUN
    )

    assert result.failures == {}
    assert result.succeeded == [("modis_ndvi", "taiwan"), ("modis_ndvi", "east")]
    series = json.loads(
        (tmp_path / "snap" / "series" / "modis_ndvi__east__area_mean.json").read_text()
    )
    assert series["source_api"] == "appeears"
    assert series["unit"] == "1"
    assert [p["month"] for p in series["points"]] == [
        "2001-01-01",
        "2001-02-01",
        "2026-10-01",
    ]
    assert series["points"][0]["value"] == 0.7721598
    assert all(-1 <= p["value"] <= 1 for p in series["points"])
    # coverage = 有值像元數 ÷ 這個區域出現過的最大像元數（14850）
    assert series["points"][0]["coverage"] == 14730 / 14850
    assert series["request"]["tasks"] == [
        {"task_name": "trend-detective-modis_ndvi-20261114", "task_id": "task-1"}
    ]


def test_a_variable_sent_in_parts_is_not_written_until_every_part_is_downloaded(
    tmp_path: Path,
):
    raw = tmp_path / "raw" / "appeears"
    _appeears_task(raw, "task-1", "trend-detective-modis_ndvi-20261114-p1of2")
    _appeears_task(
        raw, "task-2", "trend-detective-modis_ndvi-20261114-p2of2", downloaded=False
    )

    result = build_snapshot(
        None, tmp_path / "snap", [NDVI], [TAIWAN], appeears_dir=raw, **RUN
    )

    assert "還沒下載" in result.failures[("modis_ndvi", "taiwan")]
    assert not (tmp_path / "snap" / "series").exists()


def test_a_value_outside_the_plausible_range_fails_the_variable(tmp_path: Path):
    raw = tmp_path / "raw" / "appeears"
    _appeears_task(raw, "task-1", "trend-detective-modis_ndvi-20261114")
    kelvin_by_mistake = {**NDVI, "valid_range": [250, 340]}

    result = build_snapshot(
        None, tmp_path / "snap", [kelvin_by_mistake], [TAIWAN], appeears_dir=raw, **RUN
    )

    assert "合理範圍" in result.failures[("modis_ndvi", "taiwan")]
