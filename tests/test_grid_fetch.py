"""全球格點的取得：CMR 與 OPeNDAP 的 HTTP 邊界、由新到舊下載、立方體與衍生檔的組裝。"""

import json
from datetime import date
from pathlib import Path

import httpx
import netCDF4
import numpy as np
import pytest

from trend_detective.grid import GridError, read_cube, read_frontend
from trend_detective.grid_fetch import (
    GridFetchError,
    GridProduct,
    aggregate_days,
    build_cube,
    constraint,
    contiguous_months,
    day_path,
    download_month,
    fetch_months,
    list_granules,
    load_products,
    month_path,
    plan_batches,
    run,
    select_products,
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
        size = download_month(
            http, SECRET, OPENDAP + "a.nc4", "/T2M;/lat;/lon;/time", dest
        )

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

    built = build_cube(PRODUCT, month_dir, tmp_path / "raw" / "demo.nc")
    written = write_derived(PRODUCT, built, tmp_path / "out")

    cube = read_cube(tmp_path / "raw" / "demo.nc")
    assert cube.values.shape == (25, 2, 4)
    assert cube.unit == "K"
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
        build_cube(PRODUCT, tmp_path, tmp_path / "cube" / "demo.nc")

    assert not (tmp_path / "cube" / "demo.nc").exists()
    assert not (tmp_path / "cube" / "demo.part").exists()


def test_403_is_retried_a_few_times_because_it_is_sometimes_transient(tmp_path: Path):
    replies = [
        httpx.Response(403, text="<html>Earthdata Login</html>"),
        httpx.Response(403, text="<html>Earthdata Login</html>"),
        httpx.Response(200, content=NC_BYTES),
    ]
    waits: list[float] = []
    reasons: list[str] = []
    dest = tmp_path / "200101.nc4"

    with httpx.Client(
        transport=httpx.MockTransport(lambda request: replies.pop(0))
    ) as http:
        download_month(
            http,
            SECRET,
            OPENDAP + "a.nc4",
            "/T",
            dest,
            sleep=waits.append,
            on_retry=reasons.append,
        )

    assert dest.read_bytes() == NC_BYTES
    assert waits == [2.0, 4.0]
    assert reasons == ["HTTP 403", "HTTP 403"]


def test_a_403_that_does_not_go_away_fails_after_three_retries(tmp_path: Path):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(403, text=f"denied {SECRET}")

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as http,
        pytest.raises(GridFetchError) as raised,
    ):
        download_month(
            http,
            SECRET,
            OPENDAP + "a.nc4",
            "/T",
            tmp_path / "x.nc4",
            attempts=10,
            sleep=lambda seconds: None,
        )

    assert len(requests) == 4
    assert "403" in str(raised.value) and SECRET not in str(raised.value)
    assert list(tmp_path.iterdir()) == []


def extended(ident: str, variable: str, collection: str = "C1-X") -> dict:
    """由清單產生器寫出的那種 seed 條目：有座標路徑、沒有 frontend。"""
    return {
        "id": ident,
        "name_zh": ident,
        "name_en": ident,
        "needs_translation": True,
        "long_name": "",
        "unit": "kg m-2",
        "product": f"DEMO{collection[1]}.1",
        "product_version": "1",
        "collection": collection,
        "variable": variable,
        "lat": "/G/lat",
        "lon": "/G/lon",
        "doi": "10.1234/DEMO",
        "citation": "Demo citation",
        "start": "2001-01",
    }


def load_extended(tmp_path: Path, *entries: dict) -> list[GridProduct]:
    seed = tmp_path / "grids.extended.json"
    seed.write_text(json.dumps(list(entries)), encoding="utf-8")
    return load_products(seed)


def test_generated_seed_entries_keep_only_the_cube_and_name_their_coordinates(
    tmp_path: Path,
):
    (product,) = load_extended(tmp_path, extended("demo_a", "/G/Data/A"))

    assert not product.derive
    assert product.needs_translation
    assert (product.path, product.name) == ("/G/Data/A", "A")
    assert constraint([product]) == "/G/Data/A;/G/lat;/G/lon"


def test_products_are_selected_by_id_with_wildcards(tmp_path: Path):
    products = load_extended(
        tmp_path,
        extended("gldas_a", "/A"),
        extended("gldas_b", "/B"),
        extended("airs_c", "/C"),
    )

    chosen = select_products(products, ["gldas_*", "airs_c"], ["*_b"])

    assert [product.id for product in chosen] == ["gldas_a", "airs_c"]
    assert select_products(products, None) == products


def test_one_request_carries_several_variables_and_their_coordinates_once(
    tmp_path: Path,
):
    products = load_extended(
        tmp_path,
        extended("a", "/G/A"),
        extended("b", "/G/B"),
        extended("c", "/G/C"),
        extended("z", "/G/Z", collection="C2-X"),
    )

    batches = plan_batches(products, tmp_path, batch_size=2)

    assert [[p.id for p in batch.products] for batch in batches] == [
        ["a", "b"],
        ["c"],
        ["z"],
    ]
    assert constraint(batches[0].products) == "/G/A;/G/B;/G/lat;/G/lon"
    # 變數清單不同就是不同的目錄，才不會把缺變數的舊檔當成已下載
    assert len({batch.month_dir for batch in batches}) == 3
    assert all(tmp_path / "_batch" in batch.month_dir.parents for batch in batches)


def test_a_batch_is_split_before_the_request_url_gets_too_long(tmp_path: Path):
    products = load_extended(
        tmp_path, *[extended(f"v{i}", "/G/" + "x" * 500 + str(i)) for i in range(12)]
    )

    batches = plan_batches(products, tmp_path, batch_size=100)

    assert sum(len(batch.products) for batch in batches) == 12
    assert len(batches) > 1
    assert all(len(constraint(batch.products)) <= 3000 for batch in batches)


def test_without_batching_each_variable_keeps_its_own_month_directory(tmp_path: Path):
    products = load_extended(tmp_path, extended("a", "/G/A"), extended("b", "/G/B"))

    batches = plan_batches(products, tmp_path)

    assert [batch.month_dir for batch in batches] == [
        tmp_path / "a" / "months",
        tmp_path / "b" / "months",
    ]


def month_bytes(tmp_path: Path, variables: dict[str, float]) -> bytes:
    """一個月的多變數 NetCDF：群組 G 裡 2 × 4 的網格，每個變數整張同一個值。"""
    path = tmp_path / "reply.nc4"
    with netCDF4.Dataset(path, "w") as dataset:
        group = dataset.createGroup("G")
        group.createDimension("lat", 2)
        group.createDimension("lon", 4)
        group.createVariable("lat", "f8", ("lat",))[:] = [-45.0, 45.0]
        group.createVariable("lon", "f8", ("lon",))[:] = [-135.0, -45.0, 45.0, 135.0]
        for name, value in variables.items():
            group.createVariable(name, "f4", ("lat", "lon"))[:] = np.full((2, 4), value)
    return path.read_bytes()


class FakeEarthdata:
    """CMR 加 OPeNDAP：C1-X 有 A、B 兩個變數，C2-X 有 Z；`broken` 裡的 collection 一律 404。"""

    def __init__(self, tmp_path: Path, months: list[str], broken: set[str]):
        self.tmp_path = tmp_path
        self.months = months
        self.broken = broken
        self.downloads: list[str] = []
        # 回應先做好：HDF5 不是 thread-safe，不能在下載執行緒裡現做
        self.replies = {
            "/G/A;/G/B;/G/lat;/G/lon": month_bytes(tmp_path, {"A": 1.0, "B": 2.0}),
            "/G/Z;/G/lat;/G/lon": month_bytes(tmp_path, {"Z": 26.0}),
        }

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "cmr.earthdata.nasa.gov":
            collection = request.url.params["collection_concept_id"]
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "umm": {
                                "TemporalExtent": {
                                    "RangeDateTime": {
                                        "BeginningDateTime": f"{m}-01T00:00:00.000Z"
                                    }
                                },
                                "RelatedUrls": [
                                    {
                                        "Subtype": "OPENDAP DATA",
                                        "URL": f"https://opendap.example/{collection}/{m}",
                                    }
                                ],
                            }
                        }
                        for m in self.months
                    ]
                },
            )
        _, collection, month = request.url.path.split("/")
        if collection in self.broken:
            return httpx.Response(404, text="no such granule")
        self.downloads.append(f"{collection}/{month}")
        return httpx.Response(200, content=self.replies[request.url.params["dap4.ce"]])


def run_fake(tmp_path: Path, server: FakeEarthdata, lines: list[str]) -> bool:
    products = load_extended(
        tmp_path,
        extended("demo_a", "/G/A"),
        extended("demo_b", "/G/B"),
        extended("other_z", "/G/Z", collection="C2-X"),
    )
    with httpx.Client(transport=httpx.MockTransport(server)) as http:
        return run(
            products,
            http=http,
            token=SECRET,
            raw_dir=tmp_path / "raw",
            out_dir=tmp_path / "out",
            batch_size=10,
            parallel=2,
            sleep=lambda seconds: None,
            report=lines.append,
        )


def test_a_batch_run_builds_one_cube_per_variable_from_shared_downloads(
    tmp_path: Path,
):
    server = FakeEarthdata(tmp_path, ["2001-01", "2001-02"], broken=set())
    lines: list[str] = []

    assert run_fake(tmp_path, server, lines)

    # A 與 B 同一個請求：兩個 collection × 兩個月 = 4 次下載
    assert (
        sorted(server.downloads)
        == [
            "C1-X.dap.nc4/2001-01",
            "C1-X.dap.nc4/2001-02",
            "C2-X.dap.nc4/2001-01",
            "C2-X.dap.nc4/2001-02",
        ]
        or len(server.downloads) == 4
    )
    for ident, value in (("demo_a", 1.0), ("demo_b", 2.0), ("other_z", 26.0)):
        cube = read_cube(tmp_path / "raw" / ident / f"{ident}.nc")
        assert cube.months == [date(2001, 1, 1), date(2001, 2, 1)]
        assert cube.values.shape == (2, 2, 4)
        assert (cube.values == value).all()
        assert cube.unit == "kg m-2"
    assert not (tmp_path / "out").exists()
    assert SECRET not in "\n".join(lines)


def test_rerunning_a_batch_downloads_only_what_is_new_and_extends_the_cubes(
    tmp_path: Path,
):
    first = FakeEarthdata(tmp_path, ["2001-01", "2001-02"], broken=set())
    run_fake(tmp_path, first, [])
    untouched = FakeEarthdata(tmp_path, ["2001-01", "2001-02"], broken=set())
    lines: list[str] = []

    assert run_fake(tmp_path, untouched, lines)

    assert untouched.downloads == []
    assert sum("未重建" in line for line in lines) == 3

    grown = FakeEarthdata(tmp_path, ["2001-01", "2001-02", "2001-03"], broken=set())
    assert run_fake(tmp_path, grown, [])

    assert len(grown.downloads) == 2
    cube = read_cube(tmp_path / "raw" / "demo_b" / "demo_b.nc")
    assert cube.months[-1] == date(2001, 3, 1) and len(cube.months) == 3


def test_a_failing_batch_does_not_stop_the_other_batches(tmp_path: Path):
    server = FakeEarthdata(tmp_path, ["2001-01", "2001-02"], broken={"C1-X"})
    lines: list[str] = []

    assert not run_fake(tmp_path, server, lines)

    assert read_cube(tmp_path / "raw" / "other_z" / "other_z.nc").values.shape == (
        2,
        2,
        4,
    )
    assert not (tmp_path / "raw" / "demo_a" / "demo_a.nc").exists()
    report = "\n".join(lines)
    assert "404" in report and "demo_a：立方體失敗" in report
    assert SECRET not in report


def test_corner_referenced_coordinates_become_cell_centres_in_the_cube(tmp_path: Path):
    # AIRS 經 OPeNDAP 的座標是格子的北緣、西緣，緯度由北到南；1° 的格子中心在 .5
    month_dir = tmp_path / "months"
    month_dir.mkdir()
    with netCDF4.Dataset(month_path(month_dir, date(2001, 1, 1)), "w") as dataset:
        dataset.createDimension("YDim", 3)
        dataset.createDimension("XDim", 2)
        dataset.createVariable("YDim", "f8", ("YDim",))[:] = [26.0, 25.0, 24.0]
        dataset.createVariable("XDim", "f8", ("XDim",))[:] = [121.0, 122.0]
        dataset.createVariable("T", "f4", ("YDim", "XDim"))[:] = [
            [1.0, 2.0],
            [3.0, 4.0],
            [5.0, 6.0],
        ]
    (product,) = load_extended(
        tmp_path,
        {
            **extended("demo_t", "/T"),
            "lat": "/YDim",
            "lon": "/XDim",
            "cell_reference": "north_west_corner",
        },
    )

    build_cube(product, month_dir, tmp_path / "demo_t.nc")

    cube = read_cube(tmp_path / "demo_t.nc")
    assert cube.lat.tolist() == [23.5, 24.5, 25.5]
    assert cube.lon.tolist() == [121.5, 122.5]
    # 北緣 26 的那一列（值 1、2）是中心 25.5 的格子
    assert cube.values[0, 2].tolist() == [1.0, 2.0]
    assert cube.unit == "kg m-2"


def test_daily_granules_are_listed_by_their_data_date():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "items": [
                    granule("2004-10-01T00:00:00.000Z", "d1.he5"),
                    granule("2004-10-02T00:00:00.000Z", "d2.he5"),
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        found = list_granules(http, "C1-X", date(2004, 10, 1), daily=True)

    assert found == {
        date(2004, 10, 1): OPENDAP + "d1.he5",
        date(2004, 10, 2): OPENDAP + "d2.he5",
    }


def daily_product(tmp_path: Path) -> GridProduct:
    (product,) = load_extended(
        tmp_path,
        {
            **extended("demo_o3", "/G/O3"),
            "lat": "/G/YDim",
            "lon": "/G/XDim",
            "temporal": "day",
            "start": "2004-10",
        },
    )
    return product


def write_day(day_dir: Path, day: date, values: list[list[float]]) -> None:
    """一天的檔：群組 G 裡 2 × 2 的網格，缺值是 -1e30。"""
    day_dir.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(day_path(day_dir, day), "w") as dataset:
        group = dataset.createGroup("G")
        group.createDimension("YDim", 2)
        group.createDimension("XDim", 2)
        group.createVariable("YDim", "f4", ("YDim",))[:] = [-45.0, 45.0]
        group.createVariable("XDim", "f4", ("XDim",))[:] = [-90.0, 90.0]
        var = group.createVariable("O3", "f4", ("YDim", "XDim"), fill_value=-1e30)
        var.Units = "DU"
        var.set_auto_mask(False)
        var[:] = np.array(values, dtype=np.float32)


def test_daily_files_become_a_monthly_mean_of_the_days_that_have_data(tmp_path: Path):
    product = daily_product(tmp_path)
    day_dir, month_dir = tmp_path / "days", tmp_path / "months"
    days = [date(2004, 10, 1), date(2004, 10, 2), date(2004, 10, 4)]
    write_day(day_dir, days[0], [[300.0, 200.0], [-1e30, -1e30]])
    write_day(day_dir, days[1], [[310.0, -1e30], [-1e30, 250.0]])
    write_day(day_dir, days[2], [[320.0, 240.0], [-1e30, 270.0]])

    assert aggregate_days(product, day_dir, month_dir, days) == 1

    with netCDF4.Dataset(month_path(month_dir, date(2004, 10, 1))) as dataset:
        mean = dataset["O3"][:].filled(np.nan)
        n_days = dataset["n_days"][:]
        assert dataset["O3"].units == "DU"
    # 西南格三天都有值；東南格兩天；西北格一天都沒有；東北格兩天
    np.testing.assert_allclose(mean[0], [310.0, 220.0])
    assert np.isnan(mean[1, 0]) and mean[1, 1] == 260.0
    assert n_days.tolist() == [[3, 2], [0, 2]]
    # 沒有新的日子就不重算
    assert aggregate_days(product, day_dir, month_dir, days) == 0


def test_a_month_waits_until_every_listed_day_is_downloaded(tmp_path: Path):
    product = daily_product(tmp_path)
    day_dir, month_dir = tmp_path / "days", tmp_path / "months"
    october = [date(2004, 10, 30), date(2004, 10, 31)]
    november = [date(2004, 11, 1), date(2004, 11, 2)]
    for day in (october[1], *november):
        write_day(day_dir, day, [[1.0, 1.0], [1.0, 1.0]])

    assert aggregate_days(product, day_dir, month_dir, october + november) == 1

    assert month_path(month_dir, date(2004, 11, 1)).exists()
    assert not month_path(month_dir, date(2004, 10, 1)).exists()

    # 最新的月份多了一天：重算那個月
    write_day(day_dir, date(2004, 11, 3), [[4.0, 4.0], [4.0, 4.0]])
    grown = [*october, *november, date(2004, 11, 3)]
    assert aggregate_days(product, day_dir, month_dir, grown) == 1
    with netCDF4.Dataset(month_path(month_dir, date(2004, 11, 1))) as dataset:
        assert dataset["O3"][:].tolist() == [[2.0, 2.0], [2.0, 2.0]]


def test_a_daily_product_run_ends_with_a_monthly_cube(tmp_path: Path):
    product = daily_product(tmp_path)
    days = ["2004-10-30", "2004-10-31", "2004-11-01"]
    write_day(tmp_path / "make", date(2004, 10, 30), [[300.0, 300.0], [300.0, 300.0]])
    reply = day_path(tmp_path / "make", date(2004, 10, 30)).read_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cmr.earthdata.nasa.gov":
            return httpx.Response(
                200,
                json={
                    "items": [granule(f"{d}T00:00:00.000Z", f"{d}.he5") for d in days]
                },
            )
        assert request.url.params["dap4.ce"] == "/G/O3;/G/YDim;/G/XDim"
        return httpx.Response(200, content=reply)

    lines: list[str] = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        ok = run(
            [product],
            http=http,
            token=SECRET,
            raw_dir=tmp_path / "raw",
            out_dir=tmp_path / "out",
            report=lines.append,
        )

    assert ok
    assert len(list((tmp_path / "raw" / "demo_o3" / "days").glob("*.nc4"))) == 3
    cube = read_cube(tmp_path / "raw" / "demo_o3" / "demo_o3.nc")
    assert cube.months == [date(2004, 10, 1), date(2004, 11, 1)]
    assert cube.unit == "DU"
    assert (cube.values == 300.0).all()
