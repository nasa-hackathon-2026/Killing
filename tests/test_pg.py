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
import pytest

from trend_detective import cleaning, pg, trends

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
    # 2 × 2 的趨勢格點，涵蓋 22–24°N、120–122°E；斜率 0.1、0.2、0.3、缺值
    grid = root / "grid" / "tair"
    grid.mkdir(parents=True)
    np.array([100, 200, 300, -32768], dtype="<i2").tofile(
        grid / "trend_slope_per_decade.i16"
    )
    np.array([1, 3, 3, 0], dtype=np.uint8).tofile(grid / "trend_significance.u8")
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
    exported = pg.cleaning_summary(database, "core")
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
