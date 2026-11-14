"""擴充抓取（#46）：世界地點、平行抓單點、區域平均的佇列、續跑與失敗統計。不連網。"""

import json
import threading
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest

from trend_detective.extended import (
    RunResult,
    fetch_areas,
    fetch_points,
    load_inputs,
    stage_tasks,
    status,
    write_extended_catalog,
)
from trend_detective.giovanni import GiovanniClient
from trend_detective.harmony import HarmonyClient

REPO = Path(__file__).parents[1]
AREA_FIXTURE = REPO / "tests" / "fixtures" / "harmony_gldas_tair_taiwan_sample.csv"
SECRET = "secret-token-value"
RUN: dict[str, Any] = {"today": date(2026, 11, 14), "now": "2026-11-14T08:00:00Z"}

RUNOFF = {
    "id": "runoff",
    "tier": "extended",
    "source": "giovanni",
    "source_variable_id": "GLDAS_NOAH025_M_2_1_Qs_acc",
    "product_version": "2.1",
    "native_temporal_res": "month",
    "harmony_collection": "C42-GES_DISC",
    "unit": "kg m-2",
    "data_start": "2000-01-01",
}
CITIES = [
    {"id": name, "kind": "point", "group": "world_city", "lat": lat, "lon": lon}
    for name, lat, lon in [("delhi", 28.61, 77.21), ("cairo", 30.04, 31.24)]
]
OCEAN = {
    "id": "ocean",
    "kind": "point",
    "group": "world_city",
    "lat": 0.0,
    "lon": -30.0,
}
GLOBE = {
    "id": "global",
    "kind": "region",
    "group": "global",
    "bbox": [-180, -90, 180, 90],
}
AFRICA = {
    "id": "africa",
    "kind": "region",
    "group": "world_region",
    "bbox": [-18, -35, 52, 38],
}


def _point_csv(value: str) -> str:
    return (
        "unit,kg m-2\nundef,-9999\nlat,28.625\nlon,77.125\n"
        "lat_resolution,0.25\nlon_resolution,0.25\n\nTimestamp (UTC),Data\n"
        f"2020-01-01 00:00,{value}\n2020-02-01 00:00,{value}\n"
    )


def _giovanni(requests: list[str], **options: Any) -> GiovanniClient:
    """海上的點（lon -30）整條缺值；其餘回兩個月的值。`requests` 記下每次請求的路徑。"""
    lock = threading.Lock()

    def handler(request: httpx.Request) -> httpx.Response:
        with lock:
            requests.append(request.url.path)
        if request.url.path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        masked = "-30.0" in request.url.params["location"]
        return httpx.Response(200, text=_point_csv("-9999" if masked else "3.5"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://giovanni.test/"
    )
    return GiovanniClient(token=SECRET, http=http, **options)


def _harmony(requests: list[str], statuses: dict[str, list[str]] | None = None):
    """每個 job 依 `statuses[區域的 bbox 西界]` 的順序回報狀態，預設一次就成功。"""
    scripted = statuses or {}
    jobs: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        requests.append(path)
        if path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        if path.endswith("/rangeset"):
            lon = next(v for v in request.url.params.get_list("subset") if "lon(" in v)
            job_id = f"job-{len(jobs) + 1}"
            jobs[job_id] = lon
            return httpx.Response(200, json={"jobID": job_id})
        if path.startswith("/jobs/"):
            job_id = path.rsplit("/", 1)[1]
            queue = scripted.get(jobs.get(job_id, ""), [])
            state = queue.pop(0) if queue else "successful"
            links = [{"rel": "data", "href": "https://harmony.test/results/out.csv"}]
            return httpx.Response(
                200,
                json={
                    "status": state,
                    "links": links if state == "successful" else [],
                    "message": "",
                },
            )
        return httpx.Response(200, text=AREA_FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://harmony.test/"
    )
    return HarmonyClient(token=SECRET, http=http)


def _areas(tmp_path: Path, client: HarmonyClient, tasks, **extra: Any) -> RunResult:
    return fetch_areas(
        client,
        tasks,
        tmp_path / "extended",
        raw_dir=tmp_path / "raw",
        sleep=lambda seconds: None,
        **extra,
        **RUN,
    )


# 世界地點：期望的座標是各城市公認的市中心位置（度），與 seed 分開寫
KNOWN_CITIES = {
    "tokyo": (35.7, 139.7),
    "delhi": (28.6, 77.2),
    "beijing": (39.9, 116.4),
    "jakarta": (-6.2, 106.8),
    "cairo": (30.0, 31.2),
    "lagos": (6.5, 3.4),
    "london": (51.5, -0.1),
    "moscow": (55.8, 37.6),
    "new_york": (40.7, -74.0),
    "los_angeles": (34.1, -118.2),
    "sao_paulo": (-23.6, -46.6),
    "sydney": (-33.9, 151.2),
}
# 每個區域裡一定要包含的一個地方（lat, lon），以及一定不能包含的一個地方
REGION_CHECKS = {
    "north_america": ((39.0, -98.0), (-15.0, -55.0)),
    "south_america": ((-15.0, -55.0), (39.0, -98.0)),
    "europe": ((48.9, 2.4), (-1.3, 36.8)),
    "africa": ((-1.3, 36.8), (48.9, 2.4)),
    "asia": ((30.0, 105.0), (48.9, 2.4)),
    "oceania": ((-25.0, 135.0), (30.0, 105.0)),
    "arctic": ((80.0, 0.0), (60.0, 0.0)),
    "tropics": ((0.0, 100.0), (30.0, 100.0)),
}


def test_world_seed_holds_the_global_mean_the_world_regions_and_the_twelve_cities():
    _, locations = load_inputs(REPO / "data" / "seed", REPO / "data" / "snapshot")
    world = {loc["id"]: loc for loc in locations if loc["tier"] == "extended"}

    assert world["global"]["bbox"] == [-180, -90, 180, 90]
    for region_id, (inside, outside) in REGION_CHECKS.items():
        west, south, east, north = world[region_id]["bbox"]
        assert south <= inside[0] <= north and west <= inside[1] <= east, region_id
        assert not (south <= outside[0] <= north and west <= outside[1] <= east)
    for city_id, (lat, lon) in KNOWN_CITIES.items():
        assert world[city_id]["kind"] == "point"
        assert world[city_id]["lat"] == pytest.approx(lat, abs=0.15), city_id
        assert world[city_id]["lon"] == pytest.approx(lon, abs=0.15), city_id
    assert all(loc["name_zh"] and loc["name_en"] for loc in world.values())
    assert world["arctic"]["bbox"][1] == pytest.approx(66.5, abs=0.1)
    assert world["tropics"]["bbox"][1::2] == pytest.approx([-23.5, 23.5], abs=0.1)


def test_core_taiwan_locations_stay_and_stations_are_left_out_of_the_extended_run():
    variables, locations = load_inputs(
        REPO / "data" / "seed", REPO / "data" / "snapshot"
    )
    taiwan = [loc["id"] for loc in locations if loc["group"] == "taiwan"]

    assert sorted(taiwan) == sorted(
        ["taichung", "taipei", "kaohsiung", "hualien", "yushan"]
        + ["taiwan", "north", "central", "south", "east"]
    )
    core = [v for v in variables if v["tier"] == "core"]
    assert len(core) == 10
    assert all(v["source"] == "giovanni" and v["unit"] is not None for v in core)


def test_stages_run_core_variables_before_extended_and_global_before_cities():
    core = {**RUNOFF, "id": "core_var", "tier": "core"}
    locations = [GLOBE, AFRICA, *CITIES]

    def ids(stage: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
        points, areas = stage_tasks(stage, [core, RUNOFF], locations)
        return (
            [(v["id"], loc["id"]) for v, loc in points],
            [(v["id"], loc["id"]) for v, loc in areas],
        )

    assert ids("a") == ([], [("core_var", "global")])
    assert ids("b") == (
        [("core_var", "delhi"), ("core_var", "cairo")],
        [("core_var", "africa")],
    )
    assert ids("c") == ([], [("runoff", "global")])
    assert ids("d") == ([], [("runoff", "africa")])
    assert ids("e") == ([("runoff", "delhi"), ("runoff", "cairo")], [])


def test_points_are_fetched_in_parallel_and_written_in_the_unified_format(
    tmp_path: Path,
):
    result = fetch_points(
        _giovanni([]),
        [(RUNOFF, city) for city in CITIES],
        tmp_path / "extended",
        raw_dir=tmp_path / "raw",
        workers=4,
        **RUN,
    )

    assert sorted(result.succeeded) == [
        ("runoff", "cairo", "point"),
        ("runoff", "delhi", "point"),
    ]
    series = json.loads(
        (tmp_path / "extended/series/runoff__delhi__point.json").read_text()
    )
    assert series["unit"] == "kg m-2"
    assert series["source_api"] == "giovanni"
    assert [(p["month"], p["value"]) for p in series["points"]] == [
        ("2020-01-01", 3.5),
        ("2020-02-01", 3.5),
    ]
    assert (tmp_path / "raw/giovanni/runoff__delhi.csv").exists()


def test_a_same_day_rerun_fetches_nothing_that_already_succeeded(tmp_path: Path):
    tasks = [(RUNOFF, city) for city in CITIES]
    fetch_points(
        _giovanni([]), tasks, tmp_path / "extended", raw_dir=None, workers=2, **RUN
    )
    requests: list[str] = []

    again = fetch_points(
        _giovanni(requests), tasks, tmp_path / "extended", raw_dir=None, **RUN
    )

    assert "/timeseries" not in requests
    assert len(again.reused) == 2
    assert again.succeeded == [] and again.failures == {}


def test_a_rerun_on_a_later_day_fetches_the_series_again(tmp_path: Path):
    tasks = [(RUNOFF, CITIES[0])]
    fetch_points(_giovanni([]), tasks, tmp_path / "extended", raw_dir=None, **RUN)
    requests: list[str] = []

    later = fetch_points(
        _giovanni(requests),
        tasks,
        tmp_path / "extended",
        raw_dir=None,
        today=date(2026, 11, 15),
        now="2026-11-15T08:00:00Z",
    )

    assert requests.count("/timeseries") == 1
    assert later.succeeded == [("runoff", "delhi", "point")]


def test_a_masked_point_fails_alone_and_failures_are_counted_by_reason(tmp_path: Path):
    result = fetch_points(
        _giovanni([]),
        [(RUNOFF, OCEAN), *((RUNOFF, city) for city in CITIES)],
        tmp_path / "extended",
        raw_dir=None,
        workers=3,
        **RUN,
    )

    assert len(result.succeeded) == 2
    assert list(result.failures) == [("runoff", "ocean", "point")]
    assert result.failures_by_reason() == {
        "整條都是缺值（海面或該產品在此沒有資料）": 1
    }
    assert not (tmp_path / "extended/series/runoff__ocean__point.json").exists()


def test_a_failed_point_is_tried_again_on_the_next_run_the_same_day(tmp_path: Path):
    fetch_points(
        _giovanni([]), [(RUNOFF, OCEAN)], tmp_path / "extended", raw_dir=None, **RUN
    )
    requests: list[str] = []

    fetch_points(
        _giovanni(requests),
        [(RUNOFF, OCEAN)],
        tmp_path / "extended",
        raw_dir=None,
        **RUN,
    )

    assert requests.count("/timeseries") == 1


def test_quota_is_checked_once_for_many_points_when_the_client_caches_it(
    tmp_path: Path,
):
    requests: list[str] = []
    cities = [{**CITIES[0], "id": f"city{i}"} for i in range(12)]

    fetch_points(
        _giovanni(requests, quota_ttl=60, clock=lambda: 0.0),
        [(RUNOFF, city) for city in cities],
        tmp_path / "extended",
        raw_dir=None,
        workers=4,
        **RUN,
    )

    assert requests.count("/timeseries") == 12
    assert requests.count("/quota") == 1


def test_nothing_more_is_fetched_once_quota_is_nearly_used_up(tmp_path: Path):
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        return httpx.Response(200, json={"quota": 0.96})

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://giovanni.test/"
    )

    result = fetch_points(
        GiovanniClient(token=SECRET, http=http),
        [(RUNOFF, city) for city in CITIES],
        tmp_path / "extended",
        raw_dir=None,
        workers=1,
        **RUN,
    )

    assert "/timeseries" not in requests
    assert result.failures_by_reason() == {"quota 達上限，未送出": 2}


def test_area_means_are_written_for_every_region_with_more_tasks_than_job_slots(
    tmp_path: Path,
):
    regions = [{**AFRICA, "id": f"r{i}", "bbox": [i, -35, 52, 38]} for i in range(5)]
    requests: list[str] = []

    result = _areas(
        tmp_path, _harmony(requests), [(RUNOFF, r) for r in regions], max_jobs=2
    )

    assert len(result.succeeded) == 5 and result.failures == {}
    assert sum(path.endswith("/rangeset") for path in requests) == 5
    series = json.loads(
        (tmp_path / "extended/series/runoff__r0__area_mean.json").read_text()
    )
    assert series["aggregation"] == "area_mean"
    assert series["unit"] == "kg m-2"
    assert series["request"]["bbox"] == [0, -35, 52, 38]
    assert series["request"]["start"] == "2001-01-01"
    assert series["points"][0] == {
        "month": "2001-01-01",
        "value": 288.3125,
        "n_samples": 1,
        "coverage": 1,
    }


def test_a_slow_job_does_not_hold_back_the_tasks_queued_behind_it(tmp_path: Path):
    requests: list[str] = []
    slow = {"lon(-180:180)": ["running"] * 6}
    client = _harmony(requests, slow)

    result = _areas(tmp_path, client, [(RUNOFF, GLOBE), (RUNOFF, AFRICA)], max_jobs=1)
    # max_jobs = 1 時後面的要等；放寬到 2 就不必等
    requests.clear()
    other = tmp_path / "second"
    wide = _areas(
        other,
        _harmony(requests, {"lon(-180:180)": ["running"] * 6}),
        [(RUNOFF, GLOBE), (RUNOFF, AFRICA)],
        max_jobs=2,
    )

    assert len(result.succeeded) == 2 and len(wide.succeeded) == 2
    submitted = [i for i, path in enumerate(requests) if path.endswith("/rangeset")]
    first_poll = next(i for i, path in enumerate(requests) if "/jobs/" in path)
    assert all(i < first_poll for i in submitted)


def test_a_failed_job_is_reported_by_reason_and_the_others_still_finish(
    tmp_path: Path,
):
    client = _harmony([], {"lon(-18:52)": ["failed"]})

    result = _areas(tmp_path, client, [(RUNOFF, AFRICA), (RUNOFF, GLOBE)])

    assert result.succeeded == [("runoff", "global", "area_mean")]
    assert result.failures_by_reason() == {"Harmony job 失敗": 1}


def test_same_day_rerun_submits_no_job_for_regions_that_already_succeeded(
    tmp_path: Path,
):
    tasks = [(RUNOFF, GLOBE), (RUNOFF, AFRICA)]
    _areas(tmp_path, _harmony([]), tasks)
    requests: list[str] = []

    again = _areas(tmp_path, _harmony(requests), tasks)

    assert not any(path.endswith("/rangeset") for path in requests)
    assert len(again.reused) == 2


def test_an_interrupted_run_keeps_waiting_for_the_job_it_already_submitted(
    tmp_path: Path,
):
    harmony_dir = tmp_path / "raw" / "harmony"
    harmony_dir.mkdir(parents=True)
    (harmony_dir / "jobs.extended.json").write_text(
        json.dumps(
            {
                "runoff__global": {
                    "job_id": "job-from-before",
                    "end": "2026-11-14",
                    "status": "running",
                }
            }
        )
    )
    requests: list[str] = []

    result = _areas(tmp_path, _harmony(requests), [(RUNOFF, GLOBE)])

    assert not any(path.endswith("/rangeset") for path in requests)
    assert "/jobs/job-from-before" in requests
    assert result.succeeded == [("runoff", "global", "area_mean")]


def test_collect_only_finishes_submitted_jobs_and_submits_nothing_new(tmp_path: Path):
    harmony_dir = tmp_path / "raw" / "harmony"
    harmony_dir.mkdir(parents=True)
    (harmony_dir / "jobs.extended.json").write_text(
        json.dumps(
            {
                "runoff__global": {
                    "job_id": "job-from-before",
                    "end": "2026-11-14",
                    "status": "running",
                }
            }
        )
    )
    requests: list[str] = []

    result = _areas(
        tmp_path, _harmony(requests), [(RUNOFF, GLOBE), (RUNOFF, AFRICA)], submit=False
    )

    assert not any(path.endswith("/rangeset") for path in requests)
    assert result.succeeded == [("runoff", "global", "area_mean")]
    assert result.failures == {}
    assert not (tmp_path / "extended/series/runoff__africa__area_mean.json").exists()


def test_a_region_known_to_hold_no_grid_cell_is_not_submitted_and_not_a_failure(
    tmp_path: Path,
):
    coarse = {**RUNOFF, "harmony_skip_regions": ["africa"]}
    requests: list[str] = []

    result = _areas(tmp_path, _harmony(requests), [(coarse, AFRICA)])

    assert requests == []
    assert result.skipped == [("runoff", "africa", "area_mean")]
    assert result.failures == {}


def test_a_throttled_submission_is_sent_again_instead_of_failing(tmp_path: Path):
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        if path.endswith("/rangeset"):
            attempts["n"] += 1
            if attempts["n"] == 1:
                return httpx.Response(429, text="Too Many Requests")
            return httpx.Response(200, json={"jobID": "job-1"})
        if path.startswith("/jobs/"):
            links = [{"rel": "data", "href": "https://harmony.test/results/out.csv"}]
            return httpx.Response(200, json={"status": "successful", "links": links})
        return httpx.Response(200, text=AREA_FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://harmony.test/"
    )

    result = _areas(tmp_path, HarmonyClient(token=SECRET, http=http), [(RUNOFF, GLOBE)])

    assert attempts["n"] == 2
    assert result.succeeded == [("runoff", "global", "area_mean")]


def test_catalog_has_the_same_shape_as_the_core_snapshot_catalog(tmp_path: Path):
    out = tmp_path / "extended"
    fetch_points(_giovanni([]), [(RUNOFF, CITIES[0])], out, raw_dir=None, **RUN)
    _areas(tmp_path, _harmony([]), [(RUNOFF, GLOBE)])

    path = write_extended_catalog(
        out, [RUNOFF], [GLOBE, AFRICA, *CITIES], now=RUN["now"]
    )

    catalog = json.loads(path.read_text(encoding="utf-8"))
    core = json.loads((REPO / "data/snapshot/catalog.json").read_text(encoding="utf-8"))
    assert path == out / "catalog.json"
    assert set(catalog) == set(core)
    assert set(catalog["series"][0]) == set(core["series"][0])
    assert set(catalog["snapshot"]) == set(core["snapshot"])
    assert [(s["variable_id"], s["location_id"]) for s in catalog["series"]] == [
        ("runoff", "delhi"),
        ("runoff", "global"),
    ]
    # 只列出有序列的地點
    assert [loc["id"] for loc in catalog["locations"]] == ["global", "delhi"]
    assert catalog["variables"][0]["valid_from"] == "2001-01-01"
    assert all((out / s["file"]).exists() for s in catalog["series"])


def test_status_counts_what_each_stage_has_and_what_is_still_missing(tmp_path: Path):
    out = tmp_path / "extended"
    locations = [GLOBE, *CITIES, OCEAN]
    fetch_points(
        _giovanni([]),
        [(RUNOFF, CITIES[0]), (RUNOFF, OCEAN)],
        out,
        raw_dir=None,
        **RUN,
    )

    lines = status(out, [RUNOFF], locations).splitlines()

    assert "階段 c：已有 0，失敗 0，已知無資料不送 0，尚未抓 1" in lines
    assert "階段 e：已有 1，失敗 1，已知無資料不送 0，尚未抓 1" in lines


def test_no_written_file_holds_the_token(tmp_path: Path):
    fetch_points(
        _giovanni([]),
        [(RUNOFF, CITIES[0])],
        tmp_path / "extended",
        raw_dir=tmp_path / "raw",
        **RUN,
    )
    _areas(tmp_path, _harmony([]), [(RUNOFF, GLOBE)])

    files = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert len(files) >= 6
    assert not any(SECRET in p.read_text(encoding="utf-8") for p in files)
