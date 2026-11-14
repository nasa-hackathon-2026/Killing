"""NASA GISS GISTEMP v4：全球地表氣溫距平，當作氣溫的「觀測基準」。

來源：https://data.giss.nasa.gov/gistemp/ （下載頁 data_v4.html）。三種檔案：

- 2°×2° 格點 netCDF（`gistemp1200_GHCNv4_ERSSTv5.nc.gz`：陸地加海洋、1200 km 平滑；
  `gistemp250_GHCNv4.nc.gz`：只有陸地測站、250 km 平滑），月距平，1880 年起，基期 1951–1980；
- 全球與南北半球月平均的 CSV（`tabledata_v4/{GLB,NH,SH}.Ts+dSST.csv`），單位 °C 距平。

這裡只做解析與轉成統一格式：序列檔與目錄檔照 `series.py` 的格式寫到 `data/observed/gistemp/`。
格點序列是「點所在的 2° 格」的值，不是該點的實測；全球與半球直接用官方 CSV 的值，不重算。
原始檔放 `data/raw/gistemp/`，不進 git。
"""

import argparse
import gzip
import hashlib
import itertools
import json
import math
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx
import netCDF4
import numpy as np
import numpy.typing as npt

from trend_detective.series import (
    Row,
    Series,
    monthly_points,
    write_catalog,
    write_series,
)

SOURCE_API = "gistemp"
PRODUCT_VERSION = "v4"
BASELINE = "1951-1980"
CELL_SIZE_DEG = 2
SCALE = 0.01
BASE_URL = "https://data.giss.nasa.gov"
TABLE_URL = f"{BASE_URL}/gistemp/tabledata_v4/"
EPOCH = date(1800, 1, 1)
MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]
# 官方 CSV 沒有半球的地點 id 慣例，這裡新增兩個；全球用既有的 `global`
HEMISPHERES = {
    "northern_hemisphere": "NH.Ts+dSST.csv",
    "southern_hemisphere": "SH.Ts+dSST.csv",
}
GLOBAL_TABLE = "GLB.Ts+dSST.csv"
GRID_NOTE = "這是點所在的 2°×2° 格子的月距平（官方分析的格點值），不是該點實測。"
TABLE_NOTE = "官方彙整的全球與半球月平均距平（L-OTI：陸地測站加海面水溫），沿用官方值，不是本專案重算。"


class GistempError(RuntimeError):
    """GISTEMP 檔案缺漏、格式與預期不同，或下載失敗。"""


@dataclass(frozen=True)
class GridProduct:
    variable_id: str
    file: str
    url: str
    smoothing_km: int
    land_only: bool


GRID_PRODUCTS = [
    GridProduct(
        variable_id="gistemp_anom",
        file="gistemp1200_GHCNv4_ERSSTv5.nc.gz",
        url=f"{BASE_URL}/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz",
        smoothing_km=1200,
        land_only=False,
    ),
    GridProduct(
        variable_id="gistemp_land_anom",
        file="gistemp250_GHCNv4.nc.gz",
        url=f"{BASE_URL}/pub/gistemp/gistemp250_GHCNv4.nc.gz",
        smoothing_km=250,
        land_only=True,
    ),
]


@dataclass(frozen=True)
class Grid:
    lats: npt.NDArray[np.float64]
    lons: npt.NDArray[np.float64]
    months: list[date]
    # (time, lat, lon)，缺值是 masked
    values: np.ma.MaskedArray[Any, Any]
    created: date
    baseline: str
    unit: str


def file_created(history: str) -> date:
    """從檔案的 `history` 屬性取產生日期，例如 `Created 2026-11-10 08:55:39 by ...`。"""
    match = re.search(r"Created (\d{4})-(\d{2})-(\d{2})", history)
    if not match:
        raise GistempError(f"history 屬性裡找不到 Created 日期：{history!r}")
    return date(int(match[1]), int(match[2]), int(match[3]))


def _axis_index(value: float, centers: npt.NDArray[np.float64], *, wrap: bool) -> int:
    step = float(centers[1] - centers[0])
    low_edge = float(centers[0]) - step / 2
    offset = value - low_edge
    if wrap:
        offset %= 360.0
    index = math.floor(offset / step)
    # 剛好落在最北邊的邊界算最後一格
    if index == len(centers) and math.isclose(offset, len(centers) * step):
        index -= 1
    if not 0 <= index < len(centers):
        raise GistempError(
            f"{value} 不在格點範圍 {low_edge}～{low_edge + step * len(centers)}"
        )
    return index


def cell_index(
    lat: float,
    lon: float,
    lats: npt.NDArray[np.float64],
    lons: npt.NDArray[np.float64],
) -> tuple[int, int]:
    """點所在的格子 (緯度索引, 經度索引)。格子以中心 ± 半格為界，落在邊界上歸較大的那一格。"""
    return (
        _axis_index(lat, lats, wrap=False),
        _axis_index(lon, lons, wrap=True),
    )


def read_grid(path: Path) -> Grid:
    """讀 GISTEMP 的 netCDF（解壓後）。整數值照 scale_factor 換成距平，fill value 是缺值。"""
    with netCDF4.Dataset(path) as nc:
        variable = nc["tempanomaly"]
        scale = float(variable.scale_factor)
        if not math.isclose(scale, SCALE, rel_tol=1e-4):
            raise GistempError(f"{path.name} 的 scale_factor 是 {scale}，預期 {SCALE}")
        fill = int(variable._FillValue)
        variable.set_auto_maskandscale(False)
        raw = np.asarray(variable[:])
        bounds = np.asarray(nc["time_bnds"][:])
        lats = np.asarray(nc["lat"][:], dtype=np.float64)
        lons = np.asarray(nc["lon"][:], dtype=np.float64)
        history = str(nc.history)
        unit = str(variable.units)
    months = [
        (EPOCH + timedelta(days=int(start))).replace(day=1) for start in bounds[:, 0]
    ]
    for earlier, later in itertools.pairwise(months):
        expected = (earlier.replace(day=28) + timedelta(days=4)).replace(day=1)
        if later != expected:
            raise GistempError(f"{path.name} 的月份不連續：{earlier} 之後是 {later}")
    base = re.search(r"Base: (\d{4}-\d{4})", history)
    if not base:
        raise GistempError(f"history 屬性裡找不到基期：{history!r}")
    values = np.ma.masked_array(
        np.round(raw.astype(np.float64) * SCALE, 2), mask=raw == fill
    )
    return Grid(
        lats=lats,
        lons=lons,
        months=months,
        values=values,
        created=file_created(history),
        baseline=base[1],
        unit=unit,
    )


def _trim(rows: list[Row]) -> list[Row]:
    """去掉開頭與結尾沒有值的月份；中間的缺月保留成缺值。"""
    valid = [index for index, (_, value) in enumerate(rows) if value is not None]
    if not valid:
        return []
    return rows[valid[0] : valid[-1] + 1]


def build_grid_series(
    grid: Grid,
    product: GridProduct,
    *,
    location_id: str,
    lat: float,
    lon: float,
    retrieved_at: str,
) -> Series | None:
    """點所在格子的月距平序列。格子整段都是缺值時回傳 None。"""
    i, j = cell_index(lat, lon, grid.lats, grid.lons)
    column = grid.values[:, i, j]
    rows: list[Row] = [
        (month, None if bool(masked) else float(value))
        for month, value, masked in zip(
            grid.months, column.data, np.ma.getmaskarray(column), strict=True
        )
    ]
    rows = _trim(rows)
    if not rows:
        return None
    center = [float(grid.lats[i]), float(grid.lons[j])]
    inputs = "GHCN v4 測站" if product.land_only else "GHCN v4 測站加 ERSST v5 海面水溫"
    return Series(
        variable_id=product.variable_id,
        location_id=location_id,
        aggregation="point",
        unit=grid.unit,
        source_api=SOURCE_API,
        request={
            "product": f"GISTEMP v4（{inputs}）",
            "file": product.file,
            "url": product.url,
            "file_created": grid.created.isoformat(),
            "location": [lat, lon],
            "cell_center": center,
            "cell_size_deg": CELL_SIZE_DEG,
            "baseline": grid.baseline,
            "smoothing_radius_km": product.smoothing_km,
            "land_only": product.land_only,
            "note": GRID_NOTE,
        },
        retrieved_at=retrieved_at,
        product_version=PRODUCT_VERSION,
        grid={"lat": center[0], "lon": center[1]},
        points=monthly_points(rows),
    )


def parse_table_csv(text: str) -> list[Row]:
    """官方 CSV（`Year,Jan,…,Dec,J-D,…`）的月值；`***` 是尚未發布，轉成 None。

    只取 12 個月份欄，年平均與季平均欄不收。單位是 °C 距平（兩位小數）。
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    header_at = next(
        (index for index, line in enumerate(lines) if line.split(",")[0] == "Year"),
        None,
    )
    if header_at is None:
        raise GistempError("CSV 找不到 Year,Jan,… 表頭")
    header = lines[header_at].split(",")
    columns = [
        (month, header.index(name))
        for month, name in enumerate(MONTH_NAMES, 1)
        if name in header
    ]
    if not columns:
        raise GistempError("CSV 表頭沒有 Jan 等月份欄")
    rows: list[Row] = []
    for line in lines[header_at + 1 :]:
        record = line.split(",")
        if not re.fullmatch(r"\d{4}", record[0]):
            continue  # 重複的表頭或其他說明列
        year = int(record[0])
        for month, index in columns:
            if index >= len(record):
                raise GistempError(f"{year} 年那一列少於表頭的欄數")
            cell = record[index].strip()
            if cell == "***":
                rows.append((date(year, month, 1), None))
                continue
            try:
                value = round(float(cell), 2)
            except ValueError as err:
                raise GistempError(
                    f"{year}-{month:02d} 的值無法解讀：{cell!r}"
                ) from err
            if not math.isfinite(value):
                raise GistempError(f"{year}-{month:02d} 的值不是有限的數字：{cell!r}")
            rows.append((date(year, month, 1), value))
    return rows


def build_table_series(
    rows: list[Row],
    *,
    location_id: str,
    table: str,
    last_modified: str,
    retrieved_at: str,
) -> Series:
    """全球或半球月平均距平（官方彙整值）。聚合方式 `area_mean`，結尾尚未發布的月份不存。"""
    trimmed = _trim(rows)
    if not trimmed:
        raise GistempError(f"{table} 沒有任何有值的月份")
    return Series(
        variable_id="gistemp_anom",
        location_id=location_id,
        aggregation="area_mean",
        unit="K",
        source_api=SOURCE_API,
        request={
            "product": "GISTEMP v4（GHCN v4 測站加 ERSST v5 海面水溫）",
            "file": table,
            "url": f"{TABLE_URL}{table}",
            "file_last_modified": last_modified,
            "baseline": BASELINE,
            "unit_in_file": "°C（距平，差值與 K 相同）",
            "note": TABLE_NOTE,
        },
        retrieved_at=retrieved_at,
        product_version=PRODUCT_VERSION,
        grid=None,
        points=monthly_points(trimmed),
    )


def fetch_file(http: httpx.Client, url: str, dest: Path) -> dict[str, Any]:
    """下載一個檔；回傳 manifest 的一筆（網址、大小、時間、sha256）。"""
    if not url.startswith(BASE_URL + "/"):
        raise GistempError(f"只從 {BASE_URL} 下載：{url}")
    response = http.get(url)
    if response.status_code >= 400:
        raise GistempError(f"{url} → HTTP {response.status_code}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(response.content)
    modified = response.headers.get("last-modified")
    return {
        "url": url,
        "size_bytes": len(response.content),
        "sha256": hashlib.sha256(response.content).hexdigest(),
        "retrieved_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_modified": (
            parsedate_to_datetime(modified)
            .astimezone(UTC)
            .strftime("%Y-%m-%dT%H:%M:%SZ")
            if modified
            else None
        ),
    }


def fetch_all(raw_dir: Path) -> dict[str, Any]:
    """下載格點檔（解壓成 .nc）與三個 CSV，寫 `manifest.json`。"""
    manifest: dict[str, Any] = {}
    with httpx.Client(timeout=300, follow_redirects=True) as http:
        for product in GRID_PRODUCTS:
            entry = fetch_file(http, product.url, raw_dir / product.file)
            with (
                gzip.open(raw_dir / product.file, "rb") as source,
                (raw_dir / product.file.removesuffix(".gz")).open("wb") as target,
            ):
                shutil.copyfileobj(source, target)
            manifest[product.file] = entry
        for table in [GLOBAL_TABLE, *HEMISPHERES.values()]:
            manifest[table] = fetch_file(http, f"{TABLE_URL}{table}", raw_dir / table)
    (raw_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def point_locations(seed_dir: Path) -> list[dict[str, Any]]:
    """既有地點裡所有 `kind = point` 的（台灣 5 個與世界城市）。"""
    found: list[dict[str, Any]] = []
    for name in ("locations.json", "locations.world.json"):
        found.extend(
            loc for loc in _load_json(seed_dir / name) if loc["kind"] == "point"
        )
    return found


def build_all(raw_dir: Path, out_dir: Path, seed_dir: Path) -> list[Series]:
    """讀原始檔，寫序列檔與目錄檔到 `out_dir`；回傳所有序列。"""
    manifest = _load_json(raw_dir / "manifest.json")
    declaration = _load_json(seed_dir / "sources" / "gistemp.json")
    points = point_locations(seed_dir)
    all_locations = {
        loc["id"]: loc
        for name in ("locations.json", "locations.world.json")
        for loc in _load_json(seed_dir / name)
    }
    new_locations = {loc["id"]: loc for loc in declaration["new_locations"]}
    series: list[Series] = []
    for product in GRID_PRODUCTS:
        grid = read_grid(raw_dir / product.file.removesuffix(".gz"))
        retrieved_at = manifest[product.file]["retrieved_at"]
        for loc in points:
            item = build_grid_series(
                grid,
                product,
                location_id=loc["id"],
                lat=loc["lat"],
                lon=loc["lon"],
                retrieved_at=retrieved_at,
            )
            if item is None:
                print(
                    f"{product.variable_id} {loc['id']}：格子整段缺值，不寫",
                    file=sys.stderr,
                )
                continue
            series.append(item)
    tables = {"global": GLOBAL_TABLE, **HEMISPHERES}
    for location_id, table in tables.items():
        series.append(
            build_table_series(
                parse_table_csv((raw_dir / table).read_text(encoding="utf-8")),
                location_id=location_id,
                table=table,
                last_modified=manifest[table]["last_modified"],
                retrieved_at=manifest[table]["retrieved_at"],
            )
        )
    for item in series:
        write_series(out_dir, item)
    used = sorted({item.location_id for item in series})
    locations = [new_locations.get(i) or all_locations[i] for i in used]
    generated_at = max(entry["retrieved_at"] for entry in manifest.values())
    write_catalog(
        out_dir, declaration["variables"], locations, series, generated_at=generated_at
    )
    return series


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="NASA GISTEMP v4 觀測基準（#89）")
    parser.add_argument("command", choices=["fetch", "build"])
    parser.add_argument(
        "--raw-dir", type=Path, default=root / "data" / "raw" / "gistemp"
    )
    parser.add_argument(
        "--out-dir", type=Path, default=root / "data" / "observed" / "gistemp"
    )
    parser.add_argument("--seed-dir", type=Path, default=root / "data" / "seed")
    args = parser.parse_args(argv)
    if args.command == "fetch":
        manifest = fetch_all(args.raw_dir)
        for name, entry in manifest.items():
            print(f"{name}\t{entry['size_bytes']} bytes\t{entry['retrieved_at']}")
        return 0
    series = build_all(args.raw_dir, args.out_dir, args.seed_dir)
    print(f"寫出 {len(series)} 條序列到 {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
