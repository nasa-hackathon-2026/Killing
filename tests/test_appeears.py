"""AppEEARS 送件：在請求組裝與 HTTP 邊界兩個 seam 驗證行為。"""

import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from trend_detective.appeears import (
    MODIS_TASKS,
    AppeearsClient,
    AppeearsError,
    ModisTask,
    build_area_task,
    build_area_tasks,
    download_small_files,
    save_submission,
)
from trend_detective.regions import DEFAULT_REGIONS, regions_feature_collection

SECRET = "secret-token-value"


def test_default_regions_become_one_closed_polygon_feature_each():
    fc = regions_feature_collection(DEFAULT_REGIONS)

    assert fc["type"] == "FeatureCollection"
    assert [f["properties"]["id"] for f in fc["features"]] == [
        "taiwan",
        "north",
        "central",
        "south",
        "east",
    ]
    # 母票 #4：taiwan 的 bbox 是 W,S,E,N = 120.0, 21.8, 122.1, 25.4
    assert fc["features"][0]["geometry"] == {
        "type": "Polygon",
        "coordinates": [
            [
                [120.0, 21.8],
                [122.1, 21.8],
                [122.1, 25.4],
                [120.0, 25.4],
                [120.0, 21.8],
            ]
        ],
    }


def test_area_task_uses_appeears_date_format_and_requested_layers():
    task = build_area_task(
        MODIS_TASKS["modis_ndvi"], start=date(2001, 1, 1), end=date(2026, 11, 14)
    )

    assert task["task_type"] == "area"
    assert task["task_name"] == "trend-detective-modis_ndvi-20261114"
    params = task["params"]
    assert params["dates"] == [{"startDate": "01-01-2001", "endDate": "11-14-2026"}]
    assert params["layers"] == [
        {"product": "MOD13A3.061", "layer": "_1_km_monthly_NDVI"},
        {"product": "MOD13A3.061", "layer": "_1_km_monthly_pixel_reliability"},
    ]
    assert params["output"] == {
        "format": {"type": "netcdf4"},
        "projection": "geographic",
    }
    assert len(params["geo"]["features"]) == 5


def test_lst_task_requests_day_lst_with_its_qc_layer():
    task = build_area_task(
        MODIS_TASKS["modis_lst"], start=date(2001, 1, 1), end=date(2026, 11, 14)
    )

    assert task["params"]["layers"] == [
        {"product": "MOD11A2.061", "layer": "LST_Day_1km"},
        {"product": "MOD11A2.061", "layer": "QC_Day"},
    ]


def _client(handler) -> AppeearsClient:
    http = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://appeears.test/api/",
    )
    return AppeearsClient(token=SECRET, http=http)


def test_submit_posts_task_with_bearer_token_and_returns_task_id():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(202, json={"task_id": "abc-123", "status": "pending"})

    task = {"task_type": "area", "task_name": "t", "params": {}}
    assert _client(handler).submit(task) == "abc-123"
    assert seen == {
        "url": "https://appeears.test/api/task",
        "auth": f"Bearer {SECRET}",
        "body": task,
    }


def test_rejected_request_raises_with_server_message_but_never_the_token():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "no permission"})

    with pytest.raises(AppeearsError) as err:
        _client(handler).submit({})

    assert "403" in str(err.value)
    assert "no permission" in str(err.value)
    assert SECRET not in str(err.value)


def test_status_returns_the_task_state():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/task/abc-123"
        return httpx.Response(200, json={"task_id": "abc-123", "status": "done"})

    assert _client(handler).status("abc-123") == "done"


def test_saved_submission_records_request_without_any_credential(tmp_path: Path):
    task = build_area_task(
        MODIS_TASKS["modis_ndvi"], start=date(2001, 1, 1), end=date(2026, 11, 14)
    )

    path = save_submission(
        tmp_path, "modis_ndvi", "abc-123", task, submitted_at="2026-11-14T08:00:00Z"
    )

    assert path == tmp_path / "modis_ndvi" / "abc-123" / "submission.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["task_id"] == "abc-123"
    assert saved["submitted_at"] == "2026-11-14T08:00:00Z"
    assert saved["request"] == task


def test_download_keeps_statistics_csv_and_request_json_and_skips_rasters(
    tmp_path: Path,
):
    files = [
        {"file_id": "1", "file_name": "MOD13A3.061_1km_aid0001.nc", "file_size": 9e8},
        {"file_id": "2", "file_name": "MOD13A3-061-Statistics.csv", "file_size": 2e5},
        {"file_id": "3", "file_name": "trend-request.json", "file_size": 3e3},
        {"file_id": "4", "file_name": "README.md", "file_size": 2e4},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/bundle/abc-123":
            return httpx.Response(200, json={"files": files})
        file_id = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, content=f"content-{file_id}".encode())

    saved = download_small_files(_client(handler), "abc-123", tmp_path)

    assert sorted(p.name for p in saved) == [
        "MOD13A3-061-Statistics.csv",
        "README.md",
        "trend-request.json",
    ]
    assert (tmp_path / "MOD13A3-061-Statistics.csv").read_text() == "content-2"
    assert not (tmp_path / "MOD13A3.061_1km_aid0001.nc").exists()


def test_lst_is_split_into_two_consecutive_date_ranges_to_fit_the_file_limit():
    # 2026-11-14 實測：LST 2001 起一次送會超過 AppEEARS 檔案數上限 18.1%
    tasks = build_area_tasks(
        MODIS_TASKS["modis_lst"], start=date(2001, 1, 1), end=date(2026, 11, 14)
    )

    assert [t["task_name"] for t in tasks] == [
        "trend-detective-modis_lst-20261114-p1of2",
        "trend-detective-modis_lst-20261114-p2of2",
    ]
    assert [t["params"]["dates"] for t in tasks] == [
        [{"startDate": "01-01-2001", "endDate": "12-31-2013"}],
        [{"startDate": "01-01-2014", "endDate": "11-14-2026"}],
    ]


def test_ndvi_stays_a_single_task():
    tasks = build_area_tasks(
        MODIS_TASKS["modis_ndvi"], start=date(2001, 1, 1), end=date(2026, 11, 14)
    )

    assert [t["task_name"] for t in tasks] == ["trend-detective-modis_ndvi-20261114"]


def test_more_parts_than_years_yields_only_ranges_that_start_before_the_end():
    task = ModisTask("x", "P.061", ("L",), parts=5)

    tasks = build_area_tasks(task, start=date(2001, 3, 1), end=date(2002, 6, 1))

    assert [t["task_name"] for t in tasks] == [
        "trend-detective-x-20020601-p1of2",
        "trend-detective-x-20020601-p2of2",
    ]
    assert [t["params"]["dates"][0] for t in tasks] == [
        {"startDate": "03-01-2001", "endDate": "12-31-2001"},
        {"startDate": "01-01-2002", "endDate": "06-01-2002"},
    ]


def test_download_never_overwrites_the_local_submission_record(tmp_path: Path):
    (tmp_path / "submission.json").write_text("local record")
    files = [{"file_id": "9", "file_name": "submission.json", "file_size": 10}]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/bundle/abc-123":
            return httpx.Response(200, json={"files": files})
        return httpx.Response(200, content=b"from server")

    assert download_small_files(_client(handler), "abc-123", tmp_path) == []
    assert (tmp_path / "submission.json").read_text() == "local record"
