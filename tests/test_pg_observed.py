"""觀測來源進資料庫與「模式 vs 觀測」配對（#97）的整合測試。需要容器；連不上時整個檔跳過。

用自己的資料庫（`trend_detective_test_observed`，每次重建），不碰正式的 `trend_detective`。
"""

import json
import math
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import psycopg
import pytest

from trend_detective import cleaning, model_obs, observed, pg

TEST_DATABASE = "trend_detective_test_observed"
pytestmark = [
    pytest.mark.pg,
    pytest.mark.skipif(
        not pg.database_available(), reason="沒有可連線的 PostgreSQL 容器"
    ),
]

MIGRATIONS = Path(__file__).parent.parent / "db" / "migrations"
RETRIEVED = "2026-11-14T00:00:00Z"
N_MONTHS = 300


def _write(path: Path, content: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content), encoding="utf-8")


def _points(values: list[float]) -> list[dict[str, Any]]:
    return [
        {
            "month": cleaning.index_month(2001 * 12 + i),
            "value": value,
            "n_samples": 1,
            "coverage": 1.0,
        }
        for i, value in enumerate(values)
    ]


def _series(
    variable: str, location: str, aggregation: str, source: str, values: list[float]
) -> dict[str, Any]:
    return {
        "variable_id": variable,
        "location_id": location,
        "aggregation": aggregation,
        "unit": "K",
        "source_api": source,
        "request": {},
        "retrieved_at": RETRIEVED,
        "product_version": "1",
        "grid": None,
        "points": _points(values),
    }


def _catalog(
    directory: Path,
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    series: list[dict[str, Any]],
) -> None:
    entries = []
    for s in series:
        name = f"{s['variable_id']}__{s['location_id']}__{s['aggregation']}"
        _write(directory / "series" / f"{name}.json", s)
        entries.append(
            {
                "variable_id": s["variable_id"],
                "location_id": s["location_id"],
                "aggregation": s["aggregation"],
                "file": f"series/{name}.json",
            }
        )
    _write(
        directory / "catalog.json",
        {
            "snapshot": {"generated_at": RETRIEVED},
            "variables": variables,
            "locations": locations,
            "series": entries,
        },
    )


@pytest.fixture(scope="module")
def inputs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("pg_observed")
    rng = np.random.default_rng(0)
    season = [5 * math.sin(2 * math.pi * (i % 12) / 12) for i in range(N_MONTHS)]
    noise = rng.normal(0, 0.3, N_MONTHS)
    model = [290 + season[i] + 0.05 * i / 12 + noise[i] for i in range(N_MONTHS)]
    station = [17 + season[i] + 0.02 * i / 12 + noise[i] for i in range(N_MONTHS)]
    taipei = {"id": "taipei", "kind": "point", "name_en": "Taipei", "lat": 25.03, "lon": 121.56}  # fmt: skip
    _catalog(
        root / "snapshot",
        [
            {"id": "tair", "name_en": "Air temperature", "product": "MODEL"},
            {"id": "station_temp", "name_en": "Station temperature"},
        ],
        [taipei],
        [
            _series("tair", "taipei", "point", "giovanni", model),
            _series("station_temp", "taipei", "station", "giovanni", station),
        ],
    )
    # 兩個觀測來源：gistemp（新變數、新的半球地點）與台灣測站（沿用核心變數、新的測站地點）
    _write(
        root / "sources" / "gistemp.json",
        {
            "source": "gistemp",
            "data_kind": "in_situ",
            "citation": ["a", "b"],
            "variables": [{"id": "gistemp_anom", "name_en": "Anomaly", "unit": "K"}],
            "locations": "every point location",
            "new_locations": [
                {
                    "id": "northern_hemisphere",
                    "kind": "region",
                    "group": "global",
                    "name_en": "Northern Hemisphere",
                    "bbox": [-180, 0, 180, 90],
                }
            ],
        },
    )
    _write(
        root / "sources" / "ghcnh_taiwan.json",
        {
            "source": "ghcnh_taiwan",
            "source_api": "noaa_ghcnh",
            "variables": [{"id": "station_temp", "reuse_core_variable": True}],
            "locations": [
                {
                    "id": "stn_airport",
                    "kind": "point",
                    "name_en": "Airport",
                    "lat": 22.58,
                    "lon": 120.35,
                    "elevation_m": 7.9,
                    "region": "south",
                }
            ],
        },
    )
    _write(
        root / "sources" / "smap.json",
        {
            "source": "smap",
            "variables": [{"id": "smap_sm_l3", "name_en": "Soil moisture"}],
            "locations": ["taipei"],
        },
    )
    _catalog(
        root / "observed" / "gistemp",
        [{"id": "gistemp_anom"}],
        [taipei, {"id": "northern_hemisphere", "kind": "region"}],
        [
            _series("gistemp_anom", "taipei", "point", "gistemp", list(noise)),
            _series(
                "gistemp_anom",
                "northern_hemisphere",
                "area_mean",
                "gistemp",
                list(noise),
            ),
        ],
    )
    _catalog(
        root / "observed" / "ghcnh_taiwan",
        [{"id": "station_temp"}],
        [{"id": "stn_airport", "kind": "point"}],
        [_series("station_temp", "stn_airport", "station", "noaa_ghcnh", station)],
    )
    _catalog(root / "observed" / "smap", [{"id": "smap_sm_l3"}], [], [])
    _write(
        root / "cleaning.json",
        {
            "rules": vars(cleaning.CleaningRules()),
            "known_issues": [
                {
                    "id": "airport_sampling",
                    "kind": "sampling_change",
                    "variable_id": "station_temp",
                    "location_pattern": "^stn_airport$",
                    "summary_en": "sampling",
                    "source_doc": "docs/x.md",
                },
                {
                    "id": "smap_none",
                    "kind": "no_data",
                    "variable_id": "smap_sm_l3",
                    "summary_en": "0 retrievals",
                    "source_doc": "docs/x.md",
                },
            ],
        },
    )
    _write(
        root / "data_kinds.json",
        {
            "rules": [
                {"variable_id": "tair", "data_kind": "model"},
                {"variable_pattern": "^(gistemp_|station_)", "data_kind": "in_situ"},
            ]
        },
    )
    _write(
        root / "pairs.json",
        {
            "groups": [
                {
                    "id": "stations",
                    "quantity": "near_surface_air_temperature",
                    "locations": ["taipei", "stn_airport"],
                    "observations": [
                        {"variable_id": "station_temp", "aggregation": "station"},
                        {"variable_id": "gistemp_anom", "aggregation": "point"},
                    ],
                    "models": [
                        {
                            "variable_id": "tair",
                            "source": "series",
                            "aggregation": "point",
                            "location_map": {"stn_airport": "taipei"},
                        }
                    ],
                }
            ]
        },
    )
    return {"root": root}


@pytest.fixture(scope="module")
def database(inputs: dict[str, Path]) -> Iterator[psycopg.Connection[Any]]:
    root = inputs["root"]
    with pg.connect(pg.ENV_FILE, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DATABASE} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {TEST_DATABASE}")
    patch = pytest.MonkeyPatch()
    patch.setenv("PGDATABASE", TEST_DATABASE)
    try:
        pg.load(
            pg.ENV_FILE,
            snapshot_dir=root / "snapshot",
            extended_dir=None,
            raw_dir=root / "no-raw",
            seed_file=root / "cleaning.json",
            grid_dir=root / "grid",
            migrations_dir=MIGRATIONS,
            observed_dir=root / "observed",
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


def test_observed_series_come_after_core_and_keep_core_definitions(
    database: psycopg.Connection[Any],
) -> None:
    rows = _all(
        database,
        "SELECT series_id, tier, variable_id, location_id, source_api FROM meta.series"
        " ORDER BY 1",
    )
    assert [row[1] for row in rows] == ["core", "core", *["observed"] * 3]
    assert rows[2:] == [
        (3, "observed", "gistemp_anom", "northern_hemisphere", "gistemp"),
        (4, "observed", "gistemp_anom", "taipei", "gistemp"),
        (5, "observed", "station_temp", "stn_airport", "noaa_ghcnh"),
    ]
    # station_temp 是核心變數，沒有被觀測來源的宣告蓋掉；SMAP 沒有序列但變數有登記
    assert _all(
        database, "SELECT id, tier, data_kind FROM meta.variables ORDER BY 1"
    ) == [
        ("gistemp_anom", "observed", "in_situ"),
        ("smap_sm_l3", "observed", "unknown"),
        ("station_temp", "core", "in_situ"),
        ("tair", "core", "model"),
    ]
    assert _all(
        database,
        "SELECT citation, source FROM meta.variables WHERE id = 'gistemp_anom'",
    ) == [("a b", "gistemp")]
    sources = dict(_all(database, "SELECT id, raw_table FROM meta.sources"))
    assert sources["gistemp"] is None and sources["smap"] is None
    assert sources["noaa_ghcnh"] == "raw.noaa_ghcnh"


def test_new_locations_get_geometry_and_attributes(
    database: psycopg.Connection[Any],
) -> None:
    assert _all(
        database,
        "SELECT id, tier, attributes->>'region', (attributes->>'elevation_m')::float"
        " FROM meta.locations WHERE tier = 'observed' ORDER BY 1",
    ) == [
        ("northern_hemisphere", "observed", None, None),
        ("stn_airport", "observed", "south", 7.9),
    ]
    assert _all(database, "SELECT location_id FROM geo.regions ORDER BY 1") == [
        ("northern_hemisphere",)
    ]
    assert _all(
        database,
        "SELECT location_id, round(ST_X(geom)::numeric, 2)::float FROM geo.locations"
        " ORDER BY 1",
    ) == [("stn_airport", 120.35), ("taipei", 121.56)]


def test_location_scoped_issue_only_marks_that_station(
    database: psycopg.Connection[Any],
) -> None:
    rows = _all(
        database,
        "SELECT s.location_id, q.known_issues FROM clean.series_summary q"
        " JOIN meta.series s USING (series_id) WHERE s.variable_id = 'station_temp'"
        " ORDER BY 1",
    )
    assert rows == [("stn_airport", ["airport_sampling"]), ("taipei", [])]
    assert _all(
        database,
        "SELECT location_id, issue_id FROM meta.series_known_issues ORDER BY 1",
    ) == [("stn_airport", "airport_sampling")]
    # SMAP 的「沒有資料」是一列已知問題，沒有序列適用
    assert _all(
        database, "SELECT kind FROM meta.known_issues WHERE id = 'smap_none'"
    ) == [("no_data",)]


def test_observed_trends_are_loaded_with_the_same_method(
    database: psycopg.Connection[Any], inputs: dict[str, Path]
) -> None:
    root = inputs["root"]
    result = observed.analyze(
        root / "observed", root / "sources", root / "cleaning.json"
    )
    assert set(result["series"]) == {
        "gistemp_anom__northern_hemisphere__area_mean",
        "gistemp_anom__taipei__point",
        "station_temp__stn_airport__station",
    }
    station = result["series"]["station_temp__stn_airport__station"]
    assert station["known_issues"] == ["airport_sampling"]
    assert station["ols"]["slope_per_decade"] == pytest.approx(0.2, abs=0.1)


def test_model_obs_pairs_table_and_export(
    database: psycopg.Connection[Any], inputs: dict[str, Path]
) -> None:
    root = inputs["root"]
    patch = pytest.MonkeyPatch()
    patch.setenv("PGDATABASE", TEST_DATABASE)
    try:
        result = model_obs.build(
            pg.ENV_FILE,
            rules_file=root / "pairs.json",
            raw_grid_dir=root / "no-grid",
            analysis_dir=root / "analysis",
        )
    finally:
        patch.undo()
    assert result["summary"]["n_pairs"] == 3 and result["summary"]["n_analyzed"] == 3
    rows = _all(
        database,
        "SELECT pair_id, n_common_months, round(slope_difference::numeric, 2)::float,"
        " diff_slope_significant, known_issues, model_detail->>'distance_km' IS NOT NULL"
        " FROM analysis.model_obs_pairs ORDER BY 1",
    )
    assert rows == [
        ("tair__gistemp_anom__taipei", 300, pytest.approx(0.5, abs=0.02), True, [], False),
        ("tair__station_temp__stn_airport", 300, 0.3, True, ["airport_sampling"], True),
        ("tair__station_temp__taipei", 300, 0.3, True, [], False),
    ]  # fmt: skip
    exported = json.loads((root / "analysis" / "model_vs_obs.json").read_text())
    assert exported["summary"]["n_pairs"] == 3
    pair = next(
        p for p in exported["pairs"] if p["pair_id"] == "tair__station_temp__taipei"
    )
    assert len(pair["monthly"]["difference"]) == 300
    assert pair["annual"]["first_year"] == 2001
    assert len(pair["annual"]["difference"]) == 25
    assert exported["variables"]["tair"]["data_kind"] == "model"
    assert exported["variables"]["station_temp"]["data_kind"] == "in_situ"
    assert set(exported["known_issues"]) == {"airport_sampling"}
    assert (root / "analysis" / "model_vs_obs.run.json").exists()
