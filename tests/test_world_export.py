"""世界子集的匯出（#107）：對應表、同源核對、匯出格式、冪等。"""

import json
import os
from pathlib import Path
from typing import Any

import pytest

from trend_detective import world_export
from trend_detective.world_export import (
    MappingError,
    check_against_core,
    collect,
    export_series,
    exported_variables,
    missing_variables,
    month_table,
    source_mismatches,
    subset_locations,
    write_subset,
)

REPO = Path(__file__).resolve().parents[1]

MAPPING: dict[str, Any] = {
    "location_groups": [
        {"group": "world_city", "aggregation": "point"},
        {"group": "global", "aggregation": "area_mean_grid"},
    ],
    "variables": [
        {
            "core_id": "omi_no2",
            "extended_id": "omi_no2_ext",
            "giovanni_data": "OMNO2d_003_ColumnAmountNO2TropCloudScreened",
            "product": "OMNO2d.003",
            "product_version": "003",
            "unit": "molecules/cm^2",
        },
        {"core_id": "modis_ndvi", "extended_id": None, "reason_en": "Taiwan only"},
    ],
}
LOCATIONS = [
    {"id": "global", "kind": "region", "group": "global", "name_en": "Global"},
    {"id": "europe", "kind": "region", "group": "world_region", "name_en": "Europe"},
    {
        "id": "tokyo",
        "kind": "point",
        "group": "world_city",
        "name_en": "Tokyo",
        "lat": 35.68,
        "lon": 139.69,
        "geojson": {"type": "Feature"},
    },
    {
        "id": "sydney",
        "kind": "point",
        "group": "world_city",
        "name_en": "Sydney",
        "lat": -33.87,
        "lon": 151.21,
    },
]
VARIABLES = [
    {"id": "omi_no2", "name_en": "Tropospheric NO2"},
    {"id": "modis_ndvi", "name_en": "NDVI"},
]


def point_series(
    location: str, variable: str = "omi_no2_ext", **over: Any
) -> dict[str, Any]:
    return {
        "variable_id": variable,
        "location_id": location,
        "aggregation": "point",
        "unit": "molecules/cm^2",
        "source_api": "giovanni",
        "request": {
            "data": "OMNO2d_003_ColumnAmountNO2TropCloudScreened",
            "location": [1.0, 2.0],
            "start": "2001-01-01",
        },
        "retrieved_at": "2026-11-14T12:49:30Z",
        "product_version": "003",
        "grid": {"lat": 1.125, "lon": 2.125},
        "points": [
            {
                "month": "2004-10-01",
                "value": 3.6128408333333336e16,
                "n_samples": 12,
                "coverage": 0.3870967741935484,
            },
            {"month": "2004-11-01", "value": None, "n_samples": 0, "coverage": 0.0},
        ],
        **over,
    }


def grid_series() -> dict[str, Any]:
    return point_series(
        "global",
        aggregation="area_mean_grid",
        source_api="grid",
        request={"product": "OMNO2d.003", "cube_id": "omi_no2"},
        grid=None,
    )


def write_extended(directory: Path, series: list[dict[str, Any]]) -> Path:
    (directory / "series").mkdir(parents=True)
    for item in series:
        name = (
            f"{item['variable_id']}__{item['location_id']}__{item['aggregation']}.json"
        )
        (directory / "series" / name).write_text(json.dumps(item), encoding="utf-8")
    return directory


def test_mapping_splits_exported_and_missing_variables() -> None:
    assert [row["core_id"] for row in exported_variables(MAPPING)] == ["omi_no2"]
    assert missing_variables(MAPPING) == ["modis_ndvi"]


def test_subset_locations_keeps_cities_and_global_with_their_aggregation() -> None:
    assert [(loc["id"], agg) for loc, agg in subset_locations(MAPPING, LOCATIONS)] == [
        ("global", "area_mean_grid"),
        ("tokyo", "point"),
        ("sydney", "point"),
    ]


def test_export_renames_the_variable_and_marks_the_source() -> None:
    source = point_series("tokyo")
    exported = export_series(MAPPING["variables"][0], source)
    assert exported.variable_id == "omi_no2"
    assert exported.file == "series/omi_no2__tokyo__point.json"
    assert exported.request == {
        **source["request"],
        "exported_from": "extended",
        "extended_variable_id": "omi_no2_ext",
    }
    # 數值、樣本數、覆蓋率與時間戳原樣保留
    assert exported.points == source["points"]
    assert exported.retrieved_at == source["retrieved_at"]
    assert exported.grid == source["grid"]


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"unit": "1/cm2"}, "unit"),
        ({"product_version": "004"}, "product_version"),
        ({"request": {"data": "OMNO2d_003_ColumnAmountNO2"}}, "request.data"),
        ({"source_api": "harmony"}, "source_api"),
    ],
)
def test_a_series_from_another_source_is_refused(
    change: dict[str, Any], expected: str
) -> None:
    series = point_series("tokyo", **change)
    assert any(
        expected in p for p in source_mismatches(MAPPING["variables"][0], series)
    )
    with pytest.raises(MappingError):
        export_series(MAPPING["variables"][0], series)


def test_grid_series_is_checked_by_product() -> None:
    row = MAPPING["variables"][0]
    assert source_mismatches(row, grid_series()) == []
    other = {**grid_series(), "request": {"product": "OMNO2d.004"}}
    assert source_mismatches(row, other) != []


def test_collect_reports_what_extended_does_not_have(tmp_path: Path) -> None:
    extended = write_extended(
        tmp_path / "extended", [point_series("tokyo"), grid_series()]
    )
    series, absent = collect(MAPPING, LOCATIONS, extended)
    assert [s.file for s in series] == [
        "series/omi_no2__global__area_mean_grid.json",
        "series/omi_no2__tokyo__point.json",
    ]
    assert absent == [("omi_no2", "sydney", "point")]


def test_core_series_must_match_the_mapping(tmp_path: Path) -> None:
    core = tmp_path / "core"
    (core / "series").mkdir(parents=True)
    assert "no core point series" in check_against_core(MAPPING, core)[0]
    path = core / "series" / "omi_no2__taichung__point.json"
    path.write_text(json.dumps(point_series("taichung", "omi_no2")), encoding="utf-8")
    assert check_against_core(MAPPING, core) == []
    path.write_text(
        json.dumps(point_series("taichung", "omi_no2", unit="DU")), encoding="utf-8"
    )
    assert "unit" in check_against_core(MAPPING, core)[0]


def test_write_subset_is_idempotent_and_drops_stale_files(tmp_path: Path) -> None:
    extended = write_extended(
        tmp_path / "extended", [point_series("tokyo"), grid_series()]
    )
    series, _ = collect(MAPPING, LOCATIONS, extended)
    out = tmp_path / "world"
    (out / "series").mkdir(parents=True)
    stale = out / "series" / "omi_no2__europe__area_mean_grid.json"
    stale.write_text("{}", encoding="utf-8")

    write_subset(out, MAPPING, VARIABLES, LOCATIONS, series, now="2026-11-15T00:00:00Z")
    assert not stale.exists()
    catalog = json.loads((out / "catalog.json").read_text(encoding="utf-8"))
    assert [v["id"] for v in catalog["variables"]] == ["omi_no2"]
    assert catalog["variables"][0]["unit"] == "molecules/cm^2"
    assert catalog["variables"][0]["valid_from"] == "2004-10-01"
    assert [loc["id"] for loc in catalog["locations"]] == ["global", "tokyo"]
    assert "geojson" not in catalog["locations"][1]
    assert catalog["snapshot"]["exported_from"] == "extended"
    assert catalog["snapshot"]["not_available"] == ["modis_ndvi"]
    assert catalog["snapshot"]["generated_at"] == "2026-11-15T00:00:00Z"
    written = json.loads(
        (out / "series" / "omi_no2__tokyo__point.json").read_text(encoding="utf-8")
    )
    assert written["variable_id"] == "omi_no2"
    assert written["points"] == point_series("tokyo")["points"]

    before = {p: p.read_bytes() for p in out.rglob("*.json")}
    write_subset(out, MAPPING, VARIABLES, LOCATIONS, series, now="2026-11-16T00:00:00Z")
    assert {p: p.read_bytes() for p in out.rglob("*.json")} == before


def test_month_table_counts_months_with_a_value() -> None:
    series = [export_series(MAPPING["variables"][0], point_series("tokyo"))]
    assert month_table(series) == [
        {
            "variable_id": "omi_no2",
            "location_id": "tokyo",
            "first_month": "2004-10",
            "last_month": "2004-10",
            "n_valid": 1,
        }
    ]


def test_committed_mapping_lists_the_twelve_layer_variables() -> None:
    mapping = world_export.load_mapping(REPO / world_export.MAPPING_FILE)
    assert len(mapping["variables"]) == 12
    assert missing_variables(mapping) == ["modis_ndvi", "modis_lst"]
    seed = {
        v["id"]: v
        for v in json.loads(
            (REPO / "data/seed/variables.json").read_text(encoding="utf-8")
        )
    }
    for row in exported_variables(mapping):
        assert row["giovanni_data"] == seed[row["core_id"]]["source_variable_id"]
        assert row["product"] == seed[row["core_id"]]["product"]
    assert check_against_core(mapping, REPO / "data/snapshot") == []


def test_committed_world_subset_matches_the_mapping() -> None:
    mapping = world_export.load_mapping(REPO / world_export.MAPPING_FILE)
    world = REPO / world_export.WORLD_DIR
    catalog = json.loads((world / "catalog.json").read_text(encoding="utf-8"))
    wanted = {row["core_id"] for row in exported_variables(mapping)}
    assert {entry["variable_id"] for entry in catalog["series"]} == wanted
    cities = [loc for loc in catalog["locations"] if loc["group"] == "world_city"]
    assert len(cities) == 12
    for entry in catalog["series"]:
        series = json.loads((world / entry["file"]).read_text(encoding="utf-8"))
        assert series["request"]["exported_from"] == "extended"
    trends = json.loads(
        (REPO / world_export.ANALYSIS_DIR / "trends.json").read_text(encoding="utf-8")
    )
    assert trends["fdr_family"]["scope"] == "world_subset"
    assert trends["fdr_family"]["n_series"] == len(catalog["series"])
    assert set(trends["series"]) == {
        f"{e['variable_id']}__{e['location_id']}__{e['aggregation']}"
        for e in catalog["series"]
    }
    tokyo = trends["series"]["gldas_tair__tokyo__point"]
    assert tokyo["known_issues"] and tokyo["auxiliary"] is False


@pytest.mark.extended_data
def test_exported_values_equal_the_extended_files() -> None:
    """需要 data/extended（不進 git，可用 EXTENDED_DIR 指定）；沒有就跳過。"""
    root = os.environ.get("EXTENDED_DIR") or REPO / world_export.EXTENDED_DIR
    extended = Path(root) / "series"
    if not extended.is_dir():
        pytest.skip("data/extended is not in this checkout")
    mapping = world_export.load_mapping(REPO / world_export.MAPPING_FILE)
    world = REPO / world_export.WORLD_DIR
    catalog = json.loads((world / "catalog.json").read_text(encoding="utf-8"))
    names = {row["core_id"]: row["extended_id"] for row in exported_variables(mapping)}
    for entry in catalog["series"]:
        ours = json.loads((world / entry["file"]).read_text(encoding="utf-8"))
        name = (
            f"{names[entry['variable_id']]}__{entry['location_id']}__"
            f"{entry['aggregation']}.json"
        )
        theirs = json.loads((extended / name).read_text(encoding="utf-8"))
        assert ours["points"] == theirs["points"], entry["file"]
