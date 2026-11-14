"""SQLite 匯出：一張統一表加各來源各一張表，內容與快照一致、可互相對回。"""

import json
import sqlite3
from datetime import date
from pathlib import Path

import httpx
import pytest

from trend_detective.giovanni import GiovanniClient
from trend_detective.harmony import HarmonyClient
from trend_detective.snapshot import build_snapshot
from trend_detective.sqlite_export import build_database, series_without_source_rows

FIXTURES = Path(__file__).parent / "fixtures"
SECRET = "secret-token-value"
RUN = {"today": date(2026, 11, 14), "now": "2026-11-14T08:00:00Z"}

VARIABLES = [
    {
        "id": "imerg_precip",
        "name_zh": "降水",
        "category": "水（液態）",
        "source": "giovanni",
        "source_variable_id": "GPM_3IMERGM_07_precipitation",
        "product_version": "07",
        "native_temporal_res": "month",
        "is_nasa": True,
        "harmony_collection": "C1-GES_DISC",
    },
    {
        "id": "power_t2m",
        "name_zh": "2 m 氣溫（NASA POWER）",
        "source": "nasa_power",
        "source_variable_id": "T2M",
        "product_version": "MERRA-2",
        "native_temporal_res": "month",
        "is_nasa": True,
    },
    {
        "id": "station_temp",
        "name_zh": "測站月均溫",
        "source": "noaa_ghcnh",
        "source_variable_id": "temperature",
        "product_version": "GHCNh",
        "native_temporal_res": "hour",
        "is_nasa": False,
    },
]
LOCATIONS = [
    {"id": "taichung", "kind": "point", "name_zh": "臺中", "lat": 24.15, "lon": 120.68},
    {
        "id": "taichung_station",
        "kind": "point",
        "name_zh": "臺中測站",
        "lat": 24.15,
        "lon": 120.68,
        "ghcnh_id": "CHM00059158",
    },
    {
        "id": "taiwan",
        "kind": "region",
        "name_zh": "臺灣",
        "bbox": [120.0, 21.8, 122.1, 25.4],
        "geojson": {"type": "Feature"},
    },
]


def _text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _client(handler, cls, base: str):
    http = httpx.Client(transport=httpx.MockTransport(handler), base_url=base)
    return cls(token=SECRET, http=http)


@pytest.fixture
def built(tmp_path: Path) -> tuple[Path, Path, Path]:
    """用錄下的回應跑一次四個來源的快照，回傳 (snapshot_dir, raw_dir, db_path)。"""

    def giovanni(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        return httpx.Response(200, text=_text("giovanni_imerg_taichung_2020.csv"))

    def harmony(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/quota":
            return httpx.Response(200, json={"quota": 0.0})
        if path.endswith("/rangeset"):
            return httpx.Response(200, json={"jobID": "job-1"})
        if path.startswith("/jobs/"):
            links = [{"rel": "data", "href": "https://harmony.test/results/out.csv"}]
            return httpx.Response(200, json={"status": "successful", "links": links})
        return httpx.Response(200, text=_text("harmony_gldas_tair_taiwan_sample.csv"))

    def station(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("_2025.psv"):
            return httpx.Response(200, text=_text("ghcnh_taichung_2025_sample.psv"))
        return httpx.Response(404)

    def power(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_text("power_t2m_taichung_2025_2026.json"))

    snapshot_dir, raw_dir = tmp_path / "snapshot", tmp_path / "raw"
    result = build_snapshot(
        _client(giovanni, GiovanniClient, "https://giovanni.test/"),
        snapshot_dir,
        VARIABLES,
        LOCATIONS,
        raw_dir=raw_dir,
        station_http=httpx.Client(transport=httpx.MockTransport(station)),
        power_http=httpx.Client(transport=httpx.MockTransport(power)),
        harmony_client=_client(harmony, HarmonyClient, "https://harmony.test/"),
        sleep=lambda seconds: None,
        **RUN,
    )
    assert result.failures == {}
    db_path = tmp_path / "db" / "trend.sqlite"
    build_database(snapshot_dir, raw_dir, db_path)
    return snapshot_dir, raw_dir, db_path


def _query(db_path: Path, sql: str, *params) -> list[tuple]:
    with sqlite3.connect(db_path) as db:
        return db.execute(sql, params).fetchall()


def test_unified_table_holds_exactly_the_points_of_every_series_file(built):
    snapshot_dir, _, db_path = built
    files = list((snapshot_dir / "series").glob("*.json"))
    expected = sum(len(json.loads(f.read_text())["points"]) for f in files)

    assert len(files) == 4
    assert _query(db_path, "SELECT COUNT(*) FROM observations") == [(expected,)]
    assert _query(
        db_path,
        "SELECT value, n_samples, coverage, unit, source_api FROM observations "
        "WHERE variable_id = 'imerg_precip' AND location_id = 'taichung' "
        "AND aggregation = 'point' AND month = '2020-05-01'",
    ) == [(0.495, 1, 1.0, "mm/hr", "giovanni")]
    # 測站 fixture 不到 20 天：月平均是缺值，但天數仍在
    assert _query(
        db_path,
        "SELECT value, n_samples FROM observations WHERE variable_id = 'station_temp'",
    ) == [(None, 4)]


def test_each_source_has_its_own_table_at_native_resolution(built):
    _, _, db_path = built

    counts = {
        table: _query(db_path, f"SELECT COUNT(*) FROM {table}")[0][0]
        for table in ("src_giovanni", "src_harmony", "src_nasa_power", "src_noaa_ghcnh")
    }
    assert counts == {
        "src_giovanni": 12,  # 2020 年 12 個月
        "src_harmony": 27,
        "src_nasa_power": 24,  # 含 2025 年平均鍵與 2 個未發布的月份
        "src_noaa_ghcnh": 4,  # 4 個當地日的日平均，不含逐時原始值
    }
    assert _query(
        db_path,
        "SELECT period, is_annual_mean, value FROM src_nasa_power "
        "WHERE period IN ('202513', '202610') ORDER BY period",
    ) == [("202513", 1, 23.23), ("202610", 0, None)]
    assert _query(
        db_path,
        "SELECT station_id, local_date, n_obs FROM src_noaa_ghcnh ORDER BY local_date LIMIT 1",
    ) == [("CHM00059158", "2025-01-01", 5)]


def test_every_series_names_its_source_table_and_joins_back_to_it(built):
    _, _, db_path = built

    assert _query(
        db_path,
        "SELECT variable_id, location_id, aggregation, source_table FROM series ORDER BY 1, 2, 3",
    ) == [
        ("imerg_precip", "taichung", "point", "src_giovanni"),
        ("imerg_precip", "taiwan", "area_mean", "src_harmony"),
        ("power_t2m", "taichung", "point", "src_nasa_power"),
        ("station_temp", "taichung_station", "station", "src_noaa_ghcnh"),
    ]
    # 統一表的月值可以從來源表重算：月資料直接相等
    assert _query(
        db_path,
        "SELECT COUNT(*) FROM observations o JOIN src_giovanni g "
        "ON g.variable_id = o.variable_id AND g.location_id = o.location_id "
        "AND substr(g.timestamp, 1, 7) = substr(o.month, 1, 7) "
        "WHERE o.aggregation = 'point' AND g.value = o.value",
    ) == [(12,)]


def test_lookup_tables_come_from_the_catalog_and_nothing_holds_a_credential(built):
    _, _, db_path = built

    assert _query(db_path, "SELECT id, is_nasa FROM variables ORDER BY id") == [
        ("imerg_precip", 1),
        ("power_t2m", 1),
        ("station_temp", 0),
    ]
    assert _query(
        db_path, "SELECT kind, bbox_w, bbox_n FROM locations WHERE id = 'taiwan'"
    ) == [("region", 120.0, 25.4)]
    assert SECRET.encode() not in db_path.read_bytes()


def test_rebuilding_replaces_the_database_with_the_same_content(built):
    snapshot_dir, raw_dir, db_path = built
    before = _query(db_path, "SELECT COUNT(*) FROM observations")

    counts = build_database(snapshot_dir, raw_dir, db_path)

    assert _query(db_path, "SELECT COUNT(*) FROM observations") == before
    assert counts["observations"] == before[0][0]


def test_harmony_source_rows_keep_the_original_column_name_and_bbox(built):
    _, _, db_path = built

    assert _query(
        db_path, "SELECT DISTINCT source_column, bbox_w, bbox_n FROM src_harmony"
    ) == [("mean_GLDAS_NOAH025_M_2_1_Tair_f_inst", 120.0, 25.4)]


def test_without_raw_files_the_unified_table_is_complete_and_the_gap_is_reported(
    built, tmp_path: Path
):
    snapshot_dir, raw_dir, _ = built
    (raw_dir / "giovanni" / "imerg_precip__taichung.csv").unlink()
    db_path = tmp_path / "partial.sqlite"

    counts = build_database(snapshot_dir, raw_dir, db_path)

    assert counts["src_giovanni"] == 0
    assert counts["observations"] > 0
    assert series_without_source_rows(db_path) == [
        ("imerg_precip", "taichung", "point")
    ]


def test_appeears_series_trace_back_to_per_composite_statistics(tmp_path: Path):
    fixture = FIXTURES / "appeears_ndvi"
    raw = tmp_path / "raw"
    task_dir = raw / "appeears" / "modis_ndvi" / "task-1"
    task_dir.mkdir(parents=True)
    (task_dir / "submission.json").write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "request": {"task_name": "trend-detective-modis_ndvi-20261114"},
            }
        )
    )
    for path in fixture.iterdir():
        (task_dir / path.name).write_text(path.read_text(encoding="utf-8"))
    ndvi = {
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
    snapshot_dir = tmp_path / "snapshot"
    build_snapshot(
        None, snapshot_dir, [ndvi], [LOCATIONS[2]], appeears_dir=raw / "appeears", **RUN
    )
    db_path = tmp_path / "trend.sqlite"

    build_database(snapshot_dir, raw, db_path)

    assert _query(db_path, "SELECT source_table FROM series") == [("src_appeears",)]
    assert _query(
        db_path,
        "SELECT date, pixel_count, mean FROM src_appeears WHERE location_id = 'taiwan' ORDER BY date LIMIT 1",
    ) == [("2001-01-01", 46822, 0.6766119)]
    assert series_without_source_rows(db_path) == []


def test_planetary_computer_series_trace_back_to_per_composite_statistics(
    tmp_path: Path,
):
    raw = tmp_path / "raw"
    stats = raw / "planetary_computer" / "modis_lst_pc" / "stats.csv"
    stats.parent.mkdir(parents=True)
    stats.write_text(
        "date,location_id,asset,count,mean,standard_deviation,minimum,maximum,"
        "pixels_in_bbox,tiles,item_ids\n"
        "2020-01-01,taiwan,LST_Day_1km,100,290.0,1.5,280.0,300.0,400,h28v06;h29v06,A.h28;A.h29\n"
        "2020-01-09,taiwan,LST_Day_1km,0,,,,,400,h29v06,B.h29\n",
        encoding="utf-8",
    )
    lst = {
        "id": "modis_lst_pc",
        "source": "planetary_computer",
        "source_variable_id": "LST_Day_1km",
        "pc_collection": "modis-11A2-061",
        "product": "MOD11A2.061",
        "product_version": "061",
        "native_temporal_res": "8day",
        "is_nasa": True,
        "unit": "K",
        "valid_range": [270, 330],
    }
    snapshot_dir = tmp_path / "snapshot"
    build_snapshot(
        None,
        snapshot_dir,
        [lst],
        [LOCATIONS[2]],
        planetary_computer_dir=raw / "planetary_computer",
        **RUN,
    )
    db_path = tmp_path / "trend.sqlite"

    build_database(snapshot_dir, raw, db_path)

    assert _query(db_path, "SELECT source_table FROM series") == [
        ("src_planetary_computer",)
    ]
    assert _query(
        db_path,
        "SELECT date, pixel_count, mean, pixels_in_bbox, tiles, item_ids "
        "FROM src_planetary_computer WHERE location_id = 'taiwan' ORDER BY date",
    ) == [
        ("2020-01-01", 100, 290.0, 400, "h28v06;h29v06", "A.h28;A.h29"),
        ("2020-01-09", 0, None, 400, "h29v06", "B.h29"),
    ]
    assert series_without_source_rows(db_path) == []
