"""從 Microsoft Planetary Computer 取 MODIS，在本機算每個合成期 × 區域的統計量（#13）。

用法（在存有 `data/raw/` 的目錄，或用 `--raw-dir` 指過去）：
    uv run python -m trend_detective.planetary_computer fetch

不需要帳號。STAC API 匿名可查；讀資料檔要 SAS token（匿名可取、約 45 分鐘過期），
這裡按 storage account 與 container 取 token、快取，快過期時自動更新。token 只放在
記憶體，不寫進任何檔案或錯誤訊息。

資料檔是 sinusoidal 投影的 COG：只用 HTTP Range 讀區域範圍涵蓋到的區塊，把像元中心
轉回經緯度後判斷是否落在區域 bbox 內。scale factor、fill value、單位都從檔案自己的
metadata 讀（GDAL 的 scale、nodata、units），不寫死。

結果逐列存成 `data/raw/planetary_computer/<變數 id>/stats.csv`（每列是合成期 × 區域），
已算過的合成期不重抓；快照指令的 `planetary_computer` 來源再把它轉成區域月序列，不連網。

點位（#51）：seed 的變數若有 `point_source.source = "planetary_computer"`，另外對每個點位取
「點所在像元為中心、`window_pixels` × `window_pixels` 個像元」有值像元的平均，存在
`data/raw/planetary_computer/<變數 id>/stats.csv`（變數 id 不帶 `_pc`，每列是合成期 × 點位）。
"""

import argparse
import csv
import io
import json
import sys
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import numpy as np
import rasterio
from rasterio.windows import Window

from trend_detective.appeears_stats import StatRow

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
SAS_URL = "https://planetarycomputer.microsoft.com/api/sas/v1"
SOURCE_DIR = "planetary_computer"
STATS_FILE = "stats.csv"
FETCH_FILE = "fetch.json"
START_DATE = date(2001, 1, 1)
# token 剩不到這麼久就換新的
TOKEN_MARGIN = timedelta(minutes=5)
# 一次 Range 請求讀多大；COG 的檔頭與小區塊多半在這個大小以內；調大會多抓用不到的部分
RANGE_BLOCK = 64 * 1024
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 6
STATS_COLUMNS = [
    "date",
    "location_id",
    "asset",
    "count",
    "mean",
    "standard_deviation",
    "minimum",
    "maximum",
    "pixels_in_bbox",
    "tiles",
    "item_ids",
]

Bbox = tuple[float, float, float, float]
# 點位視窗裡的像元全部都算：統計時用這個涵蓋全球的 bbox
EVERYWHERE: Bbox = (-180.0, -90.0, 180.0, 90.0)


class PlanetaryComputerError(RuntimeError):
    """訊息裡只會有未簽名的網址，不含 token。"""


def _unsigned(url: str) -> str:
    return url.split("?", 1)[0]


def request_with_retry(
    http: httpx.Client,
    method: str,
    url: str,
    *,
    sleep: Callable[[float], None] = time.sleep,
    **kwargs: Any,
) -> httpx.Response:
    """429 與 5xx、連線錯誤都退避重試（1、2、4… 秒，或照 Retry-After）。"""
    for attempt in range(MAX_ATTEMPTS):
        last = attempt == MAX_ATTEMPTS - 1
        try:
            response = http.request(method, url, **kwargs)
        except httpx.TransportError as err:
            if last:
                raise PlanetaryComputerError(
                    f"{_unsigned(url)} 連線失敗：{type(err).__name__}"
                ) from None
            sleep(2.0**attempt)
            continue
        if response.status_code in RETRY_STATUS and not last:
            retry_after = response.headers.get("retry-after", "")
            sleep(float(retry_after) if retry_after.isdigit() else 2.0**attempt)
            continue
        return response
    raise AssertionError("unreachable")


class SasTokens:
    """按 storage account 與 container 取 SAS token 並快取；可跨執行緒共用。"""

    def __init__(
        self,
        http: httpx.Client,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._http = http
        self._now = now
        self._sleep = sleep
        self._lock = threading.Lock()
        self._cache: dict[tuple[str, str], tuple[str, datetime]] = {}

    def sign(self, href: str, *, refresh: bool = False) -> str:
        """回傳帶 token 的網址。`refresh` 強制換新 token（服務說舊的失效時用）。"""
        parts = urlsplit(href)
        account = (parts.hostname or "").split(".")[0]
        container = parts.path.lstrip("/").split("/")[0]
        key = (account, container)
        with self._lock:
            cached = self._cache.get(key)
            if refresh or cached is None or cached[1] - self._now() < TOKEN_MARGIN:
                cached = self._fetch(account, container)
                self._cache[key] = cached
        return f"{href}?{cached[0]}"

    def _fetch(self, account: str, container: str) -> tuple[str, datetime]:
        url = f"{SAS_URL}/token/{account}/{container}"
        response = request_with_retry(self._http, "GET", url, sleep=self._sleep)
        if response.status_code != 200:
            raise PlanetaryComputerError(
                f"取 SAS token 失敗：{url} 回 {response.status_code}"
            )
        body = response.json()
        expiry = datetime.fromisoformat(body["msft:expiry"])
        return body["token"], expiry


@dataclass
class Transfer:
    """下載量的統計（跨執行緒累加）。"""

    bytes: int = 0
    requests: int = 0

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def add(self, size: int) -> None:
        with self._lock:
            self.bytes += size
            self.requests += 1


class RemoteBlob:
    """用 HTTP Range 分塊讀一個遠端檔案並快取，只下載實際讀到的區塊。"""

    def __init__(
        self,
        http: httpx.Client,
        tokens: SasTokens,
        href: str,
        transfer: Transfer,
        *,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._http = http
        self._tokens = tokens
        self._href = href
        self._transfer = transfer
        self._sleep = sleep
        self._lock = threading.Lock()
        self._blocks: dict[int, bytes] = {}
        self._size = -1
        # GDAL 讀檔途中發生的錯誤先記在這裡（見 `RangeFile.read`）
        self.error: Exception | None = None

    @property
    def size(self) -> int:
        if self._size < 0:
            self.block(0)
        return self._size

    def block(self, index: int) -> bytes:
        with self._lock:
            if index not in self._blocks:
                self._download(index)
            return self._blocks.get(index, b"")

    def _download(self, index: int) -> None:
        first = index * RANGE_BLOCK
        headers = {"Range": f"bytes={first}-{first + RANGE_BLOCK - 1}"}
        response = request_with_retry(
            self._http,
            "GET",
            self._tokens.sign(self._href),
            headers=headers,
            sleep=self._sleep,
        )
        if response.status_code == 403:
            # token 可能剛好過期：換一個新的再試一次
            response = request_with_retry(
                self._http,
                "GET",
                self._tokens.sign(self._href, refresh=True),
                headers=headers,
                sleep=self._sleep,
            )
        content = response.content
        if response.status_code == 206:
            self._size = int(response.headers["content-range"].rsplit("/", 1)[1])
            self._blocks[index] = content
        elif response.status_code == 200:
            # 服務不理 Range、整個檔一次回來
            self._size = len(content)
            for start in range(0, self._size, RANGE_BLOCK):
                self._blocks[start // RANGE_BLOCK] = content[
                    start : start + RANGE_BLOCK
                ]
        else:
            raise PlanetaryComputerError(
                f"讀 {self._href} 失敗：HTTP {response.status_code}"
            )
        self._transfer.add(len(content))

    def open(self, path: str = "", mode: str = "rb", **_: Any) -> "RangeFile":
        """給 `rasterio.open(..., opener=blob.open)` 用；GDAL 每次開檔各拿一個獨立的游標。

        GDAL 開檔時還會找旁邊的 `.aux.xml` 等附屬檔：那些一律回「沒有這個檔」，
        否則會把整個影像當成附屬檔讀一遍。
        """
        if path and path != self._href:
            raise FileNotFoundError(path)
        return RangeFile(self)


class RangeFile(io.RawIOBase):
    """`RemoteBlob` 上的唯讀游標（read／seek／tell）。"""

    def __init__(self, blob: RemoteBlob) -> None:
        super().__init__()
        self._blob = blob
        self._position = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self._position = offset
        elif whence == io.SEEK_CUR:
            self._position += offset
        else:
            self._position = self._blob.size + offset
        return self._position

    def read(self, size: int = -1) -> bytes:
        total = self._blob.size
        end = total if size < 0 else min(total, self._position + size)
        out = bytearray()
        while self._position < end:
            index = self._position // RANGE_BLOCK
            offset = self._position - index * RANGE_BLOCK
            try:
                block = self._blob.block(index)
            except Exception as err:  # noqa: BLE001
                # 這裡是 GDAL 的 C callback：例外丟出去會讓整個行程當掉。
                # 記下來、回傳短讀，GDAL 會報讀取失敗，呼叫端再把原因換回來
                self._blob.error = err
                break
            chunk = block[offset : offset + end - self._position]
            if not chunk:
                break
            out += chunk
            self._position += len(chunk)
        return bytes(out)


@dataclass(frozen=True)
class TilePixels:
    """一個 tile 在查詢範圍內的像元：原始整數值，以及每個像元中心的經緯度。"""

    tile: str
    item_id: str
    raw: np.ndarray
    lon: np.ndarray
    lat: np.ndarray
    scale: float
    offset: float
    nodata: float | None
    unit: str


def sinusoidal_to_lonlat(
    x: np.ndarray, y: np.ndarray, radius: float
) -> tuple[np.ndarray, np.ndarray]:
    """球面 sinusoidal（中央經線 0°）→ 經緯度（度）。lat = y/R，lon = x/(R·cos lat)。"""
    lat = y / radius
    lon = x / (radius * np.cos(lat))
    return np.degrees(lon), np.degrees(lat)


def _sinusoidal_radius(crs: Any) -> float:
    data = crs.to_dict()
    if data.get("proj") != "sinu" or float(data.get("lon_0", 0)) != 0:
        raise PlanetaryComputerError(f"預期是中央經線 0° 的 sinusoidal 投影：{data}")
    radius = data.get("R") or data.get("a")
    if radius is None or ("b" in data and data["b"] != radius):
        raise PlanetaryComputerError(f"預期是球面（單一半徑）的投影：{data}")
    return float(radius)


def effective_scale(file_scale: float, declared_scale: float | None) -> float:
    """值 = 原始值 × 這個數。以檔案 metadata 的 scale 為準，並和 STAC 宣告的 scale 核對。

    MODIS 植生指數（MOD13）的檔案把 scale_factor 寫成除數（10000），STAC 寫的是乘數
    （0.0001）：兩者互為倒數時用乘數。兩者對不上就報錯，不猜。
    """
    if declared_scale is None or abs(file_scale - declared_scale) <= 1e-9:
        return file_scale
    if abs(file_scale * declared_scale - 1) <= 1e-9:
        return declared_scale
    raise PlanetaryComputerError(
        f"檔案的 scale（{file_scale}）與 STAC 宣告的（{declared_scale}）對不上"
    )


def read_tile_pixels(
    dataset: Any,
    bbox: Bbox,
    *,
    tile: str,
    item_id: str,
    declared_scale: float | None = None,
) -> TilePixels | None:
    """讀 bbox 涵蓋到的視窗。視窗只是外框：像元是否算在區域內由 `region_statistics` 判斷。

    `declared_scale` 是 STAC 資產的 `raster:bands[0].scale`，用來核對檔案的 scale。
    """
    radius = _sinusoidal_radius(dataset.crs)
    west, south, east, north = bbox
    # sinusoidal 的 x = R·lon·cos(lat)：bbox 的 x 極值出現在四個角
    corners_lon = np.radians([west, west, east, east])
    corners_lat = np.radians([south, north, south, north])
    xs = radius * corners_lon * np.cos(corners_lat)
    ys = radius * corners_lat
    transform = dataset.transform
    if transform.b or transform.d:
        raise PlanetaryComputerError("預期是沒有旋轉的網格")
    col_a, col_b = (
        (float(xs.min()) - transform.c) / transform.a,
        (float(xs.max()) - transform.c) / transform.a,
    )
    row_a, row_b = (
        (float(ys.max()) - transform.f) / transform.e,
        (float(ys.min()) - transform.f) / transform.e,
    )
    col_0 = max(0, int(np.floor(min(col_a, col_b))))
    row_0 = max(0, int(np.floor(min(row_a, row_b))))
    col_1 = min(dataset.width, int(np.ceil(max(col_a, col_b))))
    row_1 = min(dataset.height, int(np.ceil(max(row_a, row_b))))
    if col_0 >= col_1 or row_0 >= row_1:
        return None
    return _window_pixels(
        dataset, (col_0, row_0, col_1, row_1), radius, tile, item_id, declared_scale
    )


def read_point_window(
    dataset: Any,
    lon: float,
    lat: float,
    size: int,
    *,
    tile: str,
    item_id: str,
    declared_scale: float | None = None,
) -> TilePixels | None:
    """以點所在的像元為中心、`size` × `size`（奇數）個像元的視窗。

    點不在這個檔案的範圍內回 None。視窗超出檔案邊界的部分裁掉，不跨到相鄰 tile
    （目前的點位離 tile 邊界都超過 10 km）。
    """
    if size < 1 or size % 2 == 0:
        raise PlanetaryComputerError(f"視窗邊長要是正奇數：{size}")
    radius = _sinusoidal_radius(dataset.crs)
    transform = dataset.transform
    if transform.b or transform.d:
        raise PlanetaryComputerError("預期是沒有旋轉的網格")
    x = radius * np.radians(lon) * np.cos(np.radians(lat))
    y = radius * np.radians(lat)
    col = int(np.floor((x - transform.c) / transform.a))
    row = int(np.floor((y - transform.f) / transform.e))
    if not (0 <= col < dataset.width and 0 <= row < dataset.height):
        return None
    half = size // 2
    window = (
        max(0, col - half),
        max(0, row - half),
        min(dataset.width, col + half + 1),
        min(dataset.height, row + half + 1),
    )
    return _window_pixels(dataset, window, radius, tile, item_id, declared_scale)


def _window_pixels(
    dataset: Any,
    window: tuple[int, int, int, int],
    radius: float,
    tile: str,
    item_id: str,
    declared_scale: float | None,
) -> TilePixels:
    """讀 (col_0, row_0, col_1, row_1) 這塊像元，連同每個像元中心的經緯度。"""
    col_0, row_0, col_1, row_1 = window
    transform = dataset.transform
    raw = dataset.read(1, window=Window(col_0, row_0, col_1 - col_0, row_1 - row_0))  # pyright: ignore[reportCallIssue]
    cols, rows = np.meshgrid(
        np.arange(col_0, col_1) + 0.5, np.arange(row_0, row_1) + 0.5
    )
    x = transform.a * cols + transform.c
    y = transform.e * rows + transform.f
    lon, lat = sinusoidal_to_lonlat(x, y, radius)
    return TilePixels(
        tile=tile,
        item_id=item_id,
        raw=raw,
        lon=lon,
        lat=lat,
        scale=effective_scale(float(dataset.scales[0]), declared_scale),
        offset=float(dataset.offsets[0]),
        nodata=dataset.nodata,
        unit=dataset.units[0] or "",
    )


@dataclass(frozen=True)
class RegionStat:
    count: int
    mean: float | None
    standard_deviation: float | None
    minimum: float | None
    maximum: float | None
    # 像元中心落在 bbox 內的像元數（含沒有值的）
    pixels_in_bbox: int
    # 有像元中心落在 bbox 內的 tile 與 item
    tiles: tuple[str, ...]
    item_ids: tuple[str, ...]


def region_statistics(tiles: list[TilePixels], bbox: Bbox) -> RegionStat:
    """像元中心落在 bbox 內（含邊界）且有值的像元，跨 tile 合併後算統計量。

    值 = 原始值 × scale + offset；等於 nodata 的像元不算。標準差是母體標準差。
    """
    west, south, east, north = bbox
    values = []
    pixels = 0
    used_tiles = []
    used_items = []
    for tile in tiles:
        inside = (
            (tile.lon >= west)
            & (tile.lon <= east)
            & (tile.lat >= south)
            & (tile.lat <= north)
        )
        n_inside = int(inside.sum())
        if not n_inside:
            continue
        pixels += n_inside
        used_tiles.append(tile.tile)
        used_items.append(tile.item_id)
        raw = tile.raw[inside]
        if tile.nodata is not None:
            raw = raw[raw != tile.nodata]
        values.append(raw.astype(np.float64) * tile.scale + tile.offset)
    merged = np.concatenate(values) if values else np.array([], dtype=np.float64)
    if merged.size == 0:
        return RegionStat(
            0, None, None, None, None, pixels, tuple(used_tiles), tuple(used_items)
        )
    return RegionStat(
        count=int(merged.size),
        mean=float(merged.mean()),
        standard_deviation=float(merged.std()),
        minimum=float(merged.min()),
        maximum=float(merged.max()),
        pixels_in_bbox=pixels,
        tiles=tuple(used_tiles),
        item_ids=tuple(used_items),
    )


def search_items(
    http: httpx.Client,
    collection: str,
    bbox: Bbox,
    start: date,
    end: date,
    *,
    id_prefix: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> list[dict[str, Any]]:
    """STAC 查詢，跟著 `next` 連結翻頁到底；`id_prefix` 只留 id 以它開頭的 item。

    Terra 與 Aqua 放在同一個 collection。不用 `platform` 屬性篩選：2026-11-14 實測
    2024-03 至 2025-06 的 item 沒有這個屬性，照它篩會整段漏掉。item id 的開頭是產品
    短名（`MOD11A2.`＝Terra、`MYD11A2.`＝Aqua），讀檔時再用檔案裡的 SHORTNAME 核對。
    """
    body: dict[str, Any] | None = {
        "collections": [collection],
        "bbox": list(bbox),
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "limit": 1000,
    }
    url = f"{STAC_URL}/search"
    items: list[dict[str, Any]] = []
    while body is not None:
        response = request_with_retry(http, "POST", url, json=body, sleep=sleep)
        if response.status_code != 200:
            raise PlanetaryComputerError(
                f"STAC 查詢失敗：HTTP {response.status_code} {response.text[:200]}"
            )
        page = response.json()
        items.extend(page.get("features", []))
        following = [
            link for link in page.get("links", []) if link.get("rel") == "next"
        ]
        if not following:
            break
        url = following[0]["href"]
        body = following[0].get("body")
    if id_prefix:
        items = [item for item in items if item["id"].startswith(id_prefix)]
    return items


def _tile_name(item: dict[str, Any]) -> str:
    properties = item["properties"]
    return f"h{properties['modis:horizontal-tile']:02d}v{properties['modis:vertical-tile']:02d}"


def composites(
    items: list[dict[str, Any]], start: date
) -> dict[date, dict[str, dict[str, Any]]]:
    """item 依合成期起始日與 tile 分組；同一 tile 有多個版本時取最晚產製的（id 最大）。"""
    grouped: dict[date, dict[str, dict[str, Any]]] = {}
    for item in items:
        day = date.fromisoformat(item["properties"]["start_datetime"][:10])
        if day < start:
            continue
        by_tile = grouped.setdefault(day, {})
        tile = _tile_name(item)
        if tile not in by_tile or item["id"] > by_tile[tile]["id"]:
            by_tile[tile] = item
    return grouped


def _text(value: float | None) -> str:
    return "" if value is None else repr(value)


def write_stats(path: Path, rows: dict[tuple[str, str], dict[str, str]]) -> None:
    """整份重寫（依日期、區域排序），先寫暫存檔再換上去，中斷不會留下半個檔。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".csv.part")
    with partial.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=STATS_COLUMNS, lineterminator="\n")
        writer.writeheader()
        for key in sorted(rows):
            writer.writerow(rows[key])
    partial.replace(path)


def read_stats(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    """(日期, 區域 id) → 一列。檔案不存在就是空的。"""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = set(STATS_COLUMNS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{path} 缺少欄位：{sorted(missing)}")
        return {(row["date"], row["location_id"]): row for row in reader}


def _number(text: str) -> float | None:
    return float(text) if text else None


def stat_rows(
    path: Path, asset: str
) -> tuple[dict[str, list[StatRow]], dict[str, dict[str, Any]]]:
    """讀 `stats.csv`：回傳 (區域 id → 依日期排序的 StatRow, 區域 id → 用到的 tile 與 item 數)。

    區域跨 tile 時，少了任何一個 tile 的合成期只涵蓋區域的一部分，平均會偏：
    這種合成期當成沒有值（`n_incomplete_composites` 記有幾個），原始統計仍留在 `stats.csv`。
    """
    rows_by_region: dict[str, list[StatRow]] = {}
    used: dict[str, dict[str, set[str]]] = {}
    row_tiles: dict[tuple[str, date], set[str]] = {}
    for (day, region_id), row in sorted(read_stats(path).items()):
        if row["asset"] != asset:
            continue
        rows_by_region.setdefault(region_id, []).append(
            StatRow(
                dataset=asset,
                aid=region_id,
                day=date.fromisoformat(day),
                count=int(row["count"]),
                mean=_number(row["mean"]),
                standard_deviation=_number(row["standard_deviation"]),
                minimum=_number(row["minimum"]),
                maximum=_number(row["maximum"]),
                median=None,
            )
        )
        seen = used.setdefault(region_id, {"tiles": set(), "items": set()})
        row_tiles[(region_id, date.fromisoformat(day))] = set(
            filter(None, row["tiles"].split(";"))
        )
        seen["tiles"].update(filter(None, row["tiles"].split(";")))
        seen["items"].update(filter(None, row["item_ids"].split(";")))
    summary = {}
    for region_id, seen in used.items():
        rows = rows_by_region[region_id]
        incomplete = 0
        for index, row in enumerate(rows):
            if row_tiles[(region_id, row.day)] < seen["tiles"]:
                incomplete += 1
                rows[index] = replace(
                    row,
                    count=0,
                    mean=None,
                    standard_deviation=None,
                    minimum=None,
                    maximum=None,
                )
        summary[region_id] = {
            "tiles": sorted(seen["tiles"]),
            "n_items": len(seen["items"]),
            "n_incomplete_composites": incomplete,
        }
    return rows_by_region, summary


def _union(bboxes: list[Bbox]) -> Bbox:
    return (
        min(b[0] for b in bboxes),
        min(b[1] for b in bboxes),
        max(b[2] for b in bboxes),
        max(b[3] for b in bboxes),
    )


def _read_blob(
    blob: RemoteBlob,
    href: str,
    read: Callable[[Any], dict[str, TilePixels | None]],
    item_id: str,
    metadata: dict[str, Any],
    short_name: str | None = None,
    declared_scale: float | None = None,
) -> dict[str, TilePixels | None]:
    """開遠端 COG、用 `read` 讀視窗；第一個讀到的檔案的 metadata 記進 `metadata`（scale 等的依據）。

    給了 `short_name` 時，檔案裡的 SHORTNAME 必須相同，免得把別顆衛星的產品算進來。
    """
    with rasterio.open(href, opener=blob.open) as dataset:
        found = dataset.tags().get("SHORTNAME")
        if short_name and found is not None and found != short_name:
            raise PlanetaryComputerError(
                f"{item_id} 的 SHORTNAME 是 {found}，預期 {short_name}"
            )
        pixels = read(dataset)
        metadata.setdefault(
            "file_metadata",
            {
                "scale": float(dataset.scales[0]),
                "stac_scale": declared_scale,
                "applied_scale": effective_scale(
                    float(dataset.scales[0]), declared_scale
                ),
                "offset": float(dataset.offsets[0]),
                "nodata": dataset.nodata,
                "unit": dataset.units[0],
                "read_from": item_id,
                "tags": {
                    key: value
                    for key, value in dataset.tags().items()
                    if key
                    in (
                        "scale_factor",
                        "add_offset",
                        "_FillValue",
                        "units",
                        "valid_range",
                        "identifier_product_doi",
                        "SHORTNAME",
                        "VERSIONID",
                        "ASSOCIATEDPLATFORMSHORTNAME.1",
                        "long_name",
                    )
                },
            },
        )
    return pixels


def point_variable(variable: dict[str, Any]) -> dict[str, Any] | None:
    """變數的點位序列若來自這裡（seed 的 `point_source`），回傳點位抓取用的設定，否則 None。

    設定是變數本身蓋上 `point_source` 的欄位（collection、資產、產品、`window_pixels` 等），
    id 不變：區域序列可以來自別的來源（AppEEARS），點位序列來自 Planetary Computer。
    """
    spec = variable.get("point_source")
    if not spec or spec.get("source") != SOURCE_DIR:
        return None
    return {**variable, **spec}


def fetch_variable(
    http: httpx.Client,
    variable: dict[str, Any],
    regions: list[dict[str, Any]],
    raw_dir: Path,
    *,
    today: date,
    workers: int = 8,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    progress: Callable[[str], None] = lambda _: None,
) -> dict[str, Any]:
    """查 item、讀視窗、算每個合成期 × 區域的統計量，寫進 `stats.csv`。回傳這次執行的摘要。

    `stats.csv` 裡已有、且用的 item 相同的合成期不重抓；單一合成期失敗不中斷整批。

    變數有 `window_pixels` 時（見 `point_variable`），`regions` 是點位（`lat`、`lon`）：
    每個點位取以它所在像元為中心、`window_pixels` 見方的視窗，視窗內有值像元全部算。
    """
    started = time.monotonic()
    collection = variable["pc_collection"]
    asset = variable["source_variable_id"]
    window_pixels: int | None = variable.get("window_pixels")
    coordinates = {
        r["id"]: (float(r["lon"]), float(r["lat"])) for r in regions if window_pixels
    }
    bboxes: dict[str, Bbox]
    if window_pixels:
        bboxes = dict.fromkeys(coordinates, EVERYWHERE)
        union = _union([(lon, lat, lon, lat) for lon, lat in coordinates.values()])
    else:
        bboxes = {r["id"]: tuple(r["bbox"]) for r in regions}
        union = _union(list(bboxes.values()))
    out_dir = raw_dir / SOURCE_DIR / variable["id"]
    stats_path = out_dir / STATS_FILE
    rows = read_stats(stats_path)
    items = search_items(
        http,
        collection,
        union,
        START_DATE,
        today,
        id_prefix=variable.get("pc_item_prefix"),
        sleep=sleep,
    )
    grouped = composites(items, START_DATE)
    tokens = SasTokens(http, now=now, sleep=sleep)
    transfer = Transfer()
    metadata: dict[str, Any] = {}

    def is_done(day: date, by_tile: dict[str, dict[str, Any]]) -> bool:
        searched = {item["id"] for item in by_tile.values()}
        for region_id in bboxes:
            row = rows.get((day.isoformat(), region_id))
            if row is None or row["asset"] != asset:
                return False
            if not set(filter(None, row["item_ids"].split(";"))) <= searched:
                return False
        return True

    def compute(day: date, by_tile: dict[str, dict[str, Any]]) -> dict[str, RegionStat]:
        tiles: dict[str, list[TilePixels]] = {target: [] for target in bboxes}
        for tile, item in sorted(by_tile.items()):
            href = item["assets"][asset]["href"]
            declared = (item["assets"][asset].get("raster:bands") or [{}])[0].get(
                "scale"
            )

            def read(
                dataset: Any,
                tile: str = tile,
                item_id: str = item["id"],
                declared: float | None = declared,
            ) -> dict[str, TilePixels | None]:
                if window_pixels:
                    return {
                        target: read_point_window(
                            dataset,
                            lon,
                            lat,
                            window_pixels,
                            tile=tile,
                            item_id=item_id,
                            declared_scale=declared,
                        )
                        for target, (lon, lat) in coordinates.items()
                    }
                pixels = read_tile_pixels(
                    dataset, union, tile=tile, item_id=item_id, declared_scale=declared
                )
                return dict.fromkeys(bboxes, pixels)

            blob = RemoteBlob(http, tokens, href, transfer, sleep=sleep)
            # 先在 GDAL 外面讀第一塊：檔案不存在、token 無效這類錯誤在這裡就會丟出來
            _ = blob.size
            try:
                read_pixels = _read_blob(
                    blob,
                    href,
                    read,
                    item["id"],
                    metadata,
                    (variable.get("pc_item_prefix") or "").rstrip(".") or None,
                    declared,
                )
            except Exception:
                if blob.error is not None:
                    raise blob.error from None
                raise
            for target, pixels in read_pixels.items():
                if pixels is not None:
                    tiles[target].append(pixels)
        signature = {
            (t.scale, t.offset, t.nodata, t.unit)
            for found in tiles.values()
            for t in found
        }
        if len(signature) > 1:
            raise PlanetaryComputerError(
                f"{day} 各 tile 的 scale／nodata／單位不一致：{signature}"
            )
        return {
            region_id: region_statistics(tiles[region_id], bbox)
            for region_id, bbox in bboxes.items()
        }

    pending = {day: tiles for day, tiles in grouped.items() if not is_done(day, tiles)}
    progress(
        f"{variable['id']}：{len(items)} 個 item、{len(grouped)} 個合成期，"
        f"要算 {len(pending)} 個"
    )
    failures: dict[str, str] = {}
    computed = 0
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(compute, day, by_tile): day
                for day, by_tile in sorted(pending.items())
            }
            for future in as_completed(futures):
                day = futures[future]
                try:
                    stats = future.result()
                except Exception as err:  # noqa: BLE001 單一合成期失敗不中斷整批
                    failures[day.isoformat()] = (
                        f"{type(err).__name__}: {_strip_query(str(err))}"
                    )
                    continue
                for region_id, stat in stats.items():
                    rows[(day.isoformat(), region_id)] = {
                        "date": day.isoformat(),
                        "location_id": region_id,
                        "asset": asset,
                        "count": str(stat.count),
                        "mean": _text(stat.mean),
                        "standard_deviation": _text(stat.standard_deviation),
                        "minimum": _text(stat.minimum),
                        "maximum": _text(stat.maximum),
                        "pixels_in_bbox": str(stat.pixels_in_bbox),
                        "tiles": ";".join(stat.tiles),
                        "item_ids": ";".join(stat.item_ids),
                    }
                computed += 1
                if computed % 50 == 0:
                    write_stats(stats_path, rows)
                    progress(f"  {computed}/{len(pending)}")
    finally:
        # 中斷（Ctrl-C）時也把算好的存下來，下次接著跑
        if rows:
            write_stats(stats_path, rows)
    summary = {
        "variable_id": variable["id"],
        "collection": collection,
        "asset": asset,
        "item_id_prefix": variable.get("pc_item_prefix"),
        "bbox": list(union),
        **({"window_pixels": window_pixels} if window_pixels else {}),
        "stac_api": STAC_URL,
        "run_at": now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_items_found": len(items),
        "n_composites": len(grouped),
        "n_composites_computed": computed,
        "tiles": sorted({tile for by_tile in grouped.values() for tile in by_tile}),
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "downloaded_bytes": transfer.bytes,
        "range_requests": transfer.requests,
        "failures": failures,
        **metadata,
    }
    _record_run(out_dir / FETCH_FILE, summary)
    return summary


def _strip_query(text: str) -> str:
    """錯誤訊息裡若帶了網址的查詢字串（可能含 token）就去掉。"""
    return " ".join(word.split("?", 1)[0] for word in text.split(" "))


def _record_run(path: Path, summary: dict[str, Any]) -> None:
    """`fetch.json`：每次執行一筆（時間、下載量、檔案 metadata），不含 token。"""
    runs = []
    if path.exists():
        runs = json.loads(path.read_text(encoding="utf-8")).get("runs", [])
    runs.append(summary)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"runs": runs}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="從 Planetary Computer 取 MODIS")
    parser.add_argument("command", choices=["fetch"])
    parser.add_argument("--seed-dir", type=Path, default=Path("data/seed"))
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    parser.add_argument(
        "--variable", action="append", help="只抓這個變數 id（可重複）；預設全部"
    )
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)
    variables = json.loads(
        (args.seed_dir / "variables.json").read_text(encoding="utf-8")
    )
    locations = json.loads(
        (args.seed_dir / "locations.json").read_text(encoding="utf-8")
    )
    regions = [loc for loc in locations if loc.get("kind") == "region"]
    points = [
        loc for loc in locations if loc.get("kind") == "point" and "ghcnh_id" not in loc
    ]
    # (抓取設定, 地點)：區域統計的變數，加上點位序列來自這裡的變數
    wanted = [
        (v, regions)
        for v in variables
        if v["source"] == SOURCE_DIR and (not args.variable or v["id"] in args.variable)
    ] + [
        (spec, points)
        for v in variables
        if (spec := point_variable(v))
        and (not args.variable or v["id"] in args.variable)
    ]
    if not wanted:
        print("seed 裡沒有符合的 planetary_computer 變數")
        return 1
    failed = False
    limits = httpx.Limits(max_connections=args.workers * 2)
    with httpx.Client(timeout=60, limits=limits) as http:
        for variable, targets in wanted:
            summary = fetch_variable(
                http,
                variable,
                targets,
                args.raw_dir,
                today=datetime.now(UTC).date(),
                workers=args.workers,
                progress=print,
            )
            print(
                f"{variable['id']}：算了 {summary['n_composites_computed']} 個合成期，"
                f"{summary['elapsed_seconds']} 秒，下載 {summary['downloaded_bytes'] / 1e6:.1f} MB"
                f"（{summary['range_requests']} 個 Range 請求），失敗 {len(summary['failures'])} 個"
            )
            for day, reason in sorted(summary["failures"].items())[:20]:
                print(f"  失敗 {day}：{reason}")
            failed = failed or bool(summary["failures"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
