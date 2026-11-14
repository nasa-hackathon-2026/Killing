"""格點 seed 的產生：從 DMR 挑出 緯度 × 經度 的變數，配上 CMR 的 collection 資訊。"""

import json
from pathlib import Path

import httpx
import pytest

from trend_detective.grid_catalog import (
    CatalogError,
    GridVariable,
    build_seed,
    grid_variables,
)
from trend_detective.grid_fetch import load_products

SECRET = "secret-token-value"

# 手寫的 DMR：根目錄一個帶時間軸的變數、群組裡一個 lon × lat 的變數（IMERG 的排法）、
# 一個多了氣壓層的剖面、一個座標邊界、以及只用維度大小（沒有名稱）的變數。
DMR = """<?xml version="1.0" encoding="ISO-8859-1"?>
<Dataset xmlns="http://xml.opendap.org/ns/DAP/4.0#" dapVersion="4.0" name="demo.nc4">
  <Dimension name="time" size="1"/>
  <Dimension name="lat" size="2"/>
  <Dimension name="lon" size="4"/>
  <Dimension name="lev" size="3"/>
  <Dimension name="bnds" size="2"/>
  <Float64 name="lat"><Dim name="/lat"/>
    <Attribute name="units" type="String"><Value>degrees_north</Value></Attribute>
  </Float64>
  <Float64 name="lon"><Dim name="/lon"/>
    <Attribute name="units" type="String"><Value>degrees_east</Value></Attribute>
  </Float64>
  <Int32 name="time"><Dim name="/time"/>
    <Attribute name="units" type="String"><Value>minutes since 2001-01-01</Value></Attribute>
  </Int32>
  <Float32 name="T2M"><Dim name="/time"/><Dim name="/lat"/><Dim name="/lon"/>
    <Attribute name="units" type="String"><Value>K</Value></Attribute>
    <Attribute name="long_name" type="String"><Value>2-meter_air_temperature</Value></Attribute>
  </Float32>
  <Float32 name="T"><Dim name="/time"/><Dim name="/lev"/><Dim name="/lat"/><Dim name="/lon"/>
    <Attribute name="units" type="String"><Value>K</Value></Attribute>
  </Float32>
  <Float64 name="lat_bnds"><Dim name="/lat"/><Dim name="/bnds"/></Float64>
  <Float32 name="scalar_table"><Dim size="5"/></Float32>
  <String name="note"/>
  <Group name="Grid">
    <Dimension name="y" size="2"/>
    <Dimension name="x" size="4"/>
    <Float32 name="y"><Dim name="/Grid/y"/>
      <Attribute name="units" type="String"><Value>degrees_north</Value></Attribute>
    </Float32>
    <Float32 name="x"><Dim name="/Grid/x"/>
      <Attribute name="units" type="String"><Value>degrees_east</Value></Attribute>
    </Float32>
    <Group name="Data Fields">
      <Float32 name="rain"><Dim name="/time"/><Dim name="/Grid/x"/><Dim name="/Grid/y"/>
        <Attribute name="Units" type="String"><Value>mm/hr</Value></Attribute>
        <Attribute name="LongName" type="String"><Value>Merged
            precipitation estimate</Value></Attribute>
      </Float32>
      <Int16 name="Count_A"><Dim name="/Grid/y"/><Dim name="/Grid/x"/></Int16>
    </Group>
  </Group>
</Dataset>
"""

COLLECTION = {
    "meta": {"concept-id": "C9-DEMO"},
    "umm": {
        "ShortName": "DEMO_M",
        "Version": "2.1",
        "EntryTitle": "Demo monthly",
        "DOI": {"DOI": "10.1234/DEMO"},
        "TemporalExtents": [
            {"RangeDateTimes": [{"BeginningDateTime": "2000-03-01T00:00:00.000Z"}]}
        ],
        "CollectionCitations": [
            {
                "Creator": "Doe, J.",
                "Title": "Demo monthly V2.1",
                "Publisher": "GES DISC",
                "ReleaseDate": "2020-02-03T00:00:00.000Z",
                "ReleasePlace": "Greenbelt, MD, USA",
            }
        ],
    },
}


def test_only_lat_lon_variables_are_listed_with_their_units_and_names():
    assert grid_variables(DMR) == [
        GridVariable(
            path="/Grid/Data Fields/Count_A",
            lat="/Grid/y",
            lon="/Grid/x",
            unit="",
            long_name="",
        ),
        GridVariable(
            path="/Grid/Data Fields/rain",
            lat="/Grid/y",
            lon="/Grid/x",
            unit="mm/hr",
            long_name="Merged precipitation estimate",
        ),
        GridVariable(
            path="/T2M",
            lat="/lat",
            lon="/lon",
            unit="K",
            long_name="2-meter_air_temperature",
        ),
    ]


def earthdata(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/collections.umm_json"):
        assert dict(request.url.params) == {"short_name": "DEMO_M", "version": "2.1"}
        return httpx.Response(200, json={"items": [COLLECTION]})
    if path.endswith("/granules.umm_json"):
        assert request.url.params["collection_concept_id"] == "C9-DEMO"
        assert request.url.params["sort_key"] == "-start_date"
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "umm": {
                            "RelatedUrls": [
                                {"Subtype": "USER'S GUIDE", "URL": "https://x/doc"},
                                {
                                    "Subtype": "OPENDAP DATA",
                                    "URL": "https://opendap.example/g/latest.nc4",
                                },
                            ]
                        }
                    }
                ]
            },
        )
    assert str(request.url) == "https://opendap.example/g/latest.nc4.dmr.xml"
    assert request.headers["Authorization"] == f"Bearer {SECRET}"
    return httpx.Response(200, text=DMR)


def make_seed(config: dict, *, existing: list[dict] | None = None) -> list[dict]:
    names = {"demo_rain": {"name_zh": "降水", "name_en": "Precipitation (Demo)"}}
    with httpx.Client(transport=httpx.MockTransport(earthdata)) as http:
        return build_seed(
            http, SECRET, [config], names=names, existing_seed=existing or []
        )


CONFIG = {
    "prefix": "demo",
    "short_name": "DEMO_M",
    "version": "2.1",
    "core": {
        "/Grid/Data Fields/rain": {
            "id": "demo_rain",
            "frontend": {
                "lat_step": 1.0,
                "lon_factor": 2,
                "scale": 0.001,
                "offset": 0.0,
                "slope_scale": 0.0001,
            },
        },
        "/Grid/Data Fields/Count_A": {"id": "demo_count", "unit": "1"},
    },
}


def test_seed_entries_come_from_the_file_listing_and_the_collection_record():
    seed = make_seed(CONFIG)

    assert [entry["id"] for entry in seed] == ["demo_count", "demo_rain", "demo_t2m"]
    assert seed[1] == {
        "id": "demo_rain",
        "name_zh": "降水",
        "name_en": "Precipitation (Demo)",
        "needs_translation": False,
        "long_name": "Merged precipitation estimate",
        "unit": "mm/hr",
        "product": "DEMO_M.2.1",
        "product_version": "2.1",
        "collection": "C9-DEMO",
        "doi": "10.1234/DEMO",
        "citation": "Doe, J. (2020), Demo monthly V2.1, Greenbelt, MD, USA, "
        "GES DISC, doi:10.1234/DEMO",
        "start": "2000-03",
        "variable": "/Grid/Data Fields/rain",
        "lat": "/Grid/y",
        "lon": "/Grid/x",
        "frontend": CONFIG["core"]["/Grid/Data Fields/rain"]["frontend"],
    }
    # 檔案沒有單位時才用設定檔給的；不在 variables.json 的變數名稱待補
    assert (seed[0]["unit"], seed[0]["needs_translation"]) == ("1", True)
    assert seed[2]["name_zh"] == seed[2]["name_en"] == "2-meter_air_temperature (T2M)"
    assert seed[2]["needs_translation"] is True
    assert "frontend" not in seed[2]


def test_a_daily_product_can_be_limited_to_its_core_variables():
    seed = make_seed({**CONFIG, "temporal": "day", "only_core": True})

    assert [entry["id"] for entry in seed] == ["demo_count", "demo_rain"]
    assert {entry["temporal"] for entry in seed} == {"day"}


def test_a_products_cell_reference_is_copied_to_each_of_its_entries():
    seed = make_seed({**CONFIG, "cell_reference": "north_west_corner"})

    assert {entry["cell_reference"] for entry in seed} == {"north_west_corner"}
    assert all("cell_reference" not in entry for entry in make_seed(CONFIG))


def test_the_generated_seed_loads_as_grid_products(tmp_path: Path):
    seed_file = tmp_path / "grids.extended.json"
    seed_file.write_text(json.dumps(make_seed(CONFIG)), encoding="utf-8")

    products = load_products(seed_file)

    assert [(p.id, p.derive, p.path) for p in products] == [
        ("demo_count", False, "/Grid/Data Fields/Count_A"),
        ("demo_rain", True, "/Grid/Data Fields/rain"),
        ("demo_t2m", False, "/T2M"),
    ]


def test_variables_already_in_another_seed_file_are_not_listed_again():
    existing = [{"id": "merra2_t2m", "collection": "C9-DEMO", "variable": "T2M"}]

    seed = make_seed(CONFIG, existing=existing)

    assert [entry["id"] for entry in seed] == ["demo_count", "demo_rain"]


def test_an_id_that_collides_with_an_existing_one_is_an_error():
    existing = [{"id": "demo_t2m", "collection": "C1-OTHER", "variable": "T2M"}]

    with pytest.raises(CatalogError, match="demo_t2m"):
        make_seed(CONFIG, existing=existing)


def test_a_core_variable_missing_from_the_file_is_an_error():
    config = {**CONFIG, "core": {"/Grid/gone": {"id": "demo_gone"}}}

    with pytest.raises(CatalogError, match="/Grid/gone"):
        make_seed(config)


def test_the_repo_extended_seed_loads_and_marks_what_needs_translation():
    root = Path(__file__).parent.parent
    products = load_products(root / "data/seed/grids.extended.json")
    hand_written = load_products(root / "data/seed/grids.json")

    ids = [product.id for product in products]
    assert len(set(ids)) == len(ids)
    assert not set(ids) & {product.id for product in hand_written}
    derived = {product.id for product in products if product.derive}
    assert derived == {
        "imerg_precip",
        "gldas_tair",
        "gldas_evap",
        "airs_tsurf",
        "airs_h2ovap",
    }
    named = derived | {"omi_o3", "omi_aerosol", "omi_no2"}
    assert {p.id for p in products if not p.needs_translation} == named
    assert {p.product for p in products if p.temporal == "day"} == {
        "OMTO3d.003",
        "OMAERUVd.003",
        "OMNO2d.003",
    }
