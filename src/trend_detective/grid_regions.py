"""由全球格點立方體在本機算區域的面積加權月平均（#64），完全不連網。

用法（在 repo 根目錄；立方體在 `data/raw/grid/`，見 `grid_fetch.py`）：
    uv run python -m trend_detective.grid_regions --check    # 盤點立方體是否完整
    uv run python -m trend_detective.grid_regions            # 算區域平均，寫進 data/extended/
    uv run python -m trend_detective.grid_regions --clean    # 列出可刪的逐月原始檔（加 --confirm 才刪）

區域是經緯度方框（全球、世界區域、台灣 5 個區域，來自 seed 的 `kind = region` 地點）。
算法：

- 取格點中心落在 bbox 內（含邊界）的格子；`west > east` 的 bbox 視為跨 180° 經線。
- 權重是 cos(緯度)（規則經緯網格上格子面積正比於它）；只對有值的格子平均。
- `coverage` 是「有值格子的權重和 ÷ bbox 內全部格子的權重和」，也就是有值的面積比例。
  陸面模式（GLDAS、FLDAS）只有陸地有值，所以它的區域平均是陸地平均，`coverage` 約等於
  方框裡的陸地比例。這和其他來源的 `coverage`（時間上的覆蓋）不是同一件事。
- 整個區域沒有格點中心、或整段期間都沒有值，就不寫序列，原因記在執行報告。

寫出的序列（`data/extended/series/`）一律是 `aggregation = "area_mean_grid"`、
`source_api = "grid"`，所以不會和 Harmony 的 `area_mean` 撞名，兩者並存。變數 id：格點 seed
與既有變數（核心或 `variables.extended.json`）是同一個產品的同一個變數時用既有的 id 與單位
字串，否則用格點 seed 的 id，變數說明寫在 `data/extended/grid_variables.json`，由目錄檔併入。

日資料產品（OMI）的立方體已經是「每格當月有值日的平均」，這裡再對空間平均；和 Harmony
「先每天做區域平均、再對日子平均」的順序不同，數值不會完全一樣。
"""

import argparse
import fnmatch
import json
import shutil
import sys
import time
from calendar import monthrange
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np
from numpy.typing import NDArray

from trend_detective.extended import (
    EXTENDED_DIR,
    GRID_VARIABLES_FILE,
    load_inputs,
    write_extended_catalog,
)
from trend_detective.grid import EPOCH, Floats
from trend_detective.series import Point, Series, write_series
from trend_detective.snapshot import RAW_DIR, SEED_DIR, SNAPSHOT_DIR

SOURCE_API = "grid"
AGGREGATION = "area_mean_grid"
GRID_DIR = "grid"
BATCH_DIR = "_batch"
SEED_FILES = ("grids.json", "grids.extended.json")
CHECK_FILE = "grid_cubes.check.json"
REPORT_FILE = "grid_regions.report.json"
WEIGHTS = "cos(latitude)"
CELL_SELECTION = "cell centre inside bbox (edges inclusive)"
# 格點中心與 bbox 邊界比較時的容許誤差（度）；座標有的是 float32 轉來的
EDGE_TOLERANCE = 1e-6

Bbox = tuple[float, float, float, float]
Index = slice | NDArray[np.intp]


class GridRegionError(ValueError):
    """立方體或區域不符合預期。"""


# ---------- 區域與面積加權 ----------


def _as_index(positions: NDArray[np.intp]) -> Index:
    """連續的位置用 slice（讀出來是 view），不連續（跨 180°）才用索引陣列。"""
    if len(positions) and np.array_equal(
        positions, np.arange(positions[0], positions[0] + len(positions))
    ):
        return slice(int(positions[0]), int(positions[0]) + len(positions))
    return positions


def lat_positions(lat: Floats, south: float, north: float) -> NDArray[np.intp]:
    inside = (lat >= south - EDGE_TOLERANCE) & (lat <= north + EDGE_TOLERANCE)
    return np.flatnonzero(inside)


def lon_positions(lon: Floats, west: float, east: float) -> NDArray[np.intp]:
    """bbox 內的經度位置；`west > east` 表示跨 180° 經線（例如 170 到 −170）。"""
    if west <= east:
        inside = (lon >= west - EDGE_TOLERANCE) & (lon <= east + EDGE_TOLERANCE)
    else:
        inside = (lon >= west - EDGE_TOLERANCE) | (lon <= east + EDGE_TOLERANCE)
    return np.flatnonzero(inside)


@dataclass(frozen=True)
class RegionCells:
    """一個區域在某個網格上涵蓋的格子，以及每一列緯度的權重。"""

    location_id: str
    bbox: Bbox
    rows: Index
    columns: Index
    weights: Floats
    n_cells: int


def region_cells(
    location_id: str, bbox: Bbox, lat: Floats, lon: Floats
) -> RegionCells | None:
    """bbox 裡沒有任何格點中心時回傳 None。"""
    west, south, east, north = bbox
    rows = lat_positions(lat, south, north)
    columns = lon_positions(lon, west, east)
    if not len(rows) or not len(columns):
        return None
    return RegionCells(
        location_id=location_id,
        bbox=bbox,
        rows=_as_index(rows),
        columns=_as_index(columns),
        weights=np.cos(np.radians(lat[rows])),
        n_cells=len(rows) * len(columns),
    )


def weighted_mean(layer: Floats, cells: RegionCells) -> tuple[float | None, float]:
    """一個時間切片在區域內的 (面積加權平均, 有值面積比例)；全缺時平均是 None。"""
    block = layer[cells.rows][:, cells.columns]
    valid = np.isfinite(block)
    row_sum = np.where(valid, block, 0.0).sum(axis=1, dtype=np.float64)
    row_count = valid.sum(axis=1)
    covered = float((cells.weights * row_count).sum())
    full = float(cells.weights.sum()) * block.shape[1]
    if covered <= 0 or full <= 0:
        return None, 0.0
    return float((cells.weights * row_sum).sum() / covered), covered / full


def area_mean(
    layer: Floats, lat: Floats, lon: Floats, bbox: Bbox
) -> tuple[float | None, float]:
    """`weighted_mean` 的單次版本；bbox 裡沒有格點中心時丟 `GridRegionError`。"""
    cells = region_cells("", bbox, lat, lon)
    if cells is None:
        raise GridRegionError(f"bbox {bbox} 裡沒有任何格點中心")
    return weighted_mean(layer, cells)


# ---------- seed 與變數 id 的對應 ----------


def load_grid_seed(seed_dir: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for name in SEED_FILES:
        path = seed_dir / name
        if path.exists():
            entries += json.loads(path.read_text(encoding="utf-8"))
    return entries


def _source_name(entry: dict[str, Any]) -> str:
    """格點 seed 的變數路徑的最後一段（`/Grid/precipitation` → `precipitation`）。"""
    return str(entry["variable"]).rsplit("/", 1)[-1]


@dataclass(frozen=True)
class Target:
    """一個立方體算出的序列要掛在哪個變數底下。

    `matched` 為 True 表示 `variable_id` 是既有變數（核心或擴充 seed）：同一個產品的同一個
    變數，序列沿用它的單位字串（檔案與 Giovanni 對同一個單位的寫法不同，例如 `NoUnits`
    與 `1`）。否則 `variable_id` 就是格點 seed 的 id，`describe` 是要寫進目錄檔的變數說明。
    """

    variable_id: str
    matched: bool
    unit: str | None
    describe: dict[str, Any] | None


def resolve_targets(
    grid_seed: list[dict[str, Any]], known_variables: list[dict[str, Any]]
) -> dict[str, Target]:
    """格點 seed 的 id → 序列的變數。

    對應規則：id 相同（核心變數）；或「產品相同，且既有變數的 `source_variable_id` 等於
    `<產品，點換成底線>_<變數名>`」（Giovanni 的命名，不分大小寫）。
    """
    by_id = {v["id"]: v for v in known_variables}
    by_source = {
        (str(v.get("product", "")).lower(), str(v["source_variable_id"]).lower()): v
        for v in known_variables
        if v.get("source_variable_id")
    }
    targets: dict[str, Target] = {}
    for entry in grid_seed:
        product = str(entry["product"])
        giovanni_name = f"{product.replace('.', '_')}_{_source_name(entry)}".lower()
        known = by_id.get(entry["id"]) or by_source.get(
            (product.lower(), giovanni_name)
        )
        if known is not None:
            targets[entry["id"]] = Target(
                known["id"], True, known.get("unit") or None, None
            )
            continue
        targets[entry["id"]] = Target(
            entry["id"],
            False,
            None,
            {
                "id": entry["id"],
                "name_zh": entry.get("name_zh"),
                "name_en": entry.get("name_en"),
                "definition_zh": "",
                "category": "待分類",
                "needs_translation": bool(entry.get("needs_translation", True)),
                "tier": "extended",
                "source": SOURCE_API,
                "source_variable_id": entry["variable"],
                "product": product,
                "product_version": entry.get("product_version"),
                "native_temporal_res": entry.get("temporal", "month"),
                "is_nasa": True,
                "doi": entry.get("doi"),
                "citation": entry.get("citation"),
                "source_long_name": entry.get("long_name", ""),
            },
        )
    return targets


# ---------- 盤點 ----------


def _month_index(month: date) -> int:
    return month.year * 12 + month.month - 1


def _parse_month(text: str) -> date:
    return date(int(text[:4]), int(text[5:7]), 1)


def _stem_months(directory: Path, digits: int) -> list[str]:
    """目錄裡檔名是 `digits` 位數字的 `.nc4`（`YYYYMM` 或 `YYYYMMDD`）的檔名主幹。"""
    return sorted(
        path.stem
        for path in directory.glob("*.nc4")
        if len(path.stem) == digits and path.stem.isdigit()
    )


@dataclass
class CubeCheck:
    """一個立方體的盤點結果。`reasons` 非空就是不完整；`notes` 只是提醒。"""

    id: str
    product: str
    temporal: str
    cube: str
    first_month: str | None = None
    last_month: str | None = None
    n_months: int = 0
    n_lat: int = 0
    n_lon: int = 0
    expected_first: str | None = None
    expected_last: str | None = None
    source_months: int | None = None
    all_nan_months: list[str] | None = None
    reasons: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.reasons


def cube_path(raw_dir: Path, grid_id: str) -> Path:
    return raw_dir / GRID_DIR / grid_id / f"{grid_id}.nc"


def read_cube_axes(path: Path) -> tuple[list[date], Floats, Floats, str, str]:
    """只讀座標：回傳 (月份, lat, lon, 立方體裡的變數名, 單位)，不載入值。"""
    with netCDF4.Dataset(path) as dataset:
        name = str(dataset.getncattr("variable"))
        variable = dataset.variables[name]
        if variable.dimensions != ("time", "lat", "lon"):
            raise GridRegionError(f"{path.name} 的維度是 {variable.dimensions}")
        months = [
            EPOCH + timedelta(days=int(days)) for days in dataset.variables["time"][:]
        ]
        lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        unit = str(getattr(variable, "units", ""))
    return months, lat, lon, name, unit


def batch_directories(raw_dir: Path) -> dict[str, Path]:
    """格點 id → 它所在的批次下載目錄（`_batch/<產品>/<雜湊>/`，靠 `variables.json` 對回）。"""
    found: dict[str, Path] = {}
    for listing in sorted((raw_dir / GRID_DIR / BATCH_DIR).glob("*/*/variables.json")):
        try:
            members = json.loads(listing.read_text(encoding="utf-8"))
        except ValueError:
            continue
        for grid_id in members:
            found[grid_id] = listing.parent
    return found


def _day_directory(
    raw_dir: Path, entry: dict[str, Any], batches: dict[str, Path]
) -> Path | None:
    """日資料產品的逐日檔目錄：批次目錄，或該產品底下唯一的一個目錄（沒有 variables.json 時）。"""
    if entry["id"] in batches:
        return batches[entry["id"]]
    candidates = [
        path
        for path in (raw_dir / GRID_DIR / BATCH_DIR / str(entry["product"])).glob("*")
        if path.is_dir() and not (path / "variables.json").exists()
    ]
    return candidates[0] if len(candidates) == 1 else None


def check_cube(
    entry: dict[str, Any],
    raw_dir: Path,
    batches: dict[str, Path],
) -> CubeCheck:
    """只看結構（不解開值）：檔案讀得到、月份連續、起始月與 seed 相符、來源月份都進了立方體。

    「結束月是否與同產品的其他立方體一致」要看全部立方體，由 `check_cubes` 補上。
    """
    path = cube_path(raw_dir, entry["id"])
    temporal = str(entry.get("temporal", "month"))
    check = CubeCheck(
        id=entry["id"],
        product=str(entry["product"]),
        temporal=temporal,
        cube=str(path),
        expected_first=str(entry["start"]),
    )
    if not path.exists():
        check.reasons.append("沒有立方體檔")
        return check
    try:
        months, lat, lon, _, _ = read_cube_axes(path)
    except (OSError, KeyError, AttributeError, GridRegionError) as error:
        check.reasons.append(f"立方體讀不了：{type(error).__name__}: {error}")
        return check
    if path.with_suffix(".part").exists():
        check.notes.append("旁邊留有寫到一半的 .part 檔")
    if not months:
        check.reasons.append("立方體沒有任何月份")
        return check
    check.first_month = f"{months[0]:%Y-%m}"
    check.last_month = f"{months[-1]:%Y-%m}"
    check.n_months, check.n_lat, check.n_lon = len(months), len(lat), len(lon)
    if any(month.day != 1 for month in months):
        check.reasons.append("時間軸不是每月 1 日")
    steps = np.diff([_month_index(month) for month in months])
    if len(steps) and not np.all(steps == 1):
        gaps = int((steps != 1).sum())
        check.reasons.append(f"月份不連續（{gaps} 處中斷或重複）")
    for name, axis in (("緯度", lat), ("經度", lon)):
        spacing = np.diff(axis)
        if (
            len(spacing) < 1
            or spacing[0] <= 0
            or not np.allclose(spacing, spacing[0], rtol=0, atol=abs(spacing[0]) * 1e-3)
        ):
            check.reasons.append(f"{name}不是等間距遞增")
    expected = _parse_month(str(entry["start"]))
    if months[0] > expected:
        check.reasons.append(
            f"起始月 {check.first_month} 晚於 seed 的 {entry['start']}（缺前段）"
        )
    elif months[0] < expected:
        check.notes.append(f"起始月 {check.first_month} 早於 seed 的 {entry['start']}")

    in_cube = {f"{month:%Y%m}" for month in months}
    own_months = raw_dir / GRID_DIR / entry["id"] / "months"
    if temporal == "day":
        _check_days(check, _day_directory(raw_dir, entry, batches), in_cube)
        source = own_months if own_months.is_dir() else None
    else:
        source = own_months if own_months.is_dir() else batches.get(entry["id"])
    if source is None:
        check.notes.append("逐月原始檔不在（已清理或沒下載），無法對照")
        return check
    stems = _stem_months(source, 6)
    check.source_months = len(stems)
    start_stem = f"{expected:%Y%m}"
    left_out = [stem for stem in stems if stem >= start_stem and stem not in in_cube]
    if left_out:
        check.reasons.append(
            f"逐月原始檔有 {len(left_out)} 個月沒進立方體（{left_out[0]}…{left_out[-1]}）"
        )
    absent = sorted(in_cube - set(stems))
    if absent:
        check.notes.append(f"立方體有 {len(absent)} 個月在逐月原始檔裡找不到")
    return check


def _check_days(check: CubeCheck, day_dir: Path | None, in_cube: set[str]) -> None:
    """日資料：有日檔的月份都要在立方體裡；日檔少於當月天數的月份只提醒（離線無法對照 CMR）。"""
    if day_dir is None:
        check.notes.append("逐日原始檔不在，無法對照")
        return
    days_by_month: dict[str, int] = {}
    for stem in _stem_months(day_dir, 8):
        days_by_month[stem[:6]] = days_by_month.get(stem[:6], 0) + 1
    start = (check.expected_first or "0000-00").replace("-", "")
    left_out = sorted(m for m in days_by_month if m >= start and m not in in_cube)
    if left_out:
        check.reasons.append(
            f"有日檔的 {len(left_out)} 個月沒進立方體（{left_out[0]}…{left_out[-1]}）"
        )
    short = sorted(
        month
        for month, count in days_by_month.items()
        if month in in_cube and count < monthrange(int(month[:4]), int(month[4:6]))[1]
    )
    if short:
        latest = max(in_cube)
        detail = (
            f"；最新月份 {latest} 只有 {days_by_month[latest]} 天"
            if latest in short
            else ""
        )
        check.notes.append(
            f"{len(short)} 個月的日檔少於當月天數（產品缺日或尚未抓齊，離線無法對照 CMR）{detail}"
        )
    without_days = sorted(in_cube - set(days_by_month))
    if without_days:
        check.notes.append(f"立方體有 {len(without_days)} 個月找不到日檔")


def check_cubes(grid_seed: list[dict[str, Any]], raw_dir: Path) -> list[CubeCheck]:
    """盤點全部立方體；同一個產品裡結束月比別人早的記為不完整。"""
    batches = batch_directories(raw_dir)
    checks = [check_cube(entry, raw_dir, batches) for entry in grid_seed]
    latest: dict[str, str] = {}
    for check in checks:
        if check.last_month:
            latest[check.product] = max(latest.get(check.product, ""), check.last_month)
    for check in checks:
        check.expected_last = latest.get(check.product)
        if check.last_month and check.last_month < latest[check.product]:
            check.reasons.append(
                f"結束月 {check.last_month} 早於同產品其他立方體的 {latest[check.product]}"
            )
    return checks


def scan_all_nan_months(path: Path) -> list[str]:
    """整個月沒有任何有值格子的月份（逐月讀，不把整個立方體放進記憶體）。"""
    months, _, _, name, _ = read_cube_axes(path)
    empty: list[str] = []
    with netCDF4.Dataset(path) as dataset:
        variable = dataset.variables[name]
        variable.set_auto_mask(False)
        for i, month in enumerate(months):
            if not np.isfinite(np.asarray(variable[i])).any():
                empty.append(f"{month:%Y-%m}")
    return empty


def check_report(checks: list[CubeCheck]) -> str:
    """盤點的文字摘要：各產品的完整數與期間，再列出不完整與有提醒的立方體。"""
    lines: list[str] = []
    products = sorted({check.product for check in checks})
    for product in products:
        own = [check for check in checks if check.product == product]
        done = [check for check in own if check.complete]
        spans = sorted(
            {(c.first_month, c.last_month, c.n_months) for c in done if c.first_month}
        )
        span_text = "；".join(f"{a} 至 {b}（{n} 個月）" for a, b, n in spans)
        lines.append(f"{product}：完整 {len(done)}／{len(own)}　{span_text}")
    incomplete = [check for check in checks if not check.complete]
    lines.append(
        f"合計：完整 {len(checks) - len(incomplete)}，不完整 {len(incomplete)}"
    )
    for check in incomplete:
        lines.append(f"  不完整 {check.id}：{'；'.join(check.reasons)}")
    noted: dict[str, list[str]] = {}
    for check in checks:
        for note in check.notes:
            noted.setdefault(note, []).append(check.id)
        if check.all_nan_months:
            months = check.all_nan_months
            noted.setdefault(
                f"有 {len(months)} 個月整張都是缺值（{months[0]}…{months[-1]}）", []
            ).append(check.id)
    for note, ids in noted.items():
        shown = "、".join(ids[:6]) + ("…" if len(ids) > 6 else "")
        lines.append(f"  提醒 × {len(ids)}：{note}　{shown}")
    return "\n".join(lines)


# ---------- 區域平均 ----------


@dataclass
class CubeResult:
    grid_id: str
    series: list[Series] = field(default_factory=list)
    # 地點 id → 沒有寫序列的原因
    skipped: dict[str, str] = field(default_factory=dict)
    all_nan_months: list[str] = field(default_factory=list)
    error: str | None = None
    seconds: float = 0.0


def _days_in_month_files(months_dir: Path) -> dict[str, int]:
    """日資料產品：`months/YYYYMM.nc4` 記的當月日檔數（`days_in_file`）。"""
    counts: dict[str, int] = {}
    for stem in _stem_months(months_dir, 6):
        try:
            with netCDF4.Dataset(months_dir / f"{stem}.nc4") as dataset:
                counts[stem] = int(dataset.getncattr("days_in_file"))
        except (OSError, AttributeError):
            continue
    return counts


def compute_cube(
    entry: dict[str, Any],
    target: Target,
    regions: list[tuple[str, Bbox]],
    raw_dir: Path,
    now: str,
) -> CubeResult:
    """一個立方體 × 全部區域的月平均。一次只讀一個月的切片。

    月資料 `n_samples = 1`；日資料產品是「當月的日檔數」（`months/` 還在時），否則也是 1。
    缺值的月份 `value` 是 None、`n_samples` 與 `coverage` 是 0。
    """
    started = time.monotonic()
    result = CubeResult(grid_id=entry["id"])
    path = cube_path(raw_dir, entry["id"])
    try:
        months, lat, lon, name, cube_unit = read_cube_axes(path)
        cells: list[RegionCells] = []
        for location_id, bbox in regions:
            found = region_cells(location_id, bbox, lat, lon)
            if found is None:
                result.skipped[location_id] = "bbox 裡沒有任何格點中心"
            else:
                cells.append(found)
        temporal = str(entry.get("temporal", "month"))
        day_counts = (
            _days_in_month_files(path.parent / "months") if temporal == "day" else {}
        )
        points: dict[str, list[Point]] = {c.location_id: [] for c in cells}
        with netCDF4.Dataset(path) as dataset:
            variable = dataset.variables[name]
            variable.set_auto_mask(False)
            for i, month in enumerate(months):
                layer = np.asarray(variable[i], dtype=np.float32)
                if not np.isfinite(layer).any():
                    result.all_nan_months.append(f"{month:%Y-%m}")
                samples = day_counts.get(f"{month:%Y%m}", 1)
                for region in cells:
                    value, coverage = weighted_mean(layer, region)
                    points[region.location_id].append(
                        {
                            "month": month.isoformat(),
                            "value": value,
                            "n_samples": 0 if value is None else samples,
                            "coverage": coverage,
                        }
                    )
        # 用整條軸算間距：有的座標是 float32 轉來的，相鄰兩格相減會帶誤差
        lat_step = float(lat[-1] - lat[0]) / (len(lat) - 1)
        lon_step = float(lon[-1] - lon[0]) / (len(lon) - 1)
        for region in cells:
            own = points[region.location_id]
            if all(point["value"] is None for point in own):
                result.skipped[region.location_id] = "區域內整段期間都是缺值"
                continue
            result.series.append(
                Series(
                    variable_id=target.variable_id,
                    location_id=region.location_id,
                    aggregation=AGGREGATION,
                    unit=target.unit if target.unit is not None else cube_unit,
                    source_api=SOURCE_API,
                    request={
                        "product": entry["product"],
                        "variable": entry["variable"],
                        "collection": entry.get("collection"),
                        "cube_id": entry["id"],
                        "cube_unit": cube_unit,
                        "cube_first_month": f"{months[0]:%Y-%m}",
                        "cube_last_month": f"{months[-1]:%Y-%m}",
                        "temporal": temporal,
                        "bbox": list(region.bbox),
                        "cell_selection": CELL_SELECTION,
                        "weights": WEIGHTS,
                        "n_cells": region.n_cells,
                        "grid": {
                            "lat_step": round(lat_step, 6),
                            "lon_step": round(lon_step, 6),
                            "n_lat": len(lat),
                            "n_lon": len(lon),
                        },
                    },
                    retrieved_at=now,
                    product_version=str(entry.get("product_version", "")),
                    grid=None,
                    points=own,
                )
            )
    except (OSError, KeyError, AttributeError, ValueError) as error:
        result.series = []
        result.error = f"{type(error).__name__}: {error}"
    result.seconds = time.monotonic() - started
    return result


def write_results(out_dir: Path, results: list[CubeResult]) -> dict[str, str]:
    """寫序列檔，回傳「沒有寫」的 {序列鍵: 原因}。

    目標檔已存在而且不是格點來源的序列（例如 Harmony 的區域平均）時不覆蓋。
    """
    refused: dict[str, str] = {}
    for result in results:
        for series in result.series:
            path = out_dir / series.file
            if path.exists():
                try:
                    existing = json.loads(path.read_text(encoding="utf-8"))
                    other = existing.get("source_api")
                except (OSError, ValueError):
                    other = "無法讀取的檔案"
                if other != SOURCE_API:
                    refused[path.stem] = f"已有來自 {other} 的序列，不覆蓋"
                    continue
            write_series(out_dir, series)
    return refused


def write_grid_variables(out_dir: Path, targets: list[Target]) -> Path:
    """把用格點 seed id 的變數說明寫到 `grid_variables.json`，目錄檔重建時併入。"""
    entries = sorted(
        (t.describe for t in targets if t.describe is not None),
        key=lambda entry: entry["id"],
    )
    path = out_dir / GRID_VARIABLES_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return path


def region_locations(locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [loc for loc in locations if loc.get("kind") == "region" and loc.get("bbox")]


def run(
    grid_seed: list[dict[str, Any]],
    known_variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    raw_dir: Path,
    out_dir: Path,
    *,
    now: str,
    workers: int = 1,
    include: list[str] | None = None,
) -> dict[str, Any]:
    """盤點、對完整的立方體算區域平均、寫序列與目錄檔，回傳執行報告。"""
    checks = check_cubes(grid_seed, raw_dir)
    targets = resolve_targets(grid_seed, known_variables)
    regions: list[tuple[str, Bbox]] = []
    for loc in region_locations(locations):
        west, south, east, north = (float(edge) for edge in loc["bbox"])
        regions.append((loc["id"], (west, south, east, north)))
    groups = {loc["id"]: loc.get("group", "") for loc in locations}
    complete = {check.id for check in checks if check.complete}
    selected = [
        entry
        for entry in grid_seed
        if entry["id"] in complete
        and (not include or any(fnmatch.fnmatch(entry["id"], p) for p in include))
    ]
    jobs = [(entry, targets[entry["id"]], regions, raw_dir, now) for entry in selected]
    if workers > 1 and len(jobs) > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(compute_cube, *zip(*jobs, strict=True)))
    else:
        results = [compute_cube(*job) for job in jobs]
    refused = write_results(out_dir, results)
    # 說明檔要涵蓋磁碟上所有用格點 seed id 的序列，不只這次選到的
    write_grid_variables(out_dir, list(targets.values()))
    write_extended_catalog(out_dir, known_variables, locations, now=now)

    written: dict[str, int] = {}
    for result in results:
        for series in result.series:
            if series.file.removeprefix("series/").removesuffix(".json") in refused:
                continue
            group = groups.get(series.location_id, "")
            written[group] = written.get(group, 0) + 1
    report = {
        "generated_at": now,
        "aggregation": AGGREGATION,
        "source_api": SOURCE_API,
        "weights": WEIGHTS,
        "cell_selection": CELL_SELECTION,
        "n_cubes_in_seed": len(grid_seed),
        "n_cubes_complete": len(complete),
        "n_cubes_computed": len(results),
        "incomplete": {
            check.id: check.reasons for check in checks if not check.complete
        },
        "series_written_by_location_group": dict(sorted(written.items())),
        "n_series_written": sum(written.values()),
        "matched_existing_variable": sorted(
            f"{grid_id} -> {target.variable_id}"
            for grid_id, target in targets.items()
            if target.matched and grid_id != target.variable_id
        ),
        "refused": refused,
        "errors": {r.grid_id: r.error for r in results if r.error},
        "skipped": {r.grid_id: r.skipped for r in results if r.skipped},
        "all_nan_months": {
            r.grid_id: r.all_nan_months for r in results if r.all_nan_months
        },
        "seconds": {r.grid_id: round(r.seconds, 1) for r in results},
    }
    (out_dir / REPORT_FILE).write_text(
        json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return report


def run_summary(report: dict[str, Any]) -> str:
    lines = [
        (
            f"立方體：seed {report['n_cubes_in_seed']}，"
            f"完整 {report['n_cubes_complete']}，這次計算 {report['n_cubes_computed']}"
        ),
        f"寫出序列 {report['n_series_written']} 條："
        + "、".join(
            f"{group or '（未分組）'} {count}"
            for group, count in report["series_written_by_location_group"].items()
        ),
    ]
    reasons: dict[str, int] = {}
    for skipped in report["skipped"].values():
        for location_id, reason in skipped.items():
            key = f"{location_id}：{reason}"
            reasons[key] = reasons.get(key, 0) + 1
    for key, count in sorted(reasons.items(), key=lambda item: -item[1]):
        lines.append(f"  沒寫 × {count}：{key}")
    for name, reason in report["refused"].items():
        lines.append(f"  不覆蓋：{name}（{reason}）")
    for grid_id, error in report["errors"].items():
        lines.append(f"  失敗：{grid_id}（{error}）")
    for grid_id, reasons_ in report["incomplete"].items():
        lines.append(f"  不完整、未計算：{grid_id}（{'；'.join(reasons_)}）")
    return "\n".join(lines)


# ---------- 清理 ----------


def _size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def cleanup_plan(
    grid_seed: list[dict[str, Any]], checks: list[CubeCheck], raw_dir: Path
) -> tuple[list[Path], list[str]]:
    """可以刪的逐月原始檔目錄，以及保留的理由。

    只刪月資料產品：變數自己的 `months/`，以及「裡面每個變數的立方體都完整」的批次目錄。
    日資料產品（OMI）全部保留：日檔是否齊全離線無法對照 CMR，而且 `months/` 裡的每格有值
    天數（`n_days`）立方體沒有。立方體本身不會列入。
    """
    complete = {check.id for check in checks if check.complete}
    temporal = {entry["id"]: entry.get("temporal", "month") for entry in grid_seed}
    removable: list[Path] = []
    kept: list[str] = []
    for entry in grid_seed:
        months_dir = raw_dir / GRID_DIR / entry["id"] / "months"
        if not months_dir.is_dir():
            continue
        if temporal[entry["id"]] == "day":
            kept.append(f"{months_dir}：日資料產品，保留")
        elif entry["id"] in complete:
            removable.append(months_dir)
        else:
            kept.append(f"{months_dir}：立方體不完整，保留")
    members: dict[Path, list[str]] = {}
    for grid_id, directory in batch_directories(raw_dir).items():
        members.setdefault(directory, []).append(grid_id)
    for directory in sorted((raw_dir / GRID_DIR / BATCH_DIR).glob("*/*")):
        if not directory.is_dir():
            continue
        ids = members.get(directory)
        if not ids:
            kept.append(f"{directory}：沒有 variables.json，不知道裡面是哪些變數，保留")
        elif any(temporal.get(grid_id) != "month" for grid_id in ids):
            kept.append(f"{directory}：日資料產品或不在 seed 的變數，保留")
        elif all(grid_id in complete for grid_id in ids):
            removable.append(directory)
        else:
            bad = [grid_id for grid_id in ids if grid_id not in complete]
            kept.append(f"{directory}：{len(bad)} 個變數的立方體不完整，保留")
    return removable, kept


# ---------- 指令 ----------


def _scan(path: str) -> list[str]:
    return scan_all_nan_months(Path(path))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="由全球格點立方體算區域的面積加權月平均（不連網）"
    )
    parser.add_argument("--check", action="store_true", help="只盤點立方體，不計算")
    parser.add_argument(
        "--no-scan",
        action="store_true",
        help="盤點時不解開值找整月缺值的月份（只看結構，幾秒內完成）",
    )
    parser.add_argument(
        "--clean", action="store_true", help="列出可刪的逐月原始檔；加 --confirm 才刪"
    )
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument(
        "--variable",
        action="append",
        help="只算這些格點 id（可重複、可用 *）；預設全部完整的立方體",
    )
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--out-dir", type=Path, default=EXTENDED_DIR)
    parser.add_argument("--seed-dir", type=Path, default=SEED_DIR)
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    args = parser.parse_args(argv)
    grid_seed = load_grid_seed(args.seed_dir)
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    if args.check or args.clean:
        checks = check_cubes(grid_seed, args.raw_dir)
        if args.clean:
            removable, kept = cleanup_plan(grid_seed, checks, args.raw_dir)
            total = 0
            for directory in removable:
                size = _size(directory)
                total += size
                print(
                    f"{'刪除' if args.confirm else '可刪'} {directory}（{size / 1e9:.2f} GB）"
                )
                if args.confirm:
                    shutil.rmtree(directory)
            for line in kept:
                print(f"保留 {line}")
            print(
                f"{'已刪除' if args.confirm else '可刪除'} {len(removable)} 個目錄，"
                f"共 {total / 1e9:.1f} GB"
                + ("" if args.confirm else "（加 --confirm 才會刪）")
            )
            return 0
        if not args.no_scan:
            readable = [check for check in checks if check.first_month]
            with ProcessPoolExecutor(max_workers=max(1, args.workers)) as pool:
                scanned = pool.map(_scan, [check.cube for check in readable])
                for check, empty in zip(readable, scanned, strict=True):
                    check.all_nan_months = empty
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / CHECK_FILE).write_text(
            json.dumps(
                {
                    "generated_at": now,
                    "cubes": [
                        {**asdict(check), "complete": check.complete}
                        for check in checks
                    ],
                },
                ensure_ascii=False,
                indent=1,
            )
            + "\n",
            encoding="utf-8",
        )
        print(check_report(checks))
        print(f"明細：{args.out_dir / CHECK_FILE}")
        return 0 if all(check.complete for check in checks) else 1

    variables, locations = load_inputs(args.seed_dir, args.snapshot_dir)
    report = run(
        grid_seed,
        variables,
        locations,
        args.raw_dir,
        args.out_dir,
        now=now,
        workers=max(1, args.workers),
        include=args.variable,
    )
    print(run_summary(report))
    print(f"報告：{args.out_dir / REPORT_FILE}")
    return 1 if report["errors"] or report["refused"] else 0


if __name__ == "__main__":
    sys.exit(main())
