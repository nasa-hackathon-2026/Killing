"""NASA SMAP L3 每日 36 km 表層土壤水（SPL3SMP V009）→ 台灣的月序列（#90）。

用法（`.env` 要有 `EARTHDATA_TOKEN`；在 worktree 裡用 `--raw-dir`、`--out-dir` 指到主 checkout）：

    uv run python -m trend_detective.smap fetch   # CMR 列 granule、OPeNDAP 只取台灣方框
    uv run python -m trend_detective.smap build   # 日值 → 月序列、目錄檔、報告（不連網）

取得方式（2026-11-15 實測）：每天一個 granule（CMR 4,166 個）；Earthdata Cloud 的 OPeNDAP
（`opendap.earthdata.nasa.gov`）用 `dap4.ce` 加索引範圍 `[r0:r1][c0:c1]` 只取台灣方框的 AM、PM
兩組的 `soil_moisture`、`retrieval_qual_flag`、`surface_flag`，一個 granule 約 31 KB、約 2 秒。
不用 Giovanni 與 Harmony，不耗它們的 quota。

像元位置：EASE-Grid 2.0 全球 36 km（EPSG:6933，406 列 × 964 行，像元邊長 36032.220840584 m，
左上角外緣 x = −17367530.45、y = 7314540.83，數字來自 user guide）。granule 內的 `latitude`／
`longitude` 只在當天有反演的格子有值（其餘是 −9999），所以位置由投影公式算出，並與實測的
`latitude`／`longitude` 對過（殘差 < 1 m）。

品質過濾（SPL3SMP V009 user guide 的建議）：只用 `retrieval_qual_flag` 為 0 或 8（建議品質；
8 是凍融反演失敗但不影響土壤水）的像元，再丟掉超出檔案宣告範圍（0.02–0.5 m³/m³）的值。
沒有為了多一點資料而放寬。一個像元一天的值是「當天有效的 AM、PM 兩次通過的平均」。

日轉月（先每格、再空間）：每格的月值是該月有效日的算術平均；點位取最近一格；區域取中心落在
bbox 內（含邊界）、當月至少一天有效的格子的平均（EASE-Grid 2.0 是等面積網格，等權重）。
`n_samples` = 點位該格（區域：任一格）有值的天數，`coverage` = `n_samples` ÷ 當月天數
（時間上的覆蓋，與 Harmony 日資料的區域序列同一種定義，不是空間比例）。
"""

import argparse
import json
import sys
import threading
import time
from calendar import monthrange
from collections import Counter
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import netCDF4
import numpy as np
from numpy.typing import NDArray
from rasterio.warp import transform

from trend_detective.env import read_secret
from trend_detective.grid_fetch import GridFetchError, RetryLog, download_month
from trend_detective.series import Series, write_catalog, write_series

Floats = NDArray[np.float64]
Ints = NDArray[np.int64]

SOURCE_API = "smap"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
SPL3SMP = {
    "short_name": "SPL3SMP",
    "version": "009",
    "concept_id": "C2938664585-NSIDC_CPRD",
    "first_day": date(2015, 3, 31),
}
SEED_FILE = Path("data/seed/sources/smap.json")
LOCATIONS_FILE = Path("data/seed/locations.json")
RAW_DIR = Path("data/raw/smap")
OUT_DIR = Path("data/observed/smap")
VARIABLE_ID = "smap_sm_l3"
UNIT = "m3 m-3"

# EASE-Grid 2.0 全球 36 km
ROWS, COLS = 406, 964
CELL_M = 36032.220840584
UL_X, UL_Y = -17367530.45, 7314540.83
GRID_CRS = "EPSG:6933"

QUALITY_OK = (0, 8)  # retrieval_qual_flag：建議品質
# 檔案 soil_moisture 的 valid_min／valid_max（float32 的 0.02 是 0.01999999955，所以用 float32 值比）
VALID_MIN, VALID_MAX = float(np.float32(0.02)), float(np.float32(0.5))
FLAG_FILL = 65534
FILL_VALUE = -9999.0
PAGE_SIZE = 500
GROUP_AM = "Soil_Moisture_Retrieval_Data_AM"
GROUP_PM = "Soil_Moisture_Retrieval_Data_PM"

# surface_flag 各 bit 的名稱（檔案的 flag_meanings），診斷為什麼沒有有效反演用
SURFACE_BITS = {
    0: "static_water_body",
    1: "radar_water_body_detection",
    2: "coastal_proximity",
    3: "urban_area",
    4: "precipitation",
    5: "snow_or_ice",
    6: "permanent_snow_or_ice",
    7: "radiometer_frozen_ground",
    8: "model_frozen_ground",
    9: "mountainous_terrain",
    10: "dense_vegetation",
    11: "nadir_region",
}


class SmapError(RuntimeError):
    pass


def _transform(
    source: str, target: str, xs: list[float], ys: list[float]
) -> tuple[list[float], list[float]]:
    result = transform(source, target, xs, ys)
    return list(result[0]), list(result[1])


# --- EASE-Grid 2.0 36 km 的像元位置 --------------------------------------------------


def cell_center(row: int, col: int) -> tuple[float, float]:
    """像元中心的 (緯度, 經度)。"""
    x = UL_X + (col + 0.5) * CELL_M
    y = UL_Y - (row + 0.5) * CELL_M
    lons, lats = _transform(GRID_CRS, "EPSG:4326", [x], [y])
    return float(lats[0]), float(lons[0])


def cell_of(lat: float, lon: float) -> tuple[int, int]:
    """包含該經緯度的像元 (列, 行)。"""
    xs, ys = _transform("EPSG:4326", GRID_CRS, [lon], [lat])
    row = int(np.floor((UL_Y - ys[0]) / CELL_M))
    col = int(np.floor((xs[0] - UL_X) / CELL_M))
    if not (0 <= row < ROWS and 0 <= col < COLS):
        raise ValueError(f"({lat}, {lon}) 不在 EASE-Grid 2.0 36 km 範圍內")
    return row, col


@dataclass(frozen=True)
class Window:
    """要取的方框，列、行都含兩端（OPeNDAP 的索引範圍也含兩端）。"""

    row0: int
    row1: int
    col0: int
    col1: int

    @property
    def shape(self) -> tuple[int, int]:
        return self.row1 - self.row0 + 1, self.col1 - self.col0 + 1


def window_for(locations: Sequence[dict[str, Any]], *, margin: int = 1) -> Window:
    """涵蓋所有點位與 bbox 的最小方框，四邊各加 `margin` 格。"""
    cells: list[tuple[int, int]] = []
    for location in locations:
        if location["kind"] == "point":
            cells.append(cell_of(location["lat"], location["lon"]))
        else:
            west, south, east, north = location["bbox"]
            cells += [
                cell_of(lat, lon) for lat in (south, north) for lon in (west, east)
            ]
    rows = [row for row, _ in cells]
    cols = [col for _, col in cells]
    return Window(
        max(0, min(rows) - margin),
        min(ROWS - 1, max(rows) + margin),
        max(0, min(cols) - margin),
        min(COLS - 1, max(cols) + margin),
    )


def window_centers(window: Window) -> tuple[Floats, Floats]:
    """方框內每格中心的緯度與經度（形狀同方框）。"""
    rows = np.arange(window.row0, window.row1 + 1)
    cols = np.arange(window.col0, window.col1 + 1)
    col_grid, row_grid = np.meshgrid(cols, rows)
    x = UL_X + (col_grid + 0.5) * CELL_M
    y = UL_Y - (row_grid + 0.5) * CELL_M
    lons, lats = _transform(
        GRID_CRS, "EPSG:4326", x.ravel().tolist(), y.ravel().tolist()
    )
    shape = window.shape
    return np.array(lats).reshape(shape), np.array(lons).reshape(shape)


def region_mask(window: Window, bbox: Sequence[float]) -> NDArray[np.bool_]:
    """像元中心落在 bbox（west, south, east, north，含邊界）內的格子。"""
    west, south, east, north = bbox
    lats, lons = window_centers(window)
    return (lats >= south) & (lats <= north) & (lons >= west) & (lons <= east)


# --- CMR 與 OPeNDAP ------------------------------------------------------------------


def constraint(window: Window) -> str:
    """`dap4.ce` 的內容：AM、PM 各三個變數，各取方框。"""
    sl = f"[{window.row0}:{window.row1}][{window.col0}:{window.col1}]"
    parts = []
    for group, suffix in ((GROUP_AM, ""), (GROUP_PM, "_pm")):
        for name in ("soil_moisture", "retrieval_qual_flag", "surface_flag"):
            parts.append(f"/{group}/{name}{suffix}{sl}")
    return ";".join(parts)


def parse_granules(items: Sequence[dict[str, Any]]) -> dict[date, str]:
    """CMR（umm_json）的 items → {資料日: OPeNDAP 網址}，沒有 OPeNDAP 連結的略過。

    同一天有重製的 granule 時（2026-11-15 實測 2026-10-15 有 `_001` 與 `_002`）取 GranuleUR
    排序最後的那個（最新一次生產）；`duplicate_days` 列出哪些日子發生過。
    """
    found: dict[date, tuple[str, str]] = {}
    for item in items:
        umm = item["umm"]
        begin = umm["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
        day = date(int(begin[:4]), int(begin[5:7]), int(begin[8:10]))
        urls = [
            link["URL"]
            for link in umm.get("RelatedUrls", [])
            if link.get("Subtype") == "OPENDAP DATA"
        ]
        if not urls:
            continue
        candidate = (str(umm.get("GranuleUR", "")), urls[0])
        if day in found and found[day][0] == candidate[0]:
            raise SmapError(f"{day} 有兩個 GranuleUR 相同的 granule")
        found[day] = max(found.get(day, candidate), candidate)
    return {day: url for day, (_, url) in found.items()}


def list_days(http: httpx.Client, start: date) -> dict[date, str]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        response = http.get(
            CMR_URL,
            params={
                "collection_concept_id": SPL3SMP["concept_id"],
                "temporal": f"{start:%Y-%m-%d}T00:00:00Z,",
                "sort_key": "start_date",
                "page_size": PAGE_SIZE,
                "page_num": page,
            },
        )
        if response.status_code >= 400:
            raise SmapError(f"CMR → HTTP {response.status_code}: {response.text[:200]}")
        batch = response.json().get("items", [])
        items += batch
        if len(batch) < PAGE_SIZE:
            return parse_granules(items)
        page += 1


def day_file(raw_dir: Path, day: date) -> Path:
    return raw_dir / f"{day:%Y%m%d}.nc4"


# --- 一天的有效值 --------------------------------------------------------------------


def valid_values(sm: NDArray[Any], flag: NDArray[Any]) -> Floats:
    """品質旗標為建議品質（0 或 8）、且在宣告範圍內的值；其餘是 NaN。"""
    values = np.ma.filled(np.ma.asarray(sm).astype(np.float64), np.nan)
    flags = np.ma.filled(np.ma.asarray(flag).astype(np.int64), FLAG_FILL)
    ok = np.isin(flags, QUALITY_OK) & (values >= VALID_MIN) & (values <= VALID_MAX)
    return np.where(ok, values, np.nan)


def daily_values(am: Floats, pm: Floats) -> Floats:
    """AM、PM 兩次通過的有效值取平均；只有一次有效就用那一次。"""
    stacked = np.stack([am, pm])
    count = np.isfinite(stacked).sum(axis=0)
    total = np.where(np.isfinite(stacked), stacked, 0.0).sum(axis=0)
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)


@dataclass(frozen=True)
class Day:
    values: Floats  # 有效的日值（AM、PM 平均）
    am: Floats
    pm: Floats
    surface_am: NDArray[np.int64]
    surface_pm: NDArray[np.int64]
    # 診斷用：不看品質旗標的原始反演值（NaN 是沒有反演）與品質旗標（FLAG_FILL 是沒有資料）
    raw_am: Floats
    raw_pm: Floats
    qual_am: NDArray[np.int64]
    qual_pm: NDArray[np.int64]


def _filled(array: Any, fill: float) -> NDArray[Any]:
    return np.ma.filled(np.ma.asarray(array), fill)


def read_day(path: Path) -> Day:
    """讀 OPeNDAP 回傳的小檔。"""
    parts: dict[str, tuple[Floats, Floats, NDArray[np.int64], NDArray[np.int64]]] = {}
    try:
        with netCDF4.Dataset(path) as ds:
            for group, suffix in ((GROUP_AM, ""), (GROUP_PM, "_pm")):
                g = ds.groups[group]
                sm = g.variables[f"soil_moisture{suffix}"][:]
                qual = g.variables[f"retrieval_qual_flag{suffix}"][:]
                surface = g.variables[f"surface_flag{suffix}"][:]
                parts[suffix] = (
                    valid_values(sm, qual),
                    _filled(sm.astype(np.float64), np.nan),
                    _filled(surface.astype(np.int64), FLAG_FILL),
                    _filled(qual.astype(np.int64), FLAG_FILL),
                )
    except (KeyError, OSError) as err:
        raise SmapError(f"{path.name} 不是預期的 SPL3SMP 子集：{err!r}") from err
    am, raw_am, surface_am, qual_am = parts[""]
    pm, raw_pm, surface_pm, qual_pm = parts["_pm"]
    return Day(
        daily_values(am, pm),
        am,
        pm,
        surface_am,
        surface_pm,
        raw_am,
        raw_pm,
        qual_am,
        qual_pm,
    )


# --- 日轉月 --------------------------------------------------------------------------


@dataclass(frozen=True)
class MonthCells:
    month: date
    mean: Floats  # 每格當月有效日的平均，沒有有效日是 NaN
    count: Ints  # 每格當月有效日數
    days_with_data: int  # 方框內任一格有效的日數（粗略，區域與點位另算）
    daily: Floats  # (日, 列, 行)


def monthly_cells(days: dict[date, Floats]) -> dict[date, MonthCells]:
    by_month: dict[date, list[date]] = {}
    for day in sorted(days):
        by_month.setdefault(day.replace(day=1), []).append(day)
    out: dict[date, MonthCells] = {}
    for month, members in by_month.items():
        stack = np.stack([days[d] for d in members])
        count = np.isfinite(stack).sum(axis=0).astype(np.int64)
        total = np.where(np.isfinite(stack), stack, 0.0).sum(axis=0)
        mean = np.where(count > 0, total / np.maximum(count, 1), np.nan)
        any_day = np.isfinite(stack).any(axis=(1, 2))
        out[month] = MonthCells(month, mean, count, int(any_day.sum()), stack)
    return out


def _month_range(months: Sequence[date]) -> list[date]:
    first, last = min(months), max(months)
    out = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        out.append(date(year, month, 1))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def _point(month: date, value: float | None, n_days: int) -> dict[str, Any]:
    if value is None or n_days == 0:
        return {
            "month": month.isoformat(),
            "value": None,
            "n_samples": 0,
            "coverage": 0,
        }
    return {
        "month": month.isoformat(),
        "value": float(value),
        "n_samples": n_days,
        "coverage": n_days / monthrange(month.year, month.month)[1],
    }


def point_points(
    months: dict[date, MonthCells], *, row: int, col: int
) -> list[dict[str, Any]]:
    """單格的月序列（`row`、`col` 是方框內的索引）。第一個到最後一個 granule 月之間逐月一點。"""
    points = []
    for month in _month_range(list(months)):
        cells = months.get(month)
        if cells is None:
            points.append(_point(month, None, 0))
            continue
        n = int(cells.count[row, col])
        points.append(_point(month, cells.mean[row, col] if n else None, n))
    return points


def region_points(
    months: dict[date, MonthCells], mask: NDArray[np.bool_]
) -> list[dict[str, Any]]:
    """區域的月序列：當月至少一天有效的格子的平均；`n_samples` 是區域內任一格有效的日數。"""
    points = []
    for month in _month_range(list(months)):
        cells = months.get(month)
        if cells is None:
            points.append(_point(month, None, 0))
            continue
        usable = mask & (cells.count > 0)
        if not usable.any():
            points.append(_point(month, None, 0))
            continue
        n_days = int(np.isfinite(cells.daily[:, mask]).any(axis=1).sum())
        points.append(_point(month, float(cells.mean[usable].mean()), n_days))
    return points


# --- 抓取 ----------------------------------------------------------------------------


def fetch(
    http: httpx.Client,
    token: str,
    days: dict[date, str],
    window: Window,
    raw_dir: Path,
    *,
    workers: int = 8,
    oldest_first: bool = False,
    report: Any = print,
) -> tuple[int, list[str]]:
    """下載還沒有的日子；回傳（下載數, 失敗清單）。已下載的不重抓。"""
    todo = {d: u for d, u in days.items() if not day_file(raw_dir, d).exists()}
    # Tomcat 不收網址裡沒編碼的 [ ]（HTTP 400，2026-11-15 實測），所以先編碼
    ce = quote(constraint(window), safe="/;:_")
    retries = RetryLog()
    failures: list[str] = []
    done = 0
    lock = threading.Lock()
    started = time.monotonic()

    def one(day: date, url: str) -> None:
        download_month(
            http, token, url, ce, day_file(raw_dir, day), on_retry=retries.note
        )

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(one, d, u): d
            for d, u in sorted(todo.items(), reverse=not oldest_first)
        }
        for future in as_completed(futures):
            day = futures[future]
            try:
                future.result()
            except (GridFetchError, httpx.HTTPError) as err:
                failures.append(f"{day}：{err}")
            with lock:
                done += 1
                if done % 200 == 0 or done == len(todo):
                    report(
                        f"  {done}/{len(todo)}（{time.monotonic() - started:.0f} 秒，"
                        f"失敗 {len(failures)}，重試：{retries.summary()}）"
                    )
    return len(todo) - len(failures), failures


# --- 組裝 ----------------------------------------------------------------------------


def load_locations(path: Path) -> list[dict[str, Any]]:
    """台灣 5 個點位（不含測站）與 5 個區域。"""
    return [
        loc
        for loc in json.loads(path.read_text(encoding="utf-8"))
        if (loc["kind"] == "point" and "ghcnh_id" not in loc) or loc["kind"] == "region"
    ]


def quality_diagnostics(
    days: Sequence[Day], rows_cols: Sequence[tuple[int, int]]
) -> dict[str, Any]:
    """這些格子、全部日子、AM 與 PM 兩次通過合計：為什麼沒有建議品質的反演。

    `passes_with_data` 是 granule 有資料的通過次數（品質旗標不是無資料）；`passes_retrieved`
    是其中 soil_moisture 有值的；`passes_recommended` 是通過品質過濾的（旗標 0 或 8）。
    `retrieved_by_quality_flag` 是有反演值者的 retrieval_qual_flag 分布，
    `retrieved_surface_flag_fractions` 是有反演值者各 surface_flag bit 為 1 的比例。
    """
    with_data = retrieved = recommended = 0
    by_flag: Counter[int] = Counter()
    bits: Counter[int] = Counter()
    for day in days:
        for raw, qual, surface in (
            (day.raw_am, day.qual_am, day.surface_am),
            (day.raw_pm, day.qual_pm, day.surface_pm),
        ):
            for row, col in rows_cols:
                flag = int(qual[row, col])
                if flag == FLAG_FILL:
                    continue
                with_data += 1
                value = raw[row, col]
                if not np.isfinite(value) or value == FILL_VALUE:
                    continue
                retrieved += 1
                by_flag[flag] += 1
                if flag in QUALITY_OK and VALID_MIN <= value <= VALID_MAX:
                    recommended += 1
                for bit in SURFACE_BITS:
                    if int(surface[row, col]) >> bit & 1:
                        bits[bit] += 1
    return {
        "passes_with_data": with_data,
        "passes_retrieved": retrieved,
        "passes_recommended": recommended,
        "retrieved_by_quality_flag": {str(k): v for k, v in sorted(by_flag.items())},
        "retrieved_surface_flag_fractions": {
            SURFACE_BITS[bit]: bits[bit] / retrieved
            for bit in SURFACE_BITS
            if retrieved and bits[bit]
        },
    }


def build(
    raw_dir: Path,
    out_dir: Path,
    *,
    seed_file: Path,
    locations_file: Path,
    now: datetime | None = None,
) -> dict[str, Any]:
    """讀 `raw_dir` 的日檔，寫出序列檔、目錄檔與報告。回傳報告。"""
    seed = json.loads(seed_file.read_text(encoding="utf-8"))
    variable = next(v for v in seed["variables"] if v["id"] == VARIABLE_ID)
    locations = [
        loc for loc in load_locations(locations_file) if loc["id"] in seed["locations"]
    ]
    window = window_for(locations)
    files = sorted(raw_dir.glob("[0-9]" * 8 + ".nc4"))
    if not files:
        raise SmapError(f"{raw_dir} 沒有日檔，先跑 fetch")
    day_data: dict[date, Day] = {}
    for path in files:
        stem = path.stem
        day_data[date(int(stem[:4]), int(stem[4:6]), int(stem[6:8]))] = read_day(path)
    months = monthly_cells({d: v.values for d, v in day_data.items()})
    stamp = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    series: list[Series] = []
    report_rows: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for location in locations:
        request: dict[str, Any] = {
            "product": f"{SPL3SMP['short_name']}.{SPL3SMP['version']}",
            "collection": SPL3SMP["concept_id"],
            "variable": "soil_moisture (DCA)",
            "passes": "AM and PM, valid retrievals averaged",
            "quality": "retrieval_qual_flag in (0, 8); 0.02 <= value <= 0.5",
            "window_rows": [window.row0, window.row1],
            "window_cols": [window.col0, window.col1],
        }
        grid = None
        if location["kind"] == "point":
            row, col = cell_of(location["lat"], location["lon"])
            lat, lon = cell_center(row, col)
            local = (row - window.row0, col - window.col0)
            points = point_points(months, row=local[0], col=local[1])
            aggregation = "point"
            request["location"] = [location["lat"], location["lon"]]
            request["cell"] = {"row": row, "col": col}
            grid = {"lat": round(lat, 4), "lon": round(lon, 4)}
            cells = [local]
        else:
            mask = region_mask(window, location["bbox"])
            points = region_points(months, mask)
            aggregation = "area_mean_cells"
            request["bbox"] = location["bbox"]
            request["n_cells_in_bbox"] = int(mask.sum())
            cells = [(int(r), int(c)) for r, c in zip(*np.nonzero(mask), strict=True)]
        valid = [p for p in points if p["value"] is not None]
        row_report: dict[str, Any] = {
            "location_id": location["id"],
            "aggregation": aggregation,
            "n_months": len(points),
            "n_valid_months": len(valid),
            "valid_month_fraction": len(valid) / len(points) if points else 0.0,
            "total_valid_days": sum(p["n_samples"] for p in valid),
            "mean_coverage": float(np.mean([p["coverage"] for p in points]))
            if points
            else 0.0,
            "n_cells": len(cells),
        }
        if location["kind"] == "region":
            ever = [
                (r, c)
                for r, c in cells
                if any(m.count[r, c] > 0 for m in months.values())
            ]
            row_report["n_cells_ever_valid"] = len(ever)
        row_report["diagnostics"] = quality_diagnostics(list(day_data.values()), cells)
        report_rows.append(row_report)
        if not valid:
            skipped.append({"location_id": location["id"], "reason": "no valid month"})
            continue
        item = Series(
            variable_id=VARIABLE_ID,
            location_id=location["id"],
            aggregation=aggregation,
            unit=UNIT,
            source_api=SOURCE_API,
            request=request,
            retrieved_at=stamp,
            product_version=SPL3SMP["version"],
            grid=grid,
            points=points,
        )
        write_series(out_dir, item)
        series.append(item)
    catalog_variable = {
        **{
            k: v
            for k, v in variable.items()
            if k not in ("data_kind", "data_kind_note")
        },
        "unit": UNIT,
        "valid_from": min(
            (p["month"] for s in series for p in s.points if p["value"] is not None),
            default=None,
        ),
        "valid_to": max(
            (p["month"] for s in series for p in s.points if p["value"] is not None),
            default=None,
        ),
    }
    write_catalog(
        out_dir,
        [catalog_variable],
        locations,
        series,
        generated_at=stamp,
    )
    report = {
        "generated_at": stamp,
        "n_day_files": len(files),
        "first_day": min(day_data).isoformat(),
        "last_day": max(day_data).isoformat(),
        "window": {
            "rows": [window.row0, window.row1],
            "cols": [window.col0, window.col1],
        },
        "series": report_rows,
        "skipped": skipped,
    }
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0] if __doc__ else ""
    )
    parser.add_argument("command", choices=["fetch", "build"])
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR / "spl3smp")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--seed-file", type=Path, default=SEED_FILE)
    parser.add_argument("--locations-file", type=Path, default=LOCATIONS_FILE)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--oldest-first",
        action="store_true",
        help="由舊到新下載（可和預設的由新到舊同時跑）",
    )
    parser.add_argument(
        "--since", type=date.fromisoformat, default=SPL3SMP["first_day"]
    )
    args = parser.parse_args(argv)

    if args.command == "build":
        report = build(
            args.raw_dir,
            args.out_dir,
            seed_file=args.seed_file,
            locations_file=args.locations_file,
        )
        for row in report["series"]:
            print(
                f"{row['location_id']:<10} {row['aggregation']:<16} "
                f"有效月 {row['n_valid_months']}/{row['n_months']}"
            )
        return 0

    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 https://urs.earthdata.nasa.gov/profile 產生 token",
    )
    locations = [
        loc
        for loc in load_locations(args.locations_file)
        if loc["id"]
        in json.loads(args.seed_file.read_text(encoding="utf-8"))["locations"]
    ]
    window = window_for(locations)
    with httpx.Client(timeout=120, follow_redirects=True) as http:
        days = list_days(http, args.since)
        print(
            f"CMR：{len(days)} 個 granule（{min(days)} 至 {max(days)}）；方框 {window}"
        )
        args.raw_dir.mkdir(parents=True, exist_ok=True)
        n, failures = fetch(
            http, token, days, window, args.raw_dir, workers=args.workers
        )
    print(f"下載 {n} 個，失敗 {len(failures)} 個")
    for line in failures[:20]:
        print("  失敗：" + line, file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
