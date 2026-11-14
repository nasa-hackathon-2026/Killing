"""抓全球格點月資料：CMR 查每個月的檔案，經 Earthdata Cloud 的 OPeNDAP 只取需要的變數。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：

    uv run python -m trend_detective.grid_fetch                       # grids.json 的產品、全期
    uv run python -m trend_detective.grid_fetch --product merra2_t2m --since 2016-01
    uv run python -m trend_detective.grid_fetch --seed-file data/seed/grids.extended.json \
        --product 'gldas_*' --batch-size 40 --parallel 3              # 一個產品的全部變數

每個月一個請求：`<OPeNDAP 網址>.dap.nc4?dap4.ce=<變數>;<緯度>;<經度>`，回傳只含這些變數的
NetCDF-4（2026-11-14 實測：MERRA-2 T2M 每月約 0.5 MB、GLDAS 單一變數約 0.8 MB、各約 2–3 秒；
GLDAS 一次要全部 36 個變數是 24.5 MB、約 3 秒，所以抓「一個產品的全部變數」時用
`--batch-size` 把同一個產品的變數併在同一個請求裡）。GES DISC 的地端 OPeNDAP 已關閉，
這裡用的是雲端的 `opendap.earthdata.nasa.gov`，網址來自 CMR 的 granule metadata。

**從最新的月份往回抓**，可以隨時中斷；已下載的月份不重抓。每批下載結束就用「從最新月份
往回連續不中斷」的那一段月份建立方體（有 `frontend` 設定的產品再產生前端衍生檔），
所以抓到一半也有可用的檔案。批次之間互不影響：一批失敗，其他批照常完成。
產品清單在 `data/seed/grids.json`（手寫的兩筆）與 `data/seed/grids.extended.json`
（由 `trend_detective.grid_catalog` 從各產品的實際變數清單產生）。
"""

import argparse
import hashlib
import json
import multiprocessing
import threading
import time
from collections import Counter
from collections.abc import Callable, Sequence
from concurrent.futures import (
    Future,
    ProcessPoolExecutor,
    ThreadPoolExecutor,
    as_completed,
)
from dataclasses import dataclass, field
from datetime import date
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

import httpx
import netCDF4
import numpy as np

from trend_detective.env import read_secret
from trend_detective.grid import (
    META_FILE,
    Floats,
    Grid,
    GridError,
    Layers,
    annual_means,
    global_mean,
    monthly_climatology,
    read_cube_attrs,
    read_month_file,
    regrid,
    slope_per_decade,
    write_cube_layers,
    write_frontend,
)

CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
SEED_FILE = Path("data/seed/grids.json")
RAW_DIR = Path("data/raw/grid")
OUT_DIR = Path("data/grid")
BATCH_DIR = "_batch"
CELL_REFERENCES = {"centre", "north_west_corner"}
RETRY_STATUS = {429, 500, 502, 503, 504}
# 403 偶爾是暫時的（回傳 Earthdata 登入頁，重跑就好），但 token 失效時也是 403，
# 所以只多試幾次，不像 429／5xx 那樣試到 `attempts` 用完。
FORBIDDEN_RETRIES = 3
PAGE_SIZE = 500
# 一個請求最多併幾個變數；網址太長時 CloudFront 回 414（實測 210 個 AIRS 變數會）。
MAX_CONSTRAINT_CHARS = 3000


class GridFetchError(RuntimeError):
    """CMR 或 OPeNDAP 回傳非預期的內容。訊息不含憑證。"""


@dataclass(frozen=True)
class GridProduct:
    """一個格點變數。`derive` 為 False 時只留立方體，不產生前端衍生檔。

    `variable`、`lat`、`lon` 是檔案裡的路徑（可含群組，例如 `/Grid/precipitation`）；
    `unit` 只在檔案本身沒有單位屬性時使用（AIRS 的 HDF4 檔沒有）。
    `cell_reference` 說明檔案的座標值指的是格子的哪裡：`centre`（一般情況），或
    `north_west_corner`——OPeNDAP 替 AIRS 的 HDF-EOS2 檔產生的 `YDim`／`XDim` 是格子的
    北緣與西緣（2026-11-14 實測：和檔案自己的 `Latitude`／`Longitude` 欄位差半格），
    建立方體時會換算成格子中心。
    `temporal` 是產品的時間解析度：`month`，或 `day`（OMI；每天一個檔，下載後先算成
    月平均再建立方體，見 `aggregate_days`）。
    """

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
    lat_step: float = 1.0
    lon_factor: int = 1
    scale: float = 0.01
    offset: float = 0.0
    slope_scale: float = 0.001
    derive: bool = True
    lat: str = "/lat"
    lon: str = "/lon"
    with_time: bool = True
    unit: str = ""
    long_name: str = ""
    needs_translation: bool = False
    cell_reference: str = "centre"
    temporal: str = "month"

    @property
    def path(self) -> str:
        return "/" + self.variable.lstrip("/")

    @property
    def name(self) -> str:
        """立方體裡的變數名：路徑的最後一段。"""
        return self.variable.rsplit("/", 1)[-1]


def parse_month(text: str) -> date:
    year, _, month = text.partition("-")
    return date(int(year), int(month), 1)


def load_products(seed_file: Path) -> list[GridProduct]:
    """讀 seed。沒有 `frontend` 的條目只留立方體；有 `lat`／`lon` 的條目不另外要 `/time`。"""
    products = []
    for raw in json.loads(seed_file.read_text(encoding="utf-8")):
        frontend = raw.pop("frontend", None)
        products.append(
            GridProduct(
                **{
                    **raw,
                    **(frontend or {}),
                    "start": parse_month(raw["start"]),
                    "derive": frontend is not None,
                    "with_time": "lat" not in raw,
                }
            )
        )
    return products


def select_products(
    products: Sequence[GridProduct],
    include: Sequence[str] | None,
    exclude: Sequence[str] | None = None,
) -> list[GridProduct]:
    """依 id 篩選；`include`、`exclude` 都可以用萬用字元（`gldas_*`）。"""
    return [
        product
        for product in products
        if (not include or any(fnmatchcase(product.id, p) for p in include))
        and not any(fnmatchcase(product.id, p) for p in exclude or [])
    ]


def constraint(products: Sequence[GridProduct]) -> str:
    """`dap4.ce` 的內容：這些產品的變數，加上它們的緯度、經度（與時間）座標，不重複。"""
    paths = [product.path for product in products]
    for product in products:
        paths += [product.lat, product.lon, *(["/time"] if product.with_time else [])]
    return ";".join(dict.fromkeys(paths))


@dataclass(frozen=True)
class Batch:
    """同一個請求裡一起抓的產品，與它們逐月檔案的目錄。"""

    products: tuple[GridProduct, ...]
    month_dir: Path

    @property
    def label(self) -> str:
        if len(self.products) == 1:
            return self.products[0].id
        return f"{self.products[0].product}（{len(self.products)} 個變數）"


def plan_batches(
    products: Sequence[GridProduct], raw_dir: Path, *, batch_size: int = 1
) -> list[Batch]:
    """把產品分成批次。

    `batch_size` 為 1 時一個變數一批，逐月檔在 `<raw_dir>/<id>/months/`。大於 1 時，
    同一個 collection、同一組座標的變數每 `batch_size` 個併成一批（網址過長時再切小），
    逐月檔在 `<raw_dir>/_batch/<產品>/<變數清單的雜湊>/`，旁邊的 `variables.json`
    記下這一批有哪些變數。變數清單變了就是另一個目錄，不會誤用缺變數的舊檔。
    """
    if batch_size <= 1:
        return [
            Batch((p,), raw_dir / p.id / ("days" if p.temporal == "day" else "months"))
            for p in products
        ]
    groups: dict[tuple[str, str, str, bool, str], list[GridProduct]] = {}
    for product in products:
        key = (
            product.collection,
            product.lat,
            product.lon,
            product.with_time,
            product.temporal,
        )
        groups.setdefault(key, []).append(product)
    batches = []
    for members in groups.values():
        chunk: list[GridProduct] = []
        for product in [*members, None]:
            full = product is None or (
                chunk
                and (
                    len(chunk) >= batch_size
                    or len(constraint([*chunk, product])) > MAX_CONSTRAINT_CHARS
                )
            )
            if full and chunk:
                paths = sorted(p.path for p in chunk)
                digest = hashlib.sha1("\n".join(paths).encode()).hexdigest()[:10]
                batches.append(
                    Batch(
                        tuple(chunk),
                        raw_dir / BATCH_DIR / chunk[0].product / digest,
                    )
                )
                chunk = []
            if product is not None:
                chunk.append(product)
    return batches


class RetryLog:
    """各種重試原因的次數（跨執行緒）；用來看有沒有被限流。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: Counter[str] = Counter()

    def note(self, reason: str) -> None:
        with self._lock:
            self._counts[reason] += 1

    def summary(self) -> str:
        with self._lock:
            items = sorted(self._counts.items())
        return "、".join(f"{reason} × {count}" for reason, count in items) or "無"


def list_granules(
    http: httpx.Client, collection: str, start: date, *, daily: bool = False
) -> dict[date, str]:
    """查 CMR，回傳 {月份（當月 1 號）: 雲端 OPeNDAP 網址}，只含 `start` 之後的月份。

    `daily` 為 True 時（日資料產品）鍵是每個檔案的資料日期。
    """
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
            month = date(
                int(begin[:4]), int(begin[5:7]), int(begin[8:10]) if daily else 1
            )
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
    constraint: str,
    dest: Path,
    *,
    attempts: int = 6,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[str], None] | None = None,
) -> int:
    """下載單月的 NetCDF 子集（`constraint` 是 `dap4.ce` 的內容）到 `dest`，回傳位元組數。

    429 與 5xx、連線錯誤會退避重試（2、4、8… 秒，或照 `Retry-After`）；403 最多重試
    `FORBIDDEN_RETRIES` 次；其他狀態直接報錯。每次重試的原因會交給 `on_retry`。
    """
    url = f"{opendap_url}.dap.nc4?dap4.ce={constraint}"
    problem = ""
    wait = 0.0
    forbidden = 0
    for attempt in range(attempts):
        if attempt:
            if on_retry:
                on_retry(problem)
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
        if response.status_code == 403 and forbidden < FORBIDDEN_RETRIES:
            forbidden += 1
            problem = "HTTP 403"
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


def day_path(day_dir: Path, day: date) -> Path:
    return day_dir / f"{day:%Y%m%d}.nc4"


def fetch_months(
    http: httpx.Client,
    token: str,
    products: GridProduct | Sequence[GridProduct],
    granules: dict[date, str],
    month_dir: Path,
    *,
    workers: int = 4,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[str], None] | None = None,
) -> tuple[int, int, list[str]]:
    """由新到舊下載還沒有的月份（日資料產品是每一天）。

    回傳 (新下載的檔案數, 位元組數, 失敗訊息)。
    """
    members = [products] if isinstance(products, GridProduct) else list(products)
    expression = constraint(members)
    path_of = day_path if members[0].temporal == "day" else month_path
    todo = [
        month
        for month in sorted(granules, reverse=True)
        if not path_of(month_dir, month).exists()
    ]

    def one(month: date) -> int | str:
        try:
            return download_month(
                http,
                token,
                granules[month],
                expression,
                path_of(month_dir, month),
                sleep=sleep,
                on_retry=on_retry,
            )
        except GridFetchError as err:
            return str(err)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(one, todo))
    sizes = [result for result in results if isinstance(result, int)]
    return len(sizes), sum(sizes), [r for r in results if isinstance(r, str)]


def downloaded_months(month_dir: Path) -> list[date]:
    return sorted(
        date(int(path.stem[:4]), int(path.stem[4:6]), 1)
        for path in month_dir.glob("[0-9][0-9][0-9][0-9][0-9][0-9].nc4")
    )


def contiguous_months(month_dir: Path) -> list[date]:
    """已下載的月份裡，從最新月份往回連續不中斷的那一段（遞增排序）。"""
    run: list[date] = []
    for month in reversed(downloaded_months(month_dir)):
        if (
            run
            and (run[-1].year * 12 + run[-1].month) - (month.year * 12 + month.month)
            != 1
        ):
            break
        run.append(month)
    return run[::-1]


def read_source_file(
    product: GridProduct, path: Path
) -> tuple[Floats, Floats, Floats, str]:
    """讀一個下載回來的檔案裡這個產品的變數；座標換算成格子中心。"""
    lat, lon, values, unit = read_month_file(
        path, product.path, lat=product.lat, lon=product.lon
    )
    if product.cell_reference == "north_west_corner":
        lat = lat - (lat[1] - lat[0]) / 2
        lon = lon + (lon[1] - lon[0]) / 2
    return lat, lon, values, unit


def aggregate_days(
    product: GridProduct, day_dir: Path, month_dir: Path, days: Sequence[date]
) -> int:
    """把日資料算成月平均檔（`<month_dir>/YYYYMM.nc4`），回傳新寫的月數。

    `days` 是 CMR 列出的所有資料日。一個月要它列出的每一天都下載好才算，所以抓到一半時
    不會有只含部分日子的月份。月平均是「當月該格有值的日子」的算術平均，一天都沒有就是
    NaN；每格有值的天數存在同一個檔的 `n_days`。已寫過且天數沒變的月份不重算。
    """
    by_month: dict[date, list[date]] = {}
    for day in days:
        by_month.setdefault(day.replace(day=1), []).append(day)
    written = 0
    for month, members in sorted(by_month.items()):
        dest = month_path(month_dir, month)
        if not all(day_path(day_dir, day).exists() for day in members):
            continue
        if dest.exists():
            with netCDF4.Dataset(dest) as done:
                if int(done.getncattr("days_in_file")) == len(members):
                    continue
        lat0, lon0, first, unit = read_source_file(
            product, day_path(day_dir, members[0])
        )
        total = np.zeros(first.shape, dtype=np.float64)
        count = np.zeros(first.shape, dtype=np.int16)
        for i, day in enumerate(sorted(members)):
            if i:
                lat, lon, layer, _ = read_source_file(product, day_path(day_dir, day))
                if not (np.array_equal(lat, lat0) and np.array_equal(lon, lon0)):
                    raise GridError(f"{day:%Y-%m-%d} 的網格與 {members[0]} 不同")
            else:
                layer = first
            valid = np.isfinite(layer)
            total += np.where(valid, layer, 0.0)
            count += valid
        with np.errstate(invalid="ignore", divide="ignore"):
            mean = np.where(count > 0, total / count, np.nan).astype(np.float32)
        month_dir.mkdir(parents=True, exist_ok=True)
        temp = dest.with_suffix(".part")
        with netCDF4.Dataset(temp, "w", format="NETCDF4") as dataset:
            dataset.createDimension("lat", len(lat0))
            dataset.createDimension("lon", len(lon0))
            dataset.createVariable("lat", "f8", ("lat",))[:] = lat0
            dataset.createVariable("lon", "f8", ("lon",))[:] = lon0
            var = dataset.createVariable(product.name, "f4", ("lat", "lon"), zlib=True)
            var.units = unit or product.unit
            var[:] = mean
            dataset.createVariable("n_days", "i2", ("lat", "lon"), zlib=True)[:] = count
            dataset.days_in_file = len(members)
        temp.replace(dest)
        written += 1
    return written


@dataclass(frozen=True)
class Built:
    """`build_cube` 的結果：立方體已寫到 `path`；`coarse` 是降解析度後的值（給衍生檔用）。"""

    path: Path
    months: list[date]
    lat: Floats
    lon: Floats
    unit: str
    attrs: dict[str, str]
    latest_mean: float
    coarse: Floats | None = None
    grid: Grid | None = None


def build_cube(product: GridProduct, month_dir: Path, cube_path: Path) -> Built:
    """把逐月檔一個月一個月疊成立方體寫到 `cube_path`；各月的網格必須相同。

    一次只讀一個月，所以 0.1° 的產品也不會把整個立方體放進記憶體。`product.derive`
    為 True 時順便把每個月降解析度，留在回傳值裡給 `write_derived` 用。
    """
    months = contiguous_months(month_dir)
    if not months:
        raise GridError(f"{month_dir} 裡沒有已下載的月份")

    if product.cell_reference not in CELL_REFERENCES:
        raise GridError(
            f"{product.id} 的 cell_reference 不認得：{product.cell_reference}"
        )

    def read(month: date) -> tuple[Floats, Floats, Floats, str]:
        if product.temporal == "day":  # `aggregate_days` 寫的月平均檔
            return read_month_file(month_path(month_dir, month), product.name)
        return read_source_file(product, month_path(month_dir, month))

    lat0, lon0, first, unit = read(months[0])
    unit = unit or product.unit
    attrs = {
        "title": f"{product.name_en}: global monthly grid",
        "product": product.product,
        "doi": product.doi,
        "citation": product.citation,
        "access": "NASA Earthdata Cloud OPeNDAP (opendap.earthdata.nasa.gov), "
        f"collection {product.collection}",
        "source_variable": product.path,
        "first_month": f"{months[0]:%Y-%m}",
        "last_month": f"{months[-1]:%Y-%m}",
        "n_months": str(len(months)),
    }
    coarse: list[Floats] = []
    grids: list[Grid] = []
    latest: list[Floats] = []

    def layers():
        for i, month in enumerate(months):
            if i:
                lat, lon, layer, _ = read(month)
                if not (np.array_equal(lat, lat0) and np.array_equal(lon, lon0)):
                    raise GridError(f"{month:%Y-%m} 的網格與 {months[0]:%Y-%m} 不同")
            else:
                layer = first
            if product.derive:
                small, grid = regrid(
                    layer,
                    lat0,
                    lon0,
                    lat_step=product.lat_step,
                    lon_factor=product.lon_factor,
                )
                coarse.append(small)
                grids.append(grid)
            latest[:] = [layer]
            yield layer

    try:
        write_cube_layers(
            cube_path, product.name, months, lat0, lon0, unit, attrs, layers()
        )
    except BaseException:
        cube_path.with_suffix(".part").unlink(missing_ok=True)
        raise
    return Built(
        path=cube_path,
        months=months,
        lat=lat0,
        lon=lon0,
        unit=unit,
        attrs=attrs,
        latest_mean=float(global_mean(latest[0], lat0)),
        coarse=np.stack(coarse) if coarse else None,
        grid=grids[0] if grids else None,
    )


def write_derived(product: GridProduct, built: Built, directory: Path) -> list[Path]:
    """由降解析度後的月資料產生前端衍生檔：逐年平均、月氣候值、探索性的線性斜率。"""
    if built.coarse is None or built.grid is None:
        raise GridError(f"{product.id} 沒有 frontend 設定，不產生衍生檔")
    coarse, grid = built.coarse, built.grid
    years, annual = annual_means(built.months, coarse)
    if not years:
        raise GridError("沒有 12 個月齊全的年份，無法產生逐年平均")
    _, climatology = monthly_climatology(built.months, coarse)
    period = f"{years[0]}–{years[-1]}"
    layer_sets = [
        Layers(
            name="annual_mean",
            description=f"逐年平均（{period}，各月依天數加權；只含 12 個月齊全的年份）",
            unit=built.unit,
            labels=[str(year) for year in years],
            values=annual,
            scale=product.scale,
            offset=product.offset,
        ),
        Layers(
            name="monthly_climatology",
            description=f"多年月氣候值（{period} 各年同一個月的平均），12 層為 1 至 12 月",
            unit=built.unit,
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
                unit=f"{built.unit} per decade",
                labels=[period],
                values=slope_per_decade(years, annual)[None],
                scale=product.slope_scale,
            )
        )
    info: dict[str, Any] = {
        "id": product.id,
        "name_zh": product.name_zh,
        "name_en": product.name_en,
        "unit": built.unit,
        "product": product.product,
        "product_version": product.product_version,
        "source_variable": product.variable,
        "doi": product.doi,
        "citation": product.citation,
        "access": built.attrs.get("access", ""),
        "coverage": {
            "first_month": f"{built.months[0]:%Y-%m}",
            "last_month": f"{built.months[-1]:%Y-%m}",
            "n_months": len(built.months),
            "complete_years": [years[0], years[-1]],
            "note": "逐年平均、月氣候值與斜率只用 complete_years 內的年份；"
            "資料由最新月份往回補，first_month 之前尚未抓取或不在本產品的收錄範圍",
        },
        "native_grid": {
            "n_lat": len(built.lat),
            "n_lon": len(built.lon),
            "lat_first_centre": float(built.lat[0]),
            "lat_step": float(built.lat[1] - built.lat[0]),
            "lon_first_centre": float(built.lon[0]),
            "lon_step": float(built.lon[1] - built.lon[0]),
        },
        "regrid": "面積加權平均；目標格內有值的面積不到一半時為缺值",
    }
    return write_frontend(directory, info, grid, layer_sets)


def cube_is_current(product: GridProduct, month_dir: Path, cube_path: Path) -> bool:
    """立方體已涵蓋目前下載到的連續月份時為 True（續跑時不必重建）。"""
    if not cube_path.exists():
        return False
    months = contiguous_months(month_dir)
    if not months:
        return True
    attrs = read_cube_attrs(cube_path)
    return (
        attrs.get("first_month") == f"{months[0]:%Y-%m}"
        and attrs.get("last_month") == f"{months[-1]:%Y-%m}"
        and attrs.get("n_months") == str(len(months))
    )


def assemble_product(
    product: GridProduct,
    month_dir: Path,
    raw_dir: Path,
    out_dir: Path,
    days: Sequence[date] = (),
) -> str:
    """建一個產品的立方體（與衍生檔），回傳一行摘要；已是最新就不重建。

    日資料產品的 `month_dir` 是逐日檔的目錄、`days` 是 CMR 列出的資料日：先算成月平均
    （放在 `<raw_dir>/<id>/months/`）再建立方體。
    """
    recomputed = 0
    if product.temporal == "day":
        day_dir, month_dir = month_dir, raw_dir / product.id / "months"
        recomputed = aggregate_days(product, day_dir, month_dir, days)
    cube_path = raw_dir / product.id / f"{product.id}.nc"
    derived_dir = out_dir / product.id
    if (
        not recomputed
        and cube_is_current(product, month_dir, cube_path)
        and (not product.derive or (derived_dir / META_FILE).exists())
    ):
        return f"{product.id}：立方體已是最新，未重建"
    built = build_cube(product, month_dir, cube_path)
    written = write_derived(product, built, derived_dir) if product.derive else []
    return (
        f"{product.id}：立方體 {built.attrs['first_month']} 至 "
        f"{built.attrs['last_month']}（{len(built.months)} 個月，"
        f"{len(built.lat)} × {len(built.lon)}），{cube_path.stat().st_size / 1e6:.1f} MB；"
        f"最新月份的面積加權平均 {built.latest_mean:.6g} {built.unit}"
        + (
            f"；衍生檔 {sum(path.stat().st_size for path in written) / 1e6:.2f} MB"
            if written
            else ""
        )
    )


def _assemble_safely(
    product: GridProduct,
    month_dir: Path,
    raw_dir: Path,
    out_dir: Path,
    days: Sequence[date] = (),
) -> tuple[str, bool]:
    try:
        return assemble_product(product, month_dir, raw_dir, out_dir, days), True
    except (GridError, OSError, ValueError) as err:
        return f"{product.id}：立方體失敗：{err}", False


@dataclass
class BatchResult:
    batch: Batch
    months: int = 0
    downloaded: int = 0
    size: int = 0
    seconds: float = 0.0
    failures: list[str] = field(default_factory=list)


def fetch_batch(
    batch: Batch,
    *,
    http: httpx.Client,
    token: str,
    granules: dict[date, str],
    since: date | None,
    workers: int,
    sleep: Callable[[float], None] = time.sleep,
    on_retry: Callable[[str], None] | None = None,
) -> BatchResult:
    """下載一批產品還沒有的月份；任何錯誤都記在結果裡，不往外丟。"""
    started = time.monotonic()
    result = BatchResult(batch)
    start = min(product.start for product in batch.products)
    if since:
        start = max(start, since)
    wanted = {month: url for month, url in granules.items() if month >= start}
    result.months = len(wanted)
    try:
        if BATCH_DIR in batch.month_dir.parts:
            batch.month_dir.mkdir(parents=True, exist_ok=True)
            (batch.month_dir / "variables.json").write_text(
                json.dumps(
                    {product.id: product.path for product in batch.products},
                    ensure_ascii=False,
                    indent=1,
                )
                + "\n",
                encoding="utf-8",
            )
        result.downloaded, result.size, result.failures = fetch_months(
            http,
            token,
            batch.products,
            wanted,
            batch.month_dir,
            workers=workers,
            sleep=sleep,
            on_retry=on_retry,
        )
    except (GridFetchError, OSError, httpx.HTTPError) as err:
        result.failures.append(f"{type(err).__name__}: {err}".replace(token, "***"))
    result.seconds = time.monotonic() - started
    return result


def run(
    products: Sequence[GridProduct],
    *,
    http: httpx.Client,
    token: str,
    raw_dir: Path,
    out_dir: Path,
    since: date | None = None,
    workers: int = 4,
    batch_size: int = 1,
    parallel: int = 1,
    build_workers: int = 1,
    fetch_only: bool = False,
    sleep: Callable[[float], None] = time.sleep,
    report: Callable[[str], None] = print,
) -> bool:
    """抓一組產品並建立方體與衍生檔；全部成功回傳 True。

    同時跑 `parallel` 個批次、每批 `workers` 個下載執行緒；一批下載完就把它的產品交給
    `build_workers` 個行程建立方體。某一批或某個產品失敗只記錄下來，其他的照常做完。
    """
    started = time.monotonic()
    retries = RetryLog()
    batches = plan_batches(products, raw_dir, batch_size=batch_size)
    granules: dict[str, dict[date, str]] = {}
    listing_failed: list[str] = []
    for collection in dict.fromkeys(p.collection for p in products):
        members = [p for p in products if p.collection == collection]
        first = min(p.start for p in members)
        try:
            granules[collection] = list_granules(
                http, collection, first, daily=members[0].temporal == "day"
            )
        except (GridFetchError, httpx.HTTPError) as err:
            listing_failed.append(collection)
            report(f"CMR 查 {collection} 失敗：{type(err).__name__}: {err}")
    ok = not listing_failed
    total_size = 0
    builds: list[Future[tuple[str, bool]]] = []
    # spawn：下載執行緒還在跑的時候 fork 可能卡死；HDF5 也不是 thread-safe，
    # 所以立方體只在主執行緒或獨立的行程裡建。
    builders = (
        ProcessPoolExecutor(
            max_workers=build_workers, mp_context=multiprocessing.get_context("spawn")
        )
        if build_workers > 1
        else None
    )
    try:
        with ThreadPoolExecutor(max_workers=max(parallel, 1)) as pool:
            fetches = [
                pool.submit(
                    fetch_batch,
                    batch,
                    http=http,
                    token=token,
                    granules=granules[batch.products[0].collection],
                    since=since,
                    workers=workers,
                    sleep=sleep,
                    on_retry=retries.note,
                )
                for batch in batches
                if batch.products[0].collection in granules
            ]
            for future in as_completed(fetches):
                result = future.result()
                batch = result.batch
                total_size += result.size
                ok &= not result.failures
                unit = "天" if batch.products[0].temporal == "day" else "個月"
                report(
                    f"{batch.label}：CMR 有 {result.months} {unit}，新下載 "
                    f"{result.downloaded} {unit}、{result.size / 1e6:.1f} MB，"
                    f"失敗 {len(result.failures)}，耗時 {result.seconds:.0f} 秒"
                )
                for failure in result.failures:
                    report(f"  失敗：{failure}")
                if fetch_only:
                    continue
                for product in batch.products:
                    days = (
                        sorted(granules[product.collection])
                        if product.temporal == "day"
                        else ()
                    )
                    job = (product, batch.month_dir, raw_dir, out_dir, days)
                    if builders:
                        builds.append(builders.submit(_assemble_safely, *job))
                    else:
                        line, fine = _assemble_safely(*job)
                        report("  " + line)
                        ok &= fine
        for build in as_completed(builds):
            line, fine = build.result()
            report("  " + line)
            ok &= fine
    finally:
        if builders:
            builders.shutdown()
    report(
        f"合計：{len(products)} 個變數、{len(batches)} 批，新下載 {total_size / 1e6:.1f} MB，"
        f"耗時 {time.monotonic() - started:.0f} 秒；重試：{retries.summary()}"
    )
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description="抓全球格點月資料並產生衍生檔")
    parser.add_argument(
        "--product", action="append", help="只跑這些 id（可重複、可用 * 萬用字元）"
    )
    parser.add_argument("--exclude", action="append", help="不跑這些 id（同上）")
    parser.add_argument("--since", type=parse_month, help="只抓這個月份之後，YYYY-MM")
    parser.add_argument("--workers", type=int, default=4, help="每批的下載執行緒數")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="同一個產品一個請求併幾個變數（1 表示一個變數一個請求）",
    )
    parser.add_argument("--parallel", type=int, default=1, help="同時跑幾批")
    parser.add_argument(
        "--build-workers", type=int, default=1, help="幾個行程同時建立方體"
    )
    parser.add_argument(
        "--fetch-only", action="store_true", help="只下載，不建立方體與衍生檔"
    )
    parser.add_argument("--seed-file", type=Path, action="append")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args()
    seed_files = args.seed_file or [SEED_FILE]
    products = select_products(
        [product for seed in seed_files for product in load_products(seed)],
        args.product,
        args.exclude,
    )
    if not products:
        raise SystemExit(f"{'、'.join(map(str, seed_files))} 裡沒有符合的產品")
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    limits = httpx.Limits(max_connections=max(args.parallel * args.workers, 10) + 4)
    with httpx.Client(timeout=600, follow_redirects=True, limits=limits) as http:
        ok = run(
            products,
            http=http,
            token=token,
            raw_dir=args.raw_dir,
            out_dir=args.out_dir,
            since=args.since,
            workers=args.workers,
            batch_size=args.batch_size,
            parallel=args.parallel,
            build_workers=args.build_workers,
            fetch_only=args.fetch_only,
        )
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
