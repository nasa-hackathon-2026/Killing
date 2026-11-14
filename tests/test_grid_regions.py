"""格點區域平均（#64）：面積加權、bbox 邊界、缺值與 coverage、盤點、不覆蓋、SQLite 匯入。不連網。"""

import json
import math
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from trend_detective.grid import Cube, write_cube
from trend_detective.grid_regions import (
    AGGREGATION,
    GridRegionError,
    area_mean,
    check_cubes,
    cleanup_plan,
    cube_path,
    region_cells,
    resolve_targets,
    run,
    scan_all_nan_months,
)
from trend_detective.series import write_catalog
from trend_detective.sqlite_export import build_database, series_without_source_rows

NOW = "2026-11-14T08:00:00Z"
NAN = float("nan")


def months_from(year: int, month: int, count: int) -> list[date]:
    start = year * 12 + month - 1
    return [date((start + i) // 12, (start + i) % 12 + 1, 1) for i in range(count)]


def make_cube(
    raw_dir: Path,
    grid_id: str,
    months: list[date],
    lat: list[float],
    lon: list[float],
    values: Any,
    *,
    unit: str = "K",
) -> Path:
    path = cube_path(raw_dir, grid_id)
    cube = Cube(
        months=months,
        lat=np.array(lat, dtype=np.float64),
        lon=np.array(lon, dtype=np.float64),
        values=np.array(values, dtype=np.float32),
        unit=unit,
        attrs={
            "first_month": f"{months[0]:%Y-%m}",
            "last_month": f"{months[-1]:%Y-%m}",
        },
    )
    write_cube(path, cube, "T")
    return path


def seed_entry(grid_id: str, start: str = "2020-01", **extra: Any) -> dict[str, Any]:
    return {
        "id": grid_id,
        "name_zh": grid_id,
        "name_en": grid_id,
        "product": "PROD.1",
        "product_version": "1",
        "collection": "C1-TEST",
        "variable": "/Grid/T",
        "doi": "10.0/test",
        "citation": "test",
        "start": start,
        **extra,
    }


def region(location_id: str, bbox: list[float], group: str = "taiwan") -> dict:
    return {
        "id": location_id,
        "kind": "region",
        "group": group,
        "name_zh": location_id,
        "bbox": bbox,
    }


# ---------- 面積加權 ----------


def test_rows_are_weighted_by_the_cosine_of_latitude():
    lat = np.array([0.0, 60.0])
    lon = np.array([0.0, 1.0])
    layer = np.array([[10.0, 10.0], [40.0, 40.0]], dtype=np.float32)

    value, coverage = area_mean(layer, lat, lon, (-1.0, -1.0, 2.0, 61.0))

    # 權重 cos(0) = 1、cos(60°) = 0.5：(10 × 1 + 40 × 0.5) ÷ 1.5 = 20
    assert value == pytest.approx(20.0)
    assert coverage == pytest.approx(1.0)


def test_only_cells_whose_centre_is_inside_the_bbox_count_and_edges_are_inclusive():
    lat = np.array([0.5, 1.5, 2.5])
    lon = np.array([10.5, 11.5, 12.5])
    layer = np.arange(9, dtype=np.float32).reshape(3, 3)

    # 中心 (1.5, 11.5) 剛好在邊界上：算在內；(2.5, …) 與 (…, 12.5) 在外
    value, _ = area_mean(layer, lat, lon, (10.5, 0.5, 11.5, 1.5))
    weights = [math.cos(math.radians(0.5)), math.cos(math.radians(1.5))]
    expected = (weights[0] * (0 + 1) + weights[1] * (3 + 4)) / (2 * sum(weights))

    assert value == pytest.approx(expected)
    assert region_cells("r", (10.5, 0.5, 11.5, 1.5), lat, lon).n_cells == 4  # type: ignore[union-attr]


def test_a_bbox_with_west_greater_than_east_wraps_across_the_antimeridian():
    lat = np.array([0.0])
    lon = np.array([-170.0, -90.0, 90.0, 170.0])
    layer = np.array([[1.0, 100.0, 200.0, 3.0]], dtype=np.float32)

    value, coverage = area_mean(layer, lat, lon, (160.0, -10.0, -160.0, 10.0))

    assert value == pytest.approx(2.0)
    assert coverage == pytest.approx(1.0)


def test_missing_cells_are_left_out_and_coverage_is_the_valid_area_fraction():
    lat = np.array([0.0, 60.0])
    lon = np.array([0.0, 1.0])
    layer = np.array([[10.0, NAN], [40.0, 40.0]], dtype=np.float32)

    value, coverage = area_mean(layer, lat, lon, (-1.0, -1.0, 2.0, 61.0))

    # 有值的權重 1 + 0.5 + 0.5 = 2，全部 3：(10 + 20 + 20) ÷ 2 = 25，coverage = 2/3
    assert value == pytest.approx(25.0)
    assert coverage == pytest.approx(2.0 / 3.0)


def test_a_region_with_only_missing_cells_has_no_value_and_zero_coverage():
    lat = np.array([0.0, 1.0])
    lon = np.array([0.0, 1.0])
    layer = np.full((2, 2), NAN, dtype=np.float32)

    assert area_mean(layer, lat, lon, (-1.0, -1.0, 2.0, 2.0)) == (None, 0.0)


def test_a_bbox_without_any_cell_centre_is_reported_not_averaged():
    lat = np.array([24.5, 25.5])
    lon = np.array([120.5, 121.5, 122.5])

    assert region_cells("north", (121.6, 24.6, 122.1, 25.4), lat, lon) is None
    with pytest.raises(GridRegionError):
        area_mean(np.zeros((2, 3), np.float32), lat, lon, (121.6, 24.6, 122.1, 25.4))


# ---------- 變數 id 的對應 ----------


def test_grid_ids_map_to_known_variables_by_id_or_by_product_and_source_name():
    known = [
        {"id": "core_t", "unit": "K", "source_variable_id": "X", "product": "P.9"},
        {
            "id": "prod_1_cloudfrc",
            "unit": "1",
            "product": "PROD.1",
            "source_variable_id": "PROD_1_CloudFrc",
        },
    ]
    seed = [
        seed_entry("core_t"),
        seed_entry("grid_cloud", variable="/a/Data_Fields/CloudFrc"),
        seed_entry("grid_only", variable="/a/Other", needs_translation=True),
    ]

    targets = resolve_targets(seed, known)

    assert (targets["core_t"].variable_id, targets["core_t"].unit) == ("core_t", "K")
    assert targets["grid_cloud"].variable_id == "prod_1_cloudfrc"
    assert targets["grid_cloud"].unit == "1"
    assert targets["grid_only"].variable_id == "grid_only"
    assert targets["grid_only"].matched is False
    described = targets["grid_only"].describe
    assert described is not None
    assert described["source"] == "grid"
    assert described["product"] == "PROD.1"
    assert described["needs_translation"] is True


# ---------- 盤點 ----------


def test_check_flags_gaps_late_starts_short_cubes_and_months_left_out(tmp_path: Path):
    raw = tmp_path / "raw"
    flat = np.ones((1, 2, 2))
    grid: dict[str, Any] = {"lat": [0.0, 1.0], "lon": [0.0, 1.0]}
    make_cube(raw, "ok", months_from(2020, 1, 4), values=np.repeat(flat, 4, 0), **grid)
    gapped = [*months_from(2020, 1, 2), *months_from(2020, 4, 1)]
    make_cube(raw, "gap", gapped, values=np.repeat(flat, 3, 0), **grid)
    make_cube(
        raw, "late", months_from(2020, 3, 2), values=np.repeat(flat, 2, 0), **grid
    )
    make_cube(
        raw, "short", months_from(2020, 1, 3), values=np.repeat(flat, 3, 0), **grid
    )
    make_cube(
        raw, "left", months_from(2020, 1, 4), values=np.repeat(flat, 4, 0), **grid
    )
    months_dir = raw / "grid" / "left" / "months"
    months_dir.mkdir()
    for stem in ("202001", "202002", "202003", "202004", "202005"):
        (months_dir / f"{stem}.nc4").write_bytes(b"")
    seed = [seed_entry(name) for name in ("ok", "gap", "late", "short", "left", "none")]

    checks = {check.id: check for check in check_cubes(seed, raw)}

    assert checks["ok"].complete
    assert (checks["ok"].first_month, checks["ok"].last_month) == ("2020-01", "2020-04")
    assert any("不連續" in reason for reason in checks["gap"].reasons)
    assert any("晚於 seed" in reason for reason in checks["late"].reasons)
    assert any("早於同產品" in reason for reason in checks["short"].reasons)
    assert any("沒進立方體" in reason for reason in checks["left"].reasons)
    assert checks["none"].reasons == ["沒有立方體檔"]


def test_scan_lists_months_without_any_valid_cell(tmp_path: Path):
    values = np.ones((3, 2, 2))
    values[1] = NAN
    values[2, 0, 0] = NAN
    path = make_cube(
        tmp_path, "t", months_from(2020, 1, 3), [0.0, 1.0], [0.0, 1.0], values
    )

    assert scan_all_nan_months(path) == ["2020-02"]


def test_cleanup_only_lists_monthly_files_of_complete_cubes(tmp_path: Path):
    raw = tmp_path / "raw"
    flat = np.ones((2, 2, 2))
    grid: dict[str, Any] = {"lat": [0.0, 1.0], "lon": [0.0, 1.0]}
    for name in ("done", "daily", "batched"):
        make_cube(raw, name, months_from(2020, 1, 2), values=flat, **grid)
    make_cube(raw, "late", months_from(2020, 2, 1), values=flat[:1], **grid)
    for name in ("done", "daily", "late"):
        (raw / "grid" / name / "months").mkdir()
    batch = raw / "grid" / "_batch" / "PROD.1" / "abc"
    batch.mkdir(parents=True)
    (batch / "variables.json").write_text(json.dumps({"batched": "/T"}))
    mixed = raw / "grid" / "_batch" / "PROD.1" / "def"
    mixed.mkdir()
    (mixed / "variables.json").write_text(json.dumps({"done": "/T", "late": "/T"}))
    seed = [
        seed_entry("done"),
        seed_entry("daily", temporal="day"),
        seed_entry("batched"),
        seed_entry("late"),
    ]

    removable, kept = cleanup_plan(seed, check_cubes(seed, raw), raw)

    assert removable == [raw / "grid" / "done" / "months", batch]
    assert len(kept) == 3
    assert all(path.suffix != ".nc" for path in removable)


# ---------- 整批計算、不覆蓋、SQLite ----------


@pytest.fixture
def computed(tmp_path: Path) -> tuple[Path, Path, dict[str, Any]]:
    """兩個合成立方體 × 三個區域跑一次，回傳 (raw_dir, out_dir, 報告)。"""
    raw, out = tmp_path / "raw", tmp_path / "extended"
    lat, lon = [0.0, 60.0], [0.0, 1.0, 2.0]
    values = np.array(
        [
            [[10.0, 10.0, NAN], [40.0, 40.0, NAN]],
            [[NAN, NAN, NAN], [NAN, NAN, NAN]],
            [[1.0, 3.0, NAN], [NAN, NAN, NAN]],
        ]
    )
    make_cube(raw, "core_t", months_from(2020, 1, 3), lat, lon, values)
    make_cube(raw, "grid_only", months_from(2020, 1, 3), lat, lon, values, unit="")
    harmony = {
        "variable_id": "core_t",
        "location_id": "box",
        "aggregation": "area_mean",
        "unit": "K",
        "source_api": "harmony",
        "request": {},
        "retrieved_at": NOW,
        "product_version": "1",
        "grid": None,
        "points": [
            {"month": "2020-01-01", "value": 99.0, "n_samples": 1, "coverage": 1}
        ],
    }
    (out / "series").mkdir(parents=True)
    (out / "series" / "core_t__box__area_mean.json").write_text(json.dumps(harmony))
    blocked = {**harmony, "variable_id": "grid_only", "aggregation": AGGREGATION}
    (out / "series" / f"grid_only__box__{AGGREGATION}.json").write_text(
        json.dumps(blocked)
    )
    known = [{"id": "core_t", "tier": "core", "unit": "K", "source": "giovanni"}]
    locations = [
        region("box", [-1.0, -1.0, 1.5, 61.0]),
        region("empty", [1.9, -1.0, 2.1, 61.0]),
        region("nowhere", [50.0, 50.0, 51.0, 51.0], group="world_region"),
        {"id": "pt", "kind": "point", "lat": 0.0, "lon": 0.0, "group": "taiwan"},
    ]
    seed = [seed_entry("core_t"), seed_entry("grid_only", needs_translation=True)]
    report = run(seed, known, locations, raw, out, now=NOW)
    return raw, out, report


def test_run_writes_monthly_points_with_spatial_coverage(computed):
    _, out, report = computed
    series = json.loads(
        (out / "series" / f"core_t__box__{AGGREGATION}.json").read_text()
    )

    assert series["source_api"] == "grid"
    assert series["aggregation"] == "area_mean_grid"
    assert series["grid"] is None
    assert series["unit"] == "K"
    assert series["request"]["bbox"] == [-1.0, -1.0, 1.5, 61.0]
    assert series["request"]["weights"] == "cos(latitude)"
    assert series["request"]["n_cells"] == 4
    assert series["request"]["grid"] == {
        "lat_step": 60.0,
        "lon_step": 1.0,
        "n_lat": 2,
        "n_lon": 3,
    }
    assert (
        series["request"]["cube_first_month"],
        series["request"]["cube_last_month"],
    ) == ("2020-01", "2020-03")
    first, second, third = series["points"]
    assert first == {
        "month": "2020-01-01",
        "value": pytest.approx(20.0),
        "n_samples": 1,
        "coverage": pytest.approx(1.0),
    }
    assert second == {
        "month": "2020-02-01",
        "value": None,
        "n_samples": 0,
        "coverage": 0.0,
    }
    assert third["value"] == pytest.approx(2.0)
    assert third["coverage"] == pytest.approx(2.0 / 3.0)
    assert report["all_nan_months"]["core_t"] == ["2020-02"]


def test_regions_without_cells_or_without_any_value_get_no_series(computed):
    _, out, report = computed

    assert not list((out / "series").glob("*__empty__*"))
    assert not list((out / "series").glob("*__nowhere__*"))
    assert report["skipped"]["core_t"] == {
        "nowhere": "bbox 裡沒有任何格點中心",
        "empty": "區域內整段期間都是缺值",
    }
    assert report["series_written_by_location_group"] == {"taiwan": 1}


def test_series_from_other_sources_are_never_overwritten(computed):
    _, out, report = computed
    harmony = json.loads((out / "series" / "core_t__box__area_mean.json").read_text())
    blocked = json.loads(
        (out / "series" / f"grid_only__box__{AGGREGATION}.json").read_text()
    )

    # Harmony 的 area_mean 原封不動，格點版本在旁邊並存
    assert harmony["source_api"] == "harmony"
    assert harmony["points"][0]["value"] == 99.0
    # 同一個檔名已被別的來源佔用時不覆蓋，並記在報告裡
    assert blocked["source_api"] == "harmony"
    assert list(report["refused"]) == [f"grid_only__box__{AGGREGATION}"]


def test_catalog_describes_variables_that_only_exist_in_the_grid_seed(computed):
    _, out, _ = computed
    catalog = json.loads((out / "catalog.json").read_text())
    variables = {v["id"]: v for v in catalog["variables"]}

    assert variables["grid_only"]["source"] == "grid"
    assert variables["grid_only"]["product"] == "PROD.1"
    assert variables["core_t"]["unit"] == "K"
    assert {(s["variable_id"], s["aggregation"]) for s in catalog["series"]} >= {
        ("core_t", "area_mean"),
        ("core_t", "area_mean_grid"),
    }


def test_sqlite_imports_grid_series_into_their_own_source_table(
    computed, tmp_path: Path
):
    _, out, _ = computed
    snapshot = tmp_path / "snapshot"
    write_catalog(snapshot, [], [], [], generated_at=NOW)
    db_path = tmp_path / "db.sqlite"

    counts = build_database(snapshot, tmp_path / "raw", db_path, out)

    with sqlite3.connect(db_path) as db:
        series = db.execute(
            "SELECT variable_id, source_api, source_table, tier FROM series"
            " WHERE source_api = 'grid'"
        ).fetchall()
        rows = db.execute(
            "SELECT month, value, coverage, cube_id, product, bbox_w, bbox_n,"
            " lat_step, n_cells, weights FROM src_grid"
            " WHERE variable_id = 'core_t' ORDER BY month"
        ).fetchall()
        unified = db.execute(
            "SELECT COUNT(*) FROM observations WHERE source_api = 'grid'"
        ).fetchone()[0]
    assert series == [("core_t", "grid", "src_grid", "extended")]
    assert counts["src_grid"] == 3 == unified
    assert rows[0] == (
        "2020-01-01",
        pytest.approx(20.0),
        pytest.approx(1.0),
        "core_t",
        "PROD.1",
        -1.0,
        61.0,
        60.0,
        4,
        "cos(latitude)",
    )
    assert rows[1][1] is None
    assert ("core_t", "box", "area_mean_grid") not in series_without_source_rows(
        db_path
    )
