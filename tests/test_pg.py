"""PostgreSQL 清洗資料庫的整合測試。需要 `db/compose.yaml` 的容器；連不上時整個檔跳過。

測試用自己的資料庫（`trend_detective_test`，每次重建），不碰正式的 `trend_detective`。
"""

import json
import math
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import psycopg
import pymannkendall
import pytest
from scipy import stats

from trend_detective import cleaning, pg, pg_extensions, trends

TEST_DATABASE = "trend_detective_test"
pytestmark = [
    pytest.mark.pg,
    pytest.mark.skipif(
        not pg.database_available(), reason="沒有可連線的 PostgreSQL 容器"
    ),
]

MIGRATIONS = Path(__file__).parent.parent / "db" / "migrations"
RETRIEVED = "2021-03-10T00:00:00Z"


def _month(index: int) -> str:
    return cleaning.index_month(2001 * 12 + index)


def _write(path: Path, content: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content), encoding="utf-8")


def _series(variable: str, location: str, aggregation: str, points: list[Any]) -> Any:
    return {
        "variable_id": variable,
        "location_id": location,
        "aggregation": aggregation,
        "unit": "K",
        "source_api": "giovanni",
        "request": {"variable": variable.upper(), "bbox": [120.0, 22.0, 122.0, 25.0]},
        "retrieved_at": RETRIEVED,
        "product_version": "1",
        "grid": {"lat": 25.0, "lon": 121.5},
        "points": points,
    }


@pytest.fixture(scope="module")
def inputs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """一份很小的快照：兩條序列、兩個地點、一個 2 × 2 的趨勢格點。"""
    root = tmp_path_factory.mktemp("pg")
    snapshot = root / "snapshot"
    rng = np.random.default_rng(0)
    values = [float(v) for v in 290 + rng.normal(size=243)]
    full = [
        {"month": _month(i), "value": v, "n_samples": 1, "coverage": 1.0}
        for i, v in enumerate(values)
    ]
    gappy = [dict(p) for p in full]
    gappy[10]["value"] = None  # 值是 null
    gappy[20]["coverage"] = 0.1  # 低覆蓋
    del gappy[30:34]  # 四個月沒有列（長缺口）
    del gappy[40]  # 一個月沒有列（短缺口；刪掉上面四個之後的位置）
    all_series = [
        _series("tair", "taipei", "point", full),
        _series("soil_ct", "taiwan", "area_mean", gappy),
    ]
    catalog = {
        "snapshot": {"generated_at": RETRIEVED},
        "variables": [
            {"id": "tair", "name_en": "Near-surface air temperature", "is_nasa": True},
            {"id": "soil_ct", "name_en": "Soil moisture observation count"},
        ],
        "locations": [
            {"id": "taipei", "kind": "point", "name_en": "Taipei", "lat": 25.03, "lon": 121.56},
            {"id": "taiwan", "kind": "region", "name_en": "Taiwan", "bbox": [120.0, 22.0, 122.0, 25.0]},
        ],
        "series": [
            {
                "variable_id": s["variable_id"],
                "location_id": s["location_id"],
                "aggregation": s["aggregation"],
                "file": f"series/{s['variable_id']}.json",
            }
            for s in all_series
        ],
    }  # fmt: skip
    _write(snapshot / "catalog.json", catalog)
    for s in all_series:
        _write(snapshot / "series" / f"{s['variable_id']}.json", s)
    seed = root / "cleaning.json"
    _write(
        seed,
        {
            "rules": vars(cleaning.CleaningRules()),
            "known_issues": [
                {
                    "id": "tair_step",
                    "kind": "discontinuity",
                    "variable_id": "tair",
                    "period_start": _month(5),
                    "period_end": _month(6),
                    "flag_months": True,
                    "break_months": [_month(5)],
                    "summary_en": "test step",
                    "source_doc": "docs/x.md",
                },
                {
                    "id": "counts",
                    "kind": "auxiliary",
                    "variable_pattern": "_ct$",
                    "summary_en": "counts",
                    "source_doc": "docs/x.md",
                },
            ],
        },
    )
    _write(
        root / "data_kinds.json",
        {
            "rules": [
                {"variable_id": "tair", "data_kind": "model", "note": "forcing"},
                {"variable_pattern": "^soil", "data_kind": "satellite_retrieval"},
            ]
        },
    )
    _write(
        root / "variable_taxonomy.json",
        {
            "core": {"tair": "atmosphere.temperature.near_surface"},
            "rules": [{"variable_pattern": "_ct$", "path": "auxiliary.count"}],
        },
    )
    # 2 × 2 的趨勢格點，涵蓋 22–24°N、120–122°E；斜率 0.1、0.2、0.3、缺值
    grid = root / "grid" / "tair"
    grid.mkdir(parents=True)
    np.array([100, 200, 300, -32768], dtype="<i2").tofile(
        grid / "trend_slope_per_decade.i16"
    )
    np.array([1, 3, 3, 0], dtype=np.uint8).tofile(grid / "trend_significance.u8")
    # 兩年的逐年平均（K）：值 = 整數 × 0.01 + 273.15；右上角那一格缺值
    np.array([1000, 2000, 3000, -32768, 1100, 2100, 3100, -32768], dtype="<i2").tofile(
        grid / "annual_mean.i16"
    )
    _write(
        grid / "meta.json",
        {
            "id": "tair",
            "name_en": "Near-surface air temperature",
            "grid": {
                "n_lat": 2,
                "n_lon": 2,
                "lat_south_edge": 22.0,
                "lat_step": 1.0,
                "lon_west_edge": 120.0,
                "lon_step": 1.0,
            },
            "trend": {"period": {"first_month": "2001-01", "last_month": "2021-03"}},
            "layers": [
                {
                    "name": "annual_mean",
                    "file": "annual_mean.i16",
                    "unit": "K",
                    "scale": 0.01,
                    "offset": 273.15,
                    "n_layers": 2,
                    "labels": ["2001", "2002"],
                },
                {
                    "name": "trend_slope_per_decade",
                    "file": "trend_slope_per_decade.i16",
                    "unit": "K per decade",
                    "scale": 0.001,
                    "offset": 0.0,
                    "n_layers": 1,
                },
                {
                    "name": "trend_significance",
                    "file": "trend_significance.u8",
                    "dtype": "uint8",
                    "scale": 1.0,
                    "offset": 0.0,
                    "n_layers": 1,
                },
            ],
        },
    )
    return {"snapshot": snapshot, "seed": seed, "grid": root / "grid", "root": root}


@pytest.fixture(scope="module")
def database(
    inputs: dict[str, Path],
) -> Iterator[psycopg.Connection[Any]]:
    with pg.connect(pg.ENV_FILE, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DATABASE} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {TEST_DATABASE}")
    patch = pytest.MonkeyPatch()
    patch.setenv("PGDATABASE", TEST_DATABASE)
    try:
        pg.load(
            pg.ENV_FILE,
            snapshot_dir=inputs["snapshot"],
            extended_dir=None,
            raw_dir=inputs["root"] / "no-raw",
            seed_file=inputs["seed"],
            grid_dir=inputs["grid"],
            migrations_dir=MIGRATIONS,
        )
        pg.clean(pg.ENV_FILE)
        with pg.connect(pg.ENV_FILE) as conn:
            yield conn
    finally:
        patch.undo()
        with pg.connect(pg.ENV_FILE, autocommit=True) as admin:
            admin.execute(f"DROP DATABASE IF EXISTS {TEST_DATABASE} WITH (FORCE)")


def _all(conn: psycopg.Connection[Any], query: str, *arguments: Any) -> list[Any]:
    return conn.execute(query, arguments).fetchall()  # pyright: ignore[reportArgumentType]


def test_observations_are_a_hypertable_with_the_snapshot_values(
    database: psycopg.Connection[Any], inputs: dict[str, Path]
) -> None:
    assert _all(
        database, "SELECT hypertable_name FROM timescaledb_information.hypertables"
    ) == [("observations",)]
    source = json.loads((inputs["snapshot"] / "series/soil_ct.json").read_text())
    rows = _all(
        database,
        "SELECT o.month::text, o.value_raw, o.coverage FROM obs.observations o"
        " JOIN meta.series s USING (series_id) WHERE s.variable_id = 'soil_ct'"
        " ORDER BY 1",
    )
    assert rows == [(p["month"], p["value"], p["coverage"]) for p in source["points"]]


def test_gapfill_skeleton_finds_the_missing_months(
    database: psycopg.Connection[Any],
) -> None:
    rows = _all(
        database,
        "SELECT m.month::text, m.missing_kind FROM obs.missing_months() m"
        " JOIN meta.series s USING (series_id) WHERE s.variable_id = 'soil_ct'"
        " ORDER BY 1",
    )
    assert rows == [
        (_month(10), "null_value"),
        *[(_month(i), "no_row") for i in (30, 31, 32, 33)],
        (_month(44), "no_row"),
    ]
    # tair 沒有缺月
    assert _all(
        database,
        "SELECT count(*) FROM obs.missing_months() m JOIN meta.series s"
        " USING (series_id) WHERE s.variable_id = 'tair'",
    ) == [(0,)]


def test_clean_flags_fills_and_keeps_raw_values(
    database: psycopg.Connection[Any],
) -> None:
    rows = _all(
        database,
        "SELECT o.month::text, o.qc_flag, o.fill_method, o.value_raw, o.value_clean,"
        " o.anomaly_filled FROM clean.observations o JOIN meta.series s"
        " USING (series_id) WHERE s.variable_id = 'soil_ct' ORDER BY 1",
    )
    by_month = {row[0]: row for row in rows}
    assert len(rows) == 243  # 骨架逐月完整
    assert by_month[_month(10)][1:3] == ("missing", "linear")
    assert by_month[_month(20)][1:3] == ("low_coverage", "linear")
    assert by_month[_month(20)][3] is not None and by_month[_month(20)][4] is None
    assert {by_month[_month(i)][1:3] for i in (30, 31, 32, 33)} == {
        ("missing", "climatology")
    }
    assert by_month[_month(31)][5] == 0.0
    assert by_month[_month(44)][1:3] == ("missing", "linear")
    # 取得資料的月份（2021-03）還沒過完
    assert by_month[_month(242)][1] == "partial_month"
    assert by_month[_month(242)][5] is None  # 尾端不外推
    flags = dict(
        _all(
            database,
            "SELECT o.qc_flag, count(*) FROM clean.observations o JOIN meta.series s"
            " USING (series_id) WHERE s.variable_id = 'tair' GROUP BY 1",
        )
    )
    assert flags["known_discontinuity"] == 2
    assert flags["partial_month"] == 1


def test_summary_views_and_run_log(database: psycopg.Connection[Any]) -> None:
    summary = dict(
        _all(
            database,
            "SELECT s.variable_id, to_jsonb(q) FROM clean.series_summary q"
            " JOIN meta.series s USING (series_id)",
        )
    )
    soil = summary["soil_ct"]
    assert (soil["n_missing"], soil["n_low_coverage"], soil["n_partial_month"]) == (
        6,
        1,
        1,
    )
    assert (soil["n_filled_linear"], soil["n_filled_climatology"]) == (3, 4)
    assert soil["longest_gap_months"] == 4
    assert soil["auxiliary"] is True and soil["known_issues"] == ["counts"]
    assert summary["tair"]["known_issues"] == ["tair_step"]
    assert _all(
        database, "SELECT id FROM meta.variables WHERE is_auxiliary ORDER BY 1"
    ) == [("soil_ct",)]
    # 趨勢的輸入不含不可用月份；探勘的輸入含補值
    counts = dict(
        _all(database, "SELECT variable_id, count(*) FROM clean.trend_input GROUP BY 1")
    )
    assert counts == {"tair": 242, "soil_ct": 242 - 7}
    assert _all(
        database,
        "SELECT count(*) FROM clean.mining_input WHERE variable_id = 'soil_ct'",
    ) == [(242,)]
    assert _all(database, "SELECT count(*) FROM clean.monthly_climatology") == [(24,)]
    steps = _all(database, "SELECT step FROM analysis.runs ORDER BY run_id")
    assert [row[0] for row in steps][:2] == ["load", "clean"]
    assert _all(
        database, "SELECT id, data_kind, data_kind_note FROM meta.variables ORDER BY 1"
    ) == [("soil_ct", "satellite_retrieval", None), ("tair", "model", "forcing")]
    assert _all(
        database,
        "SELECT id, break_months::text[] FROM meta.known_issues ORDER BY 1",
    ) == [("counts", None), ("tair_step", [_month(5)])]
    exported = pg.cleaning_summary(database, "core")
    assert exported["data_kinds"]["variables"]["tair"]["data_kind"] == "model"
    assert exported["data_kinds"]["counts"]["model"] == {
        "n_variables": 1,
        "n_series": 1,
    }
    assert exported["totals"]["all"]["n_series"] == 2
    assert exported["totals"]["all"]["n_filled"] == 7
    assert set(exported["series"]) == {
        "tair__taipei__point",
        "soil_ct__taiwan__area_mean",
    }


def test_yearly_mean_continuous_aggregate(database: psycopg.Connection[Any]) -> None:
    (year, mean, n_months), *_ = _all(
        database,
        "SELECT y.year::text, y.mean_value, y.n_months FROM obs.yearly_mean y"
        " JOIN meta.series s USING (series_id) WHERE s.variable_id = 'tair'"
        " ORDER BY 1 LIMIT 1",
    )
    (expected,) = _all(
        database,
        "SELECT avg(o.value_raw) FROM obs.observations o JOIN meta.series s"
        " USING (series_id) WHERE s.variable_id = 'tair' AND o.month < '2002-01-01'",
    )[0]
    assert (year, n_months) == ("2001-01-01", 12)
    assert mean == pytest.approx(expected)


def test_region_trend_is_area_weighted(database: psycopg.Connection[Any]) -> None:
    (row,) = _all(
        database,
        "SELECT n_cells, n_cells_significant_fdr, mean_slope_per_decade,"
        " significant_fdr_area_fraction FROM geo.region_grid_trend('tair', 'taiwan')",
    )

    def band(south: float) -> float:
        return math.sin(math.radians(south + 1)) - math.sin(math.radians(south))

    # 三個有分析的格子：南邊一列 0.1、0.2，北邊一列 0.3；權重是緯度帶的面積
    weights = [band(22.0), band(22.0), band(23.0)]
    expected = float(np.average([0.1, 0.2, 0.3], weights=weights))
    assert row[:2] == (3, 2)
    assert row[2] == pytest.approx(expected, rel=1e-6)
    assert row[3] == pytest.approx((weights[1] + weights[2]) / sum(weights), rel=1e-9)


def test_nearest_queries_and_fuzzy_search(database: psycopg.Connection[Any]) -> None:
    nearest = _all(
        database,
        "SELECT location_id, variable_id, distance_km FROM geo.nearest_series(121.5, 25.0, 1)",
    )
    assert [(row[0], row[1]) for row in nearest] == [("taipei", "tair")]
    assert 0 < nearest[0][2] < 10
    cells = _all(
        database, "SELECT lat, lon FROM geo.nearest_cells('tair', 120.4, 22.4, 1)"
    )
    assert cells == [(22.5, 120.5)]
    found = _all(database, "SELECT id FROM meta.search_variables('air temprature', 1)")
    assert found == [("tair",)]
    # JSONB：用請求參數找序列
    assert _all(
        database,
        'SELECT count(*) FROM meta.series WHERE request @> \'{"variable": "TAIR"}\'',
    ) == [(1,)]


def test_trend_results_are_written_back_and_agree_with_the_cleaned_table(
    database: psycopg.Connection[Any], inputs: dict[str, Path]
) -> None:
    """趨勢統計直接從序列檔清洗（不連資料庫）；寫回後可用月數要和 `clean.*` 一致。"""
    analysis_dir = inputs["root"] / "analysis"
    result, anomalies = trends.analyze_snapshot(
        inputs["snapshot"], trends.TrendParams(), cleaning_seed=inputs["seed"]
    )
    trends.write_outputs(
        analysis_dir, result, anomalies, generated_at="2021-03-10T00:00:00Z"
    )
    counts = pg.load_analysis(pg.ENV_FILE, analysis_dir=analysis_dir, extended_dir=None)
    assert counts == {"analysis.trends (core)": 2}
    database.rollback()  # 看得到另一個連線剛寫入的列
    rows = _all(
        database,
        "SELECT s.variable_id, t.status, t.n_valid, q.n_usable, t.auxiliary,"
        " t.known_issues, (t.cleaning->>'n_partial_month')::int, t.slope_per_decade,"
        " (t.result->'ols'->>'slope_per_decade')::float8"
        " FROM analysis.trends t JOIN meta.series s USING (series_id)"
        " JOIN clean.series_summary q USING (series_id) ORDER BY 1",
    )
    assert [row[0] for row in rows] == ["soil_ct", "tair"]
    for row in rows:
        assert row[1] == "analyzed"
        assert row[2] == row[3]
        assert row[6] == 1
        assert row[7] == row[8]
    assert rows[0][4:6] == (True, ["counts"])
    assert rows[1][4:6] == (False, ["tair_step"])
    # 月距平也和資料庫裡的一致
    key = "soil_ct__taiwan__area_mean"
    stored = [
        row[0]
        for row in _all(
            database,
            "SELECT o.anomaly FROM clean.observations o JOIN meta.series s"
            " USING (series_id) WHERE s.variable_id = 'soil_ct'"
            " AND o.month BETWEEN %s AND %s ORDER BY o.month",
            result["series"][key]["data"]["first_month"],
            result["series"][key]["data"]["last_month"],
        )
    ]
    from_file = anomalies["series"][key]["values"]
    assert len(stored) == len(from_file)
    for a, b in zip(stored, from_file, strict=True):
        assert (a is None and b is None) or a == pytest.approx(b, rel=1e-6)
    last = _all(database, "SELECT step FROM analysis.runs ORDER BY run_id DESC LIMIT 1")
    assert last == [("trends_core",)]


# ---------------------------------------------------------------- 其他擴充（#91）


def _band(south: float) -> float:
    return math.sin(math.radians(south + 1)) - math.sin(math.radians(south))


def test_raster_zonal_statistics_match_the_area_weighted_grid(
    database: psycopg.Connection[Any],
) -> None:
    assert _all(
        database,
        "SELECT ST_NumBands(rast), ST_Width(rast), ST_Height(rast), ST_UpperLeftX(rast),"
        " ST_UpperLeftY(rast), ST_ScaleX(rast), ST_ScaleY(rast), ST_SRID(rast),"
        " ST_BandPixelType(rast, 1), ST_BandPixelType(rast, 2)"
        " FROM geo.trend_rasters WHERE variable_id = 'tair'",
    ) == [(2, 2, 2, 120.0, 24.0, 1.0, -1.0, 4326, "32BF", "8BUI")]
    # 西南角那一格是 0.1；東北角是缺值
    point = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)"
    values = _all(
        database,
        f"SELECT ST_Value(rast, 1, {point}), ST_Value(rast, 2, {point}),"
        f" ST_Value(rast, 1, {point}) FROM geo.trend_rasters",
        *(120.5, 22.5, 120.5, 22.5, 121.5, 23.5),
    )
    assert values[0][0] == pytest.approx(0.1, rel=1e-6)
    assert values[0][1:] == (1.0, None)
    (row,) = _all(
        database,
        "SELECT n_cells, n_pixels, grid_area_weighted_mean, raster_lat_weighted_mean,"
        " raster_pixel_mean, grid_significant_area_fraction,"
        " raster_significant_area_fraction FROM geo.region_raster_vs_grid"
        " WHERE variable_id = 'tair' AND region_id = 'taiwan'",
    )
    assert row[:2] == (3, 3)
    # 緯度加權後與面積加權相同；像元等權的平均不同
    assert row[3] == pytest.approx(row[2], rel=1e-6)
    assert row[4] == pytest.approx(0.2, rel=1e-6)
    assert row[4] != pytest.approx(row[2], rel=1e-4)
    assert row[6] == pytest.approx(row[5], rel=1e-9)


def test_annual_mean_rasters_give_regional_means(
    database: psycopg.Connection[Any],
) -> None:
    rows = _all(
        database,
        "SELECT year, unit, n_pixels, pixel_mean, lat_weighted_mean"
        " FROM geo.region_raster_annual_mean('tair', 'taiwan')",
    )
    weights = [_band(22.0), _band(22.0), _band(23.0)]
    assert [row[:3] for row in rows] == [(2001, "K", 3), (2002, "K", 3)]
    assert rows[0][3] == pytest.approx(273.15 + 20.0, rel=1e-6)
    expected = float(np.average([283.15, 293.15, 303.15], weights=weights))
    assert rows[0][4] == pytest.approx(expected, rel=1e-6)
    assert rows[1][3] == pytest.approx(273.15 + 21.0, rel=1e-6)


def test_ltree_categories_come_from_the_taxonomy_seed(
    database: psycopg.Connection[Any],
) -> None:
    assert _all(
        database,
        "SELECT id, category_path::text, category_basis FROM meta.variables ORDER BY 1",
    ) == [
        ("soil_ct", "auxiliary.count", "rule:1"),
        ("tair", "atmosphere.temperature.near_surface", "manual"),
    ]
    assert _all(
        database,
        "SELECT variable_id, location_id FROM meta.series_in_category('atmosphere')",
    ) == [("tair", "taipei")]
    assert _all(
        database,
        "SELECT path::text, n_variables, n_series FROM meta.category_tree"
        " WHERE path ~ 'atmosphere.*' ORDER BY depth",
    ) == [
        ("atmosphere", 1, 1),
        ("atmosphere.temperature", 1, 1),
        ("atmosphere.temperature.near_surface", 1, 1),
    ]
    summary = pg_extensions.taxonomy_summary(database, "core")
    assert summary["variables"]["tair"] == {
        "category_path": "atmosphere.temperature.near_surface",
        "basis": "manual",
    }
    assert summary["n_unclassified"] == 0


def test_h3_index_and_neighbourhood_trends(database: psycopg.Connection[Any]) -> None:
    assert _all(
        database,
        "SELECT (SELECT count(*) FROM geo.locations WHERE h3_res3 IS NULL),"
        " (SELECT count(*) FROM geo.grid_cells WHERE h3_res3 IS NULL),"
        " (SELECT sum(n_cells) FROM geo.h3_trends WHERE resolution = 3),"
        " (SELECT sum(n_cells) FROM geo.h3_trends WHERE resolution = 2)",
    ) == [(0, 0, 3, 3)]
    # 花蓮外海那一格：以 (120.5, 22.5) 為中心，取所在格與一圈鄰格
    rows = _all(
        database,
        "SELECT ring_distance, variable_id, n_cells, mean_slope_per_decade"
        " FROM geo.h3_trends_at(120.5, 22.5, 1, 3)",
    )
    assert rows[0][:3] == (0, "tair", 1)
    assert rows[0][3] == pytest.approx(0.1, rel=1e-6)
    assert all(row[0] in (0, 1) for row in rows)
    # 解析度 2 的一格夠大，台北所在格與鄰格合起來涵蓋三個有分析的格子
    near = _all(
        database,
        "SELECT sum(n_cells) FROM geo.h3_neighbourhood_trends('taipei', 1, 2)",
    )
    assert near == [(3,)]
    wide = _all(
        database,
        "SELECT n_variables, slopes ? 'tair' FROM geo.h3_trends_wide WHERE resolution = 2",
    )
    assert wide and all(row == (1, True) for row in wide)


def test_toolkit_and_gapfill_reproduce_the_python_cleaning(
    database: psycopg.Connection[Any],
) -> None:
    report = pg_extensions.check_toolkit(database)
    assert report["climatology"]["n_compared"] == 24
    assert report["climatology"]["n_only_on_one_side"] == 0
    assert report["climatology"]["max_relative_difference"] < 1e-12
    assert report["anomalies_vs_python"]["n_differs_beyond_1e-9"] == 0
    assert (
        report["anomalies_vs_python"]["n_compared"]
        == report["anomalies_vs_python"]["n_python_anomalies"]
    )
    filled = report["filled_month_index_axis"]
    assert filled["n_only_in_sql"] == filled["n_only_in_python"] == 0
    assert filled["n_fill_method_differs"] == 0
    # soil_ct：值是 null 的月、低覆蓋的月、單獨缺的一個月是線性；連續四個月是月氣候值
    assert (filled["n_linear"], filled["n_climatology"]) == (3, 4)
    assert filled["n_linear_value_differs"] == 0
    assert filled["n_climatology_not_zero"] == 0
    # 照日期（各月天數不同）內插就和 Python 的等距內插不一樣
    assert report["filled_calendar_time_axis"]["n_linear_value_differs"] > 0


def test_similar_series_orders_by_cosine_and_applies_filters(
    database: psycopg.Connection[Any],
) -> None:
    ids = dict(_all(database, "SELECT variable_id, series_id FROM meta.series"))
    # 測試序列沒有涵蓋向量的期間，所以沒有向量
    assert _all(database, "SELECT analysis.refresh_series_embeddings()") == [(0,)]
    rng = np.random.default_rng(1)
    base = rng.normal(size=248)
    other = 0.8 * base + 0.6 * rng.normal(size=248)
    with database.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO analysis.series_embeddings VALUES"
            " (%s, '2005-01-01', '2025-08-01', 0, 1, %s::vector)",
            [
                (ids["tair"], json.dumps(base.tolist())),
                (ids["soil_ct"], json.dumps(other.tolist())),
            ],
        )
    expected = float(base @ other / np.linalg.norm(base) / np.linalg.norm(other))
    rows = _all(
        database,
        "SELECT variable_id, location_id, cosine_similarity"
        " FROM analysis.similar_series(%s, 5)",
        ids["tair"],
    )
    assert [row[:2] for row in rows] == [("soil_ct", "taiwan")]
    assert rows[0][2] == pytest.approx(expected, abs=1e-6)

    def count(filters: dict[str, Any]) -> int:
        return len(
            _all(
                database,
                "SELECT 1 FROM analysis.similar_series(%s, 5, %s::jsonb)",
                ids["tair"],
                json.dumps(filters),
            )
        )

    assert count({"different_variable": True, "different_location": True}) == 1
    assert count({"exclude_auxiliary": True}) == 0  # soil_ct 是輔助變數
    assert count({"category": "auxiliary"}) == 1
    assert count({"category": "land"}) == 0
    assert count({"aggregation": "point"}) == 0
    database.execute("TRUNCATE analysis.series_embeddings")


def test_variable_graph_components_and_paths(database: psycopg.Connection[Any]) -> None:
    (run_id,) = _all(database, "SELECT max(run_id) FROM analysis.runs")[0:1][0]
    rules = [
        ("rules", 1, ["a=high"], "b=high", 2.0, 0.01),
        ("rules", 2, ["b=low", "a=low"], "c=low", 4.0, 0.001),
        ("rules", 3, ["d=high"], "e=low", 1.6, 0.02),
        ("persistence_rules", 1, ["f=high"], "f=high", 3.0, 0.001),
    ]
    with database.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO analysis.mining_rules VALUES"
            " (%s, 'region', 'same_month', %s, %s, %s, %s, 0.1, 0.7, %s, %s, %s)",
            [(run_id, *rule[:4], rule[4], rule[5], rule[5]) for rule in rules],
        )
    counts = pg_extensions.derive(database)
    assert counts["analysis.variable_graph"] == 4  # a–b、a–c、b–c、d–e
    assert counts["analysis.variable_graph_nodes"] == 6
    assert _all(
        database,
        "SELECT variables FROM analysis.variable_graph_components ORDER BY 1",
    ) == [(["a", "b", "c"],), (["d", "e"],), (["f"],)]
    report = pg_extensions.check_pgrouting(database)
    assert report["n_components"] == 3
    assert report["n_nodes_component_differs_from_union_find"] == 0
    # a–c 直接相連（lift 4，成本 0.25），比經過 b（0.5 + 0.25）近
    assert _all(
        database,
        "SELECT variable_id, total_cost FROM analysis.variable_path('a', 'c')",
    ) == [("a", 0.0), ("c", 0.25)]
    assert _all(database, "SELECT count(*) FROM analysis.variable_path('a', 'e')") == [
        (0,)
    ]
    database.execute(
        "DELETE FROM analysis.mining_rules WHERE antecedents <@ %s",
        (["a=high", "a=low", "b=low", "d=high", "f=high"],),
    )


def test_crosstab_wide_table_matches_the_python_mining_table(
    database: psycopg.Connection[Any], inputs: dict[str, Path]
) -> None:
    assert _all(database, "SELECT analysis.build_mining_wide('point')") == [(242,)]
    report = pg_extensions.check_tablefunc(database, inputs["root"] / "analysis")
    point = report["point"]
    assert point["python_shape"] == point["sql_shape"] == [242, 1]
    assert point["same_variables"] and point["same_months"]
    assert point["n_values_compared"] == 242
    assert point["n_null_pattern_differs"] == 0
    assert point["max_relative_difference"] < 1e-6
    # 區域表預設排除 taiwan，所以是空的；不排除就有 soil_ct 一欄，補過值所以沒有 NULL
    assert _all(database, "SELECT analysis.build_mining_wide('region')") == [(0,)]
    assert _all(
        database, "SELECT analysis.build_mining_wide('region', ARRAY[]::text[])"
    ) == [(242,)]
    assert _all(
        database,
        "SELECT count(*), count(soil_ct) FROM analysis.mining_wide_region",
    ) == [(242, 242)]


def test_plpython_mann_kendall_matches_pymannkendall(
    database: psycopg.Connection[Any],
) -> None:
    for variable in ("tair", "soil_ct"):
        rows = _all(
            database,
            "SELECT extract(year FROM o.month) * 12 + extract(month FROM o.month), o.anomaly"
            " FROM clean.observations o JOIN meta.series s USING (series_id)"
            " WHERE s.variable_id = %s AND o.anomaly IS NOT NULL ORDER BY o.month",
            variable,
        )
        years = np.array([float(row[0]) for row in rows]) / 12
        values = np.array([row[1] for row in rows])
        expected = pymannkendall.original_test(values)
        (found,) = _all(
            database,
            "SELECT m.n, m.s, m.var_s, m.z, m.p, m.tau, m.sen_slope_per_decade"
            " FROM meta.series s, analysis.mann_kendall(s.series_id) m"
            " WHERE s.variable_id = %s",
            variable,
        )
        assert found[0] == len(values)
        assert found[1] == pytest.approx(expected.s)
        assert found[2] == pytest.approx(expected.var_s)
        assert found[3] == pytest.approx(expected.z, rel=1e-9)
        assert found[4] == pytest.approx(expected.p, abs=1e-12)
        assert found[5] == pytest.approx(expected.Tau, rel=1e-9)
        sen: Any = stats.theilslopes(values, years)
        assert found[6] == pytest.approx(10 * float(sen.slope), rel=1e-9)
    # 太短或有 NULL 的輸入不算
    assert _all(
        database,
        "SELECT (analysis.mann_kendall_values(ARRAY[1, 2]::float8[], ARRAY[1, 2]::float8[])).z",
    ) == [(None,)]


def test_bm25_search_finds_variables_and_known_issues(
    database: psycopg.Connection[Any],
) -> None:
    found = _all(
        database, "SELECT kind, ref_id, score FROM meta.search_text('air temperature')"
    )
    assert (found[0][0], found[0][1]) == ("variable", "tair")
    assert found[0][2] > 0
    issues = _all(
        database,
        "SELECT ref_id FROM meta.search_text('step') WHERE kind = 'known_issue'",
    )
    assert issues == [("tair_step",)]
    assert _all(
        database, "SELECT count(*) FROM meta.search_text('zzzunknownword')"
    ) == [(0,)]


def test_known_issue_periods_cannot_overlap_and_units_convert(
    database: psycopg.Connection[Any],
) -> None:
    with pytest.raises(psycopg.errors.ExclusionViolation), database.transaction():
        database.execute(
            "INSERT INTO meta.known_issues (id, kind, variable_id, period_start,"
            " period_end, flag_months, summary_en, source_doc) VALUES"
            " ('overlap', 'discontinuity', 'tair', %s, %s, true, 'x', 'docs/x.md')",
            (_month(6), _month(8)),
        )
    # 不標月份的註記可以重疊
    with database.transaction(force_rollback=True):
        database.execute(
            "INSERT INTO meta.known_issues (id, kind, variable_id, period_start,"
            " period_end, flag_months, summary_en, source_doc) VALUES"
            " ('note', 'product_disagreement', 'tair', %s, %s, false, 'x', 'docs/x.md')",
            (_month(6), _month(8)),
        )
    (row,) = _all(
        database,
        "SELECT meta.convert_unit(273.15, 'K', 'degC'),"
        " meta.convert_unit(1e-5, 'kg m-2 s-1', 'mm/day'),"
        " meta.convert_unit(1, 'mm/hr', 'mm/day'), meta.convert_unit(1, 'K', 'mm/day')",
    )
    assert row[0] == pytest.approx(0.0, abs=1e-9)
    assert row[1] == pytest.approx(0.864, rel=1e-9)
    assert row[2] == pytest.approx(24.0, rel=1e-9)
    assert row[3] is None


def test_foreign_tables_exist_and_status_lists_every_extension(
    database: psycopg.Connection[Any],
) -> None:
    assert _all(
        database,
        "SELECT count(*) FROM information_schema.foreign_tables"
        " WHERE foreign_table_schema = 'raw'",
    ) == [(4,)]
    # pg_cron 只能建在 cron.database_name 那個資料庫；測試資料庫沒有它，migration 也不能因此失敗
    assert _all(
        database, "SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron'"
    ) == [(0,)]
    assert pg_extensions.check_pg_cron(database) == {"enabled": False}
    status = {
        (name, target): (version, count)
        for name, version, target, count in pg_extensions.extension_status(database)
    }
    assert status[("postgis_raster", "geo.trend_rasters")][1] == "1"
    assert status[("postgis_raster", "geo.annual_mean_rasters")][1] == "2"
    assert status[("pg_cron", "cron.job")][0] == "未啟用"
    assert all(
        version != "未啟用"
        for (name, _), (version, _) in status.items()
        if name != "pg_cron"
    )
    # 查詢失敗之後連線仍然可用
    assert _all(database, "SELECT 1") == [(1,)]
