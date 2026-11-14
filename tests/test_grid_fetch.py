"""全球格點的取得：CMR 與 OPeNDAP 的 HTTP 邊界、由新到舊下載、立方體與衍生檔的組裝。"""

import json
from datetime import date
from pathlib import Path

import httpx
import netCDF4
import numpy as np
import pytest

from trend_detective.grid import GridError, read_frontend
from trend_detective.grid_fetch import (
    GridFetchError,
    GridProduct,
    build_cube,
    contiguous_months,
    download_month,
    fetch_months,
    list_granules,
    load_products,
    month_path,
    write_derived,
)

SECRET = "secret-token-value"
OPENDAP = "https://opendap.example/collections/C1-X/granules/"
NC_BYTES = b"\x89HDF\r\n\x1a\n-fake-netcdf"
PRODUCT = GridProduct(
    id="demo",
    name_zh="示範",
    name_en="Demo",
    product="DEMO.1",
    product_version="1",
    collection="C1-X",
    variable="T",
    doi="10.1234/DEMO",
    citation="Demo citation",
    start=date(2001, 1, 1),
    lat_step=90.0,
    lon_factor=2,
    scale=0.01,
    offset=0.0,
    slope_scale=0.001,
)


def granule(begin: str, name: str, *, opendap: bool = True) -> dict:
    urls = [{"Type": "GET DATA", "URL": f"https://data.example/{name}"}]
    if opendap:
        urls.append(
            {
                "Type": "USE SERVICE API",
                "Subtype": "OPENDAP DATA",
                "URL": OPENDAP + name,
            }
        )
    return {
        "umm": {
            "TemporalExtent": {"RangeDateTime": {"BeginningDateTime": begin}},
            "RelatedUrls": urls,
        }
    }


def write_month(month_dir: Path, month: date, value: float) -> None:
    """2 × 4 的全球小網格：整張同一個值，西南角那一格是 fill value。"""
    month_dir.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(month_path(month_dir, month), "w") as dataset:
        dataset.createDimension("time", 1)
        dataset.createDimension("lat", 2)
        dataset.createDimension("lon", 4)
        dataset.createVariable("lat", "f8", ("lat",))[:] = [-45.0, 45.0]
        dataset.createVariable("lon", "f8", ("lon",))[:] = [-135.0, -45.0, 45.0, 135.0]
        var = dataset.createVariable(
            "T", "f4", ("time", "lat", "lon"), fill_value=-9999.0
        )
        var.units = "K"
        var.set_auto_mask(False)
        data = np.full((1, 2, 4), value, dtype=np.float32)
        data[0, 0, 0] = -9999.0
        var[:] = data


def test_seed_file_lists_products_with_their_frontend_settings(tmp_path: Path):
    seed = tmp_path / "grids.json"
    seed.write_text(
        json.dumps(
            [
                {
                    "id": "demo",
                    "name_zh": "示範",
                    "name_en": "Demo",
                    "product": "DEMO.1",
                    "product_version": "1",
                    "collection": "C1-X",
                    "variable": "T",
                    "doi": "10.1234/DEMO",
                    "citation": "Demo citation",
                    "start": "2001-01",
                    "frontend": {
                        "lat_step": 90.0,
                        "lon_factor": 2,
                        "scale": 0.01,
                        "offset": 0.0,
                        "slope_scale": 0.001,
                    },
                }
            ]
        ),
        encoding="utf-8",
    )

    assert load_products(seed) == [PRODUCT]


def test_the_repo_seed_file_loads():
    products = load_products(Path(__file__).parent.parent / "data/seed/grids.json")

    assert [product.id for product in products][:1] == ["merra2_t2m"]


def test_list_granules_maps_months_to_opendap_urls_across_pages(monkeypatch):
    monkeypatch.setattr("trend_detective.grid_fetch.PAGE_SIZE", 2)
    pages = {
        "1": [
            granule("2001-01-01T00:00:00.000Z", "a.nc4"),
            granule("2001-02-01T00:00:00.000Z", "b.nc4", opendap=False),
        ],
        "2": [granule("2001-03-01T00:00:00.000Z", "c.nc4")],
    }
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params))
        return httpx.Response(
            200, json={"items": pages[request.url.params["page_num"]]}
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        found = list_granules(http, "C1-X", date(2001, 1, 1))

    assert found == {
        date(2001, 1, 1): OPENDAP + "a.nc4",
        date(2001, 3, 1): OPENDAP + "c.nc4",
    }
    assert seen[0]["collection_concept_id"] == "C1-X"
    assert seen[0]["temporal"] == "2001-01-01T00:00:00Z,"
    assert [params["page_num"] for params in seen] == ["1", "2"]


def test_list_granules_reports_cmr_errors():
    transport = httpx.MockTransport(lambda request: httpx.Response(500, text="boom"))

    with httpx.Client(transport=transport) as http, pytest.raises(GridFetchError):
        list_granules(http, "C1-X", date(2001, 1, 1))


def test_download_asks_for_one_variable_and_sends_the_bearer_token(tmp_path: Path):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=NC_BYTES)

    dest = tmp_path / "months" / "200101.nc4"
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        size = download_month(http, SECRET, OPENDAP + "a.nc4", "T2M", dest)

    assert size == len(NC_BYTES)
    assert dest.read_bytes() == NC_BYTES
    assert str(seen[0].url).startswith(OPENDAP + "a.nc4.dap.nc4?")
    assert seen[0].url.params["dap4.ce"] == "/T2M;/lat;/lon;/time"
    assert seen[0].headers["Authorization"] == f"Bearer {SECRET}"


def test_download_backs_off_on_429_and_5xx_then_succeeds(tmp_path: Path):
    replies = [
        httpx.Response(429, headers={"Retry-After": "7"}),
        httpx.Response(503),
        httpx.Response(200, content=NC_BYTES),
    ]
    waits: list[float] = []
    dest = tmp_path / "200101.nc4"

    with httpx.Client(
        transport=httpx.MockTransport(lambda request: replies.pop(0))
    ) as http:
        download_month(http, SECRET, OPENDAP + "a.nc4", "T", dest, sleep=waits.append)

    assert waits == [7.0, 4.0]
    assert dest.exists()


def test_download_gives_up_after_the_last_attempt_without_leaving_a_file(
    tmp_path: Path,
):
    dest = tmp_path / "200101.nc4"
    transport = httpx.MockTransport(lambda request: httpx.Response(503))

    with httpx.Client(transport=transport) as http, pytest.raises(GridFetchError):
        download_month(
            http, SECRET, OPENDAP + "a.nc4", "T", dest, attempts=3, sleep=lambda _: None
        )

    assert list(tmp_path.iterdir()) == []


def test_download_errors_never_contain_the_token(tmp_path: Path):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(401, text=f"bad token {SECRET}")
    )

    with (
        httpx.Client(transport=transport) as http,
        pytest.raises(GridFetchError) as raised,
    ):
        download_month(http, SECRET, OPENDAP + "a.nc4", "T", tmp_path / "x.nc4")

    assert SECRET not in str(raised.value)
    assert "401" in str(raised.value)


def test_download_rejects_a_reply_that_is_not_netcdf(tmp_path: Path):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, text="<html>login</html>")
    )

    with httpx.Client(transport=transport) as http, pytest.raises(GridFetchError):
        download_month(http, SECRET, OPENDAP + "a.nc4", "T", tmp_path / "x.nc4")


def test_fetch_goes_from_newest_to_oldest_and_skips_downloaded_months(tmp_path: Path):
    granules = {
        date(2001, 1, 1): OPENDAP + "200101",
        date(2001, 2, 1): OPENDAP + "200102",
        date(2001, 3, 1): OPENDAP + "200103",
        date(2001, 4, 1): OPENDAP + "200104",
    }
    month_path(tmp_path, date(2001, 3, 1)).write_bytes(NC_BYTES)
    order: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        order.append(request.url.path.rsplit("/", 1)[-1])
        if "200102" in request.url.path:
            return httpx.Response(404, text="missing")
        return httpx.Response(200, content=NC_BYTES)

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        count, size, failures = fetch_months(
            http, SECRET, PRODUCT, granules, tmp_path, workers=1
        )

    assert order == ["200104.dap.nc4", "200102.dap.nc4", "200101.dap.nc4"]
    assert (count, size) == (2, 2 * len(NC_BYTES))
    assert len(failures) == 1 and "404" in failures[0]
    assert not month_path(tmp_path, date(2001, 2, 1)).exists()


def test_contiguous_months_stop_at_the_first_gap_counting_back_from_the_newest(
    tmp_path: Path,
):
    for name in ("200011", "200101", "200102", "200103"):
        (tmp_path / f"{name}.nc4").write_bytes(b"")
    (tmp_path / "200104.part").write_bytes(b"")

    assert contiguous_months(tmp_path) == [
        date(2001, 1, 1),
        date(2001, 2, 1),
        date(2001, 3, 1),
    ]


def test_cube_and_frontend_files_are_built_from_the_downloaded_months(tmp_path: Path):
    month_dir = tmp_path / "months"
    # 2001 年每月 10、2002 年每月 12、2003 年只有 1 月（不齊全，不進逐年平均）
    for year, value in ((2001, 10.0), (2002, 12.0)):
        for month in range(1, 13):
            write_month(month_dir, date(year, month, 1), value)
    write_month(month_dir, date(2003, 1, 1), 99.0)

    cube = build_cube(PRODUCT, month_dir)
    written = write_derived(PRODUCT, cube, tmp_path / "out")

    assert cube.values.shape == (25, 2, 4)
    assert np.isnan(cube.values[0, 0, 0]) and cube.values[0, 1, 0] == 10.0
    assert cube.attrs["first_month"] == "2001-01"
    assert cube.attrs["last_month"] == "2003-01"
    assert cube.attrs["doi"] == "10.1234/DEMO"
    assert sorted(path.name for path in written) == [
        "annual_mean.i16",
        "exploratory_linear_slope_per_decade.i16",
        "meta.json",
        "monthly_climatology.i16",
    ]
    meta, arrays = read_frontend(tmp_path / "out")
    assert meta["coverage"] == {
        "first_month": "2001-01",
        "last_month": "2003-01",
        "n_months": 25,
        "complete_years": [2001, 2002],
        "note": meta["coverage"]["note"],
    }
    assert meta["doi"] == "10.1234/DEMO"
    assert (meta["grid"]["n_lat"], meta["grid"]["n_lon"]) == (2, 2)
    assert meta["layers"][0]["labels"] == ["2001", "2002"]
    # 西南那一格只有一半有值，仍算有效；值不受缺值影響
    np.testing.assert_allclose(arrays["annual_mean"][:, 0, 0], [10.0, 12.0])
    np.testing.assert_allclose(arrays["monthly_climatology"], 11.0)
    # 兩年差 2 → 每年 2 → 每十年 20
    np.testing.assert_allclose(arrays["exploratory_linear_slope_per_decade"], 20.0)
    assert "探索性" in meta["layers"][2]["description"]


def test_cube_refuses_months_on_a_different_grid(tmp_path: Path):
    write_month(tmp_path, date(2001, 1, 1), 1.0)
    with netCDF4.Dataset(month_path(tmp_path, date(2001, 2, 1)), "w") as dataset:
        dataset.createDimension("time", 1)
        dataset.createDimension("lat", 2)
        dataset.createDimension("lon", 4)
        dataset.createVariable("lat", "f8", ("lat",))[:] = [-40.0, 40.0]
        dataset.createVariable("lon", "f8", ("lon",))[:] = [-135.0, -45.0, 45.0, 135.0]
        dataset.createVariable("T", "f4", ("time", "lat", "lon"))[:] = np.zeros(
            (1, 2, 4)
        )

    with pytest.raises(GridError, match="網格"):
        build_cube(PRODUCT, tmp_path)
