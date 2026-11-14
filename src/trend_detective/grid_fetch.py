"""抓全球格點月資料：CMR 查每個月的檔案，經 Earthdata Cloud 的 OPeNDAP 只取一個變數。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：

    uv run python -m trend_detective.grid_fetch                       # 全部產品、全期
    uv run python -m trend_detective.grid_fetch --product merra2_t2m --since 2016-01

每個月一個請求：`<OPeNDAP 網址>.dap.nc4?dap4.ce=/<變數>;/lat;/lon;/time`，回傳只含該變數的
NetCDF-4（2026-11-14 實測：MERRA-2 T2M 每月約 0.5 MB、GLDAS 單一變數約 0.8 MB、各約 2–3 秒；
整檔分別是 27 MB 與約 25 MB）。GES DISC 的地端 OPeNDAP 已關閉，這裡用的是雲端的
`opendap.earthdata.nasa.gov`，網址來自 CMR 的 granule metadata。

**從最新的月份往回抓**，可以隨時中斷；已下載的月份不重抓。每次執行結束都用「從最新月份
往回連續不中斷」的那一段月份重建立方體與前端衍生檔，所以抓到一半也有可用的檔案，
實際涵蓋的起訖月記在 `meta.json` 的 `coverage`。產品清單在 `data/seed/grids.json`。
"""

import argparse
import json
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from trend_detective.env import read_secret
from trend_detective.grid import (
    Cube,
    GridError,
    Layers,
    annual_means,
    global_mean,
    monthly_climatology,
    read_month_file,
    regrid,
    slope_per_decade,
    write_cube,
    write_frontend,
)

CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
SEED_FILE = Path("data/seed/grids.json")
RAW_DIR = Path("data/raw/grid")
OUT_DIR = Path("data/grid")
RETRY_STATUS = {429, 500, 502, 503, 504}
PAGE_SIZE = 500


class GridFetchError(RuntimeError):
    """CMR 或 OPeNDAP 回傳非預期的內容。訊息不含憑證。"""


@dataclass(frozen=True)
class GridProduct:
    id: str
    name_zh: str
    name_en: str
    product: str
    product_version: str
    collection: str
    variable: str
    doi: str
    citation: str
    start: date
    lat_step: float
    lon_factor: int
    scale: float
    offset: float
    slope_scale: float


def parse_month(text: str) -> date:
    year, _, month = text.partition("-")
    return date(int(year), int(month), 1)


def load_products(seed_file: Path) -> list[GridProduct]:
    products = []
    for raw in json.loads(seed_file.read_text(encoding="utf-8")):
        frontend = raw.pop("frontend")
        products.append(
            GridProduct(**{**raw, **frontend, "start": parse_month(raw["start"])})
        )
    return products


def list_granules(http: httpx.Client, collection: str, start: date) -> dict[date, str]:
    """查 CMR，回傳 {月份（當月 1 號）: 雲端 OPeNDAP 網址}，只含 `start` 之後的月份。"""
    found: dict[date, str] = {}
    page = 1
    while True:
        response = http.get(
            CMR_URL,
            params={
                "collection_concept_id": collection,
                "temporal": f"{start:%Y-%m-%d}T00:00:00Z,",
                "sort_key": "start_date",
                "page_size": PAGE_SIZE,
                "page_num": page,
            },
        )
        if response.status_code >= 400:
            raise GridFetchError(
                f"CMR → HTTP {response.status_code}: {response.text[:200]}"
            )
        items = response.json().get("items", [])
        for item in items:
            umm = item["umm"]
            begin = umm["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
            month = date(int(begin[:4]), int(begin[5:7]), 1)
            urls = [
                link["URL"]
                for link in umm.get("RelatedUrls", [])
                if link.get("Subtype") == "OPENDAP DATA"
            ]
            if urls and month >= start:
                found[month] = urls[0]
        if len(items) < PAGE_SIZE:
            return found
        page += 1


def download_month(
    http: httpx.Client,
    token: str,
    opendap_url: str,
    variable: str,
    dest: Path,
    *,
    attempts: int = 6,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """下載單月、單一變數的 NetCDF 子集到 `dest`，回傳位元組數。

    429 與 5xx、連線錯誤會退避重試（2、4、8… 秒，或照 `Retry-After`）；其他狀態直接報錯。
    """
    url = f"{opendap_url}.dap.nc4?dap4.ce=/{variable};/lat;/lon;/time"
    problem = ""
    wait = 0.0
    for attempt in range(attempts):
        if attempt:
            sleep(wait)
        wait = float(2 ** (attempt + 1))
        try:
            response = http.get(url, headers={"Authorization": f"Bearer {token}"})
        except httpx.TransportError as err:
            problem = type(err).__name__
            continue
        if response.status_code in RETRY_STATUS:
            problem = f"HTTP {response.status_code}"
            retry_after = response.headers.get("Retry-After", "")
            if retry_after.isdigit():
                wait = max(wait, float(retry_after))
            continue
        if response.status_code != 200:
            body = " ".join(response.text.replace(token, "***").split())[:200]
            raise GridFetchError(
                f"OPeNDAP {dest.name} → HTTP {response.status_code}: {body}"
            )
        if not response.content.startswith(b"\x89HDF"):
            raise GridFetchError(f"OPeNDAP {dest.name} 的回應不是 NetCDF-4 檔")
        dest.parent.mkdir(parents=True, exist_ok=True)
        temp = dest.with_suffix(".part")
        temp.write_bytes(response.content)
        temp.replace(dest)
        return len(response.content)
    raise GridFetchError(f"OPeNDAP {dest.name} 重試 {attempts} 次仍失敗：{problem}")


def month_path(month_dir: Path, month: date) -> Path:
    return month_dir / f"{month:%Y%m}.nc4"


def fetch_months(
    http: httpx.Client,
    token: str,
    product: GridProduct,
    granules: dict[date, str],
    month_dir: Path,
    *,
    workers: int = 4,
) -> tuple[int, int, list[str]]:
    """由新到舊下載還沒有的月份。回傳 (新下載的月數, 位元組數, 失敗訊息)。"""
    todo = [
        month
        for month in sorted(granules, reverse=True)
        if not month_path(month_dir, month).exists()
    ]

    def one(month: date) -> int | str:
        try:
            return download_month(
                http,
                token,
                granules[month],
                product.variable,
                month_path(month_dir, month),
            )
        except GridFetchError as err:
            return str(err)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(one, todo))
    sizes = [result for result in results if isinstance(result, int)]
    return len(sizes), sum(sizes), [r for r in results if isinstance(r, str)]


def contiguous_months(month_dir: Path) -> list[date]:
    """已下載的月份裡，從最新月份往回連續不中斷的那一段（遞增排序）。"""
    have = sorted(
        date(int(path.stem[:4]), int(path.stem[4:6]), 1)
        for path in month_dir.glob("[0-9][0-9][0-9][0-9][0-9][0-9].nc4")
    )
    run: list[date] = []
    for month in reversed(have):
        if (
            run
            and (run[-1].year * 12 + run[-1].month) - (month.year * 12 + month.month)
            != 1
        ):
            break
        run.append(month)
    return run[::-1]


def build_cube(product: GridProduct, month_dir: Path) -> Cube:
    """把逐月檔疊成立方體；各月的網格必須相同。"""
    months = contiguous_months(month_dir)
    if not months:
        raise GridError(f"{month_dir} 裡沒有已下載的月份")
    lat0, lon0, first, unit = read_month_file(
        month_path(month_dir, months[0]), product.variable
    )
    values = np.empty((len(months), *first.shape), dtype=np.float32)
    values[0] = first
    for i, month in enumerate(months[1:], start=1):
        lat, lon, layer, _ = read_month_file(
            month_path(month_dir, month), product.variable
        )
        if not (np.array_equal(lat, lat0) and np.array_equal(lon, lon0)):
            raise GridError(f"{month:%Y-%m} 的網格與 {months[0]:%Y-%m} 不同")
        values[i] = layer
    attrs = {
        "title": f"{product.name_en}: global monthly grid",
        "product": product.product,
        "doi": product.doi,
        "citation": product.citation,
        "access": "NASA Earthdata Cloud OPeNDAP (opendap.earthdata.nasa.gov), "
        f"collection {product.collection}",
        "first_month": f"{months[0]:%Y-%m}",
        "last_month": f"{months[-1]:%Y-%m}",
    }
    return Cube(months, lat0, lon0, values, unit, attrs)


def write_derived(product: GridProduct, cube: Cube, directory: Path) -> list[Path]:
    """由立方體產生前端衍生檔：逐年平均、月氣候值、探索性的線性斜率。"""
    coarse, grid = regrid(
        cube.values,
        cube.lat,
        cube.lon,
        lat_step=product.lat_step,
        lon_factor=product.lon_factor,
    )
    years, annual = annual_means(cube.months, coarse)
    if not years:
        raise GridError("沒有 12 個月齊全的年份，無法產生逐年平均")
    _, climatology = monthly_climatology(cube.months, coarse)
    period = f"{years[0]}–{years[-1]}"
    layer_sets = [
        Layers(
            name="annual_mean",
            description=f"逐年平均（{period}，各月依天數加權；只含 12 個月齊全的年份）",
            unit=cube.unit,
            labels=[str(year) for year in years],
            values=annual,
            scale=product.scale,
            offset=product.offset,
        ),
        Layers(
            name="monthly_climatology",
            description=f"多年月氣候值（{period} 各年同一個月的平均），12 層為 1 至 12 月",
            unit=cube.unit,
            labels=[f"{month:02d}" for month in range(1, 13)],
            values=climatology,
            scale=product.scale,
            offset=product.offset,
        ),
    ]
    if len(years) >= 2:
        layer_sets.append(
            Layers(
                name="exploratory_linear_slope_per_decade",
                description=(
                    f"探索性：逐年平均（{period}）對年份的最小平方法斜率，每十年的變化量。"
                    "未做顯著性檢定與自相關修正，不是趨勢結論。"
                ),
                unit=f"{cube.unit} per decade",
                labels=[period],
                values=slope_per_decade(years, annual)[None],
                scale=product.slope_scale,
            )
        )
    info: dict[str, Any] = {
        "id": product.id,
        "name_zh": product.name_zh,
        "name_en": product.name_en,
        "unit": cube.unit,
        "product": product.product,
        "product_version": product.product_version,
        "source_variable": product.variable,
        "doi": product.doi,
        "citation": product.citation,
        "access": cube.attrs.get("access", ""),
        "coverage": {
            "first_month": f"{cube.months[0]:%Y-%m}",
            "last_month": f"{cube.months[-1]:%Y-%m}",
            "n_months": len(cube.months),
            "complete_years": [years[0], years[-1]],
            "note": "逐年平均、月氣候值與斜率只用 complete_years 內的年份；"
            "資料由最新月份往回補，first_month 之前尚未抓取或不在本產品的收錄範圍",
        },
        "native_grid": {
            "n_lat": len(cube.lat),
            "n_lon": len(cube.lon),
            "lat_first_centre": float(cube.lat[0]),
            "lat_step": float(cube.lat[1] - cube.lat[0]),
            "lon_first_centre": float(cube.lon[0]),
            "lon_step": float(cube.lon[1] - cube.lon[0]),
        },
        "regrid": "面積加權平均；目標格內有值的面積不到一半時為缺值",
    }
    return write_frontend(directory, info, grid, layer_sets)


def run_product(
    product: GridProduct,
    *,
    http: httpx.Client,
    token: str,
    raw_dir: Path,
    out_dir: Path,
    since: date | None,
    workers: int,
) -> bool:
    """抓一個產品並重建立方體與衍生檔；有月份下載失敗時回傳 False。"""
    started = time.monotonic()
    month_dir = raw_dir / product.id / "months"
    start = max(product.start, since) if since else product.start
    granules = list_granules(http, product.collection, start)
    count, size, failures = fetch_months(
        http, token, product, granules, month_dir, workers=workers
    )
    print(
        f"{product.id}：CMR 有 {len(granules)} 個月（{start:%Y-%m} 起），"
        f"新下載 {count} 個月、{size / 1e6:.1f} MB，失敗 {len(failures)}，"
        f"耗時 {time.monotonic() - started:.0f} 秒"
    )
    for failure in failures:
        print(f"  失敗：{failure}")
    cube = build_cube(product, month_dir)
    cube_path = raw_dir / product.id / f"{product.id}.nc"
    write_cube(cube_path, cube, product.variable)
    written = write_derived(product, cube, out_dir / product.id)
    mean = global_mean(cube.values[-1], cube.lat)
    print(
        f"  立方體 {cube_path}：{cube.attrs['first_month']} 至 {cube.attrs['last_month']}，"
        f"{cube.values.shape}，{cube_path.stat().st_size / 1e6:.1f} MB；"
        f"最新月份的面積加權平均 {float(mean):.3f} {cube.unit}"
    )
    for path in written:
        print(f"  衍生檔 {path}：{path.stat().st_size / 1e6:.2f} MB")
    return not failures


def main() -> None:
    parser = argparse.ArgumentParser(description="抓全球格點月資料並產生衍生檔")
    parser.add_argument("--product", action="append", help="只跑這個 id（可重複）")
    parser.add_argument("--since", type=parse_month, help="只抓這個月份之後，YYYY-MM")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed-file", type=Path, default=SEED_FILE)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args()
    products = [
        product
        for product in load_products(args.seed_file)
        if not args.product or product.id in args.product
    ]
    if not products:
        raise SystemExit(f"{args.seed_file} 裡沒有符合的產品")
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    ok = True
    with httpx.Client(timeout=180, follow_redirects=True) as http:
        for product in products:
            ok &= run_product(
                product,
                http=http,
                token=token,
                raw_dir=args.raw_dir,
                out_dir=args.out_dir,
                since=args.since,
                workers=args.workers,
            )
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
